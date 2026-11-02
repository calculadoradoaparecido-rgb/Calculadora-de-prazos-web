import { analisarTexto, PARSER_VERSION, fold } from './parser.js';
import { analisarMagistrados, MAG_VERSION, chaveNome } from './magistrados.js';
import { CADASTRO_INICIAL, situacaoUnidade, lerPeriodo, mesmoJuiz, chaveUnidade, areaUnidade, mesclarCadastroBase } from './cadastro.js';
import { criarZip } from './zip.js';
import { URL_CALENDARIO, obterCalendario, lerCapturas, mesclarCalendario, datasDaTela } from './calendario-tjce.js';
import { baixarMateria } from './djea.js';
import { coletar, processarIds as processarLista, TERMOS_PADRAO } from './coleta.js';
import { COMARCAS, COMARCA_DO_MUNICIPIO } from './comarcas.js';
import { calcularPrazo, calcularPrazoPenal, montarMapa, situacao, somarDias, calendarioBase } from './calendario.js';

const $ = s => document.querySelector(s);
const MESES_NOME = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const SEMANA = ['dom','seg','ter','qua','qui','sex','sáb'];
const CORES = { 'Feriado': 'var(--feriado)', 'Ponto facultativo': 'var(--ponto)', 'Suspensão de expediente': 'var(--suspensao)',
  'Suspensão de prazos': 'var(--suspensao)', 'Prazos não suspensos': 'var(--correm)' };
const CLASSE_TIPO = { 'Feriado': 't-feriado', 'Ponto facultativo': 't-ponto', 'Suspensão de expediente': 't-suspensao',
  'Suspensão de prazos': 't-suspensao', 'Prazos não suspensos': 't-correm' };

const estado = {
  materias: {},          // id -> registro relevante | 0 (sem datas) | -1 (inexistente)
  maiorId: 0,
  falhas: [],
  coletando: false,
  controle: null,
  filtro: { ano: new Date().getFullYear(), comarca: '', tipo: '', busca: '', gerais: true, dia: '' }
};

// ---------- armazenamento ----------
async function carregar() {
  const d = await chrome.storage.local.get(['materias', 'maiorId', 'config', 'calc', 'calcPenal', 'aba', 'falhas', 'atosMag', 'cadastroJuizes', 'calendarioTJCE']);
  estado.calTJCE = d.calendarioTJCE || null;
  estado.atosMag = d.atosMag || {};
  // Analisador de juízes mudou de versão: as matérias descartadas antes (0) voltam a ser lidas na próxima coleta.
  const { magVersao } = await chrome.storage.local.get('magVersao');
  if ((magVersao || 0) < MAG_VERSION) {
    const zeros = Object.keys(estado.atosMag).filter(id => estado.atosMag[id] === 0);
    zeros.forEach(id => delete estado.atosMag[id]);
    await chrome.storage.local.set({ atosMag: estado.atosMag, magVersao: MAG_VERSION });
    if (zeros.length) estado.avisoReleitura = `${zeros.length} matéria(s) serão relidas na próxima atualização (novo leitor de portarias em tabela).`;
  }
  const mig = mesclarCadastroBase(d.cadastroJuizes);
  estado.cadastro = mig.cadastro;
  if (mig.adicionadas) {
    await chrome.storage.local.set({ cadastroJuizes: estado.cadastro }); // mantém a data da última edição
    estado.avisoCadastro = `${mig.adicionadas} unidade(s) criminal(is) acrescentada(s) ao cadastro de juízes.`;
  }
  estado.falhas = d.falhas || [];
  estado.calcSalvo = d.calc || {};
  estado.calcPenalSalvo = d.calcPenal || {};
  estado.aba = d.aba || 'abaCalc';
  estado.materias = d.materias || {};
  estado.maiorId = d.maiorId || 0;
  const c = d.config || {};
  $('#ano').value = c.ano || new Date().getFullYear();
  $('#termos').value = (c.termos || TERMOS_PADRAO).join('\n');
  $('#somentePortarias').checked = c.somentePortarias ?? true;
  $('#maxPaginas').value = Math.max(c.maxPaginas || 0, 40);
  $('#porComarca').checked = c.porComarca ?? true;
  $('#magistrados').checked = c.magistrados ?? true;
  $('#conexoes').value = c.conexoes || 4;
}
let salvarTimer = null;
function salvar(imediato = false) {
  clearTimeout(salvarTimer);
  const fazer = () => chrome.storage.local.set({ materias: estado.materias, atosMag: estado.atosMag, maiorId: estado.maiorId, falhas: estado.falhas });
  if (imediato) return fazer();
  salvarTimer = setTimeout(fazer, 1500);
}
function salvarConfig() {
  chrome.storage.local.set({ config: lerConfig() });
}
function lerConfig() {
  return {
    ano: +$('#ano').value || new Date().getFullYear(),
    termos: $('#termos').value.split('\n').map(t => t.trim()).filter(Boolean),
    somentePortarias: $('#somentePortarias').checked,
    porComarca: $('#porComarca').checked,
    magistrados: $('#magistrados').checked,
    maxPaginas: Math.max(1, +$('#maxPaginas').value || 40),
    conexoes: Math.min(8, Math.max(1, +$('#conexoes').value || 4))
  };
}

// ---------- registro e progresso ----------
function log(msg) {
  const el = $('#registro');
  const hora = new Date().toLocaleTimeString('pt-BR');
  el.textContent = `[${hora}] ${msg}\n` + el.textContent.slice(0, 20000);
}
function progresso(feitos, total, texto) {
  $('#progresso').hidden = false;
  $('#barra').style.width = total ? `${Math.round(feitos / total * 100)}%` : '0';
  $('#progressoTexto').textContent = texto ?? `${feitos} de ${total} matérias analisadas`;
}
function ocupado(sim) {
  $('#btnBuscar').disabled = sim;
  $('#btnAtualizar').disabled = sim;
  $('#btnVarrer').disabled = sim;
  $('#btnReanalisar').disabled = sim;
  $('#btnRepetir').disabled = sim;
  $('#btnParar').disabled = !sim;
}

// ---------- coleta ----------
// ---------- coleta manual ----------
const TRAVA_MAX = 2 * 3600e3;

async function obterTrava() {
  const { coletaEmAndamento } = await chrome.storage.local.get('coletaEmAndamento');
  if (coletaEmAndamento && Date.now() - coletaEmAndamento.desde < TRAVA_MAX) return false;
  await chrome.storage.local.set({ coletaEmAndamento: { desde: Date.now(), origem: 'manual' } });
  return true;
}
const soltarTrava = () => chrome.storage.local.remove('coletaEmAndamento');

function ganchosDeColeta() {
  return {
    signal: estado.controle.signal,
    conhecidos: new Set(Object.keys(estado.materias).filter(id => id in estado.atosMag).map(Number)),
    log,
    aoRegistrar: (id, valor, mag) => { estado.materias[id] = valor; estado.atosMag[id] = mag; salvar(); },
    aoProgresso: (texto, f, t) => { progresso(f, t, texto); if (f && f % 25 === 0) desenhar(); }
  };
}

function concluir(r) {
  const lidas = new Set(Object.keys(estado.materias).map(Number));
  estado.falhas = [...new Set([...estado.falhas.filter(id => !lidas.has(id)), ...r.falhas])];
  if (r.maiorId > estado.maiorId) estado.maiorId = r.maiorId;
}

async function executar(tarefa, textoFim) {
  estado.coletando = true; // antes da trava, para a tela não confundir a própria busca com a automática
  if (!(await obterTrava())) {
    estado.coletando = false;
    progresso(0, 1, 'A busca automática está rodando agora. Aguarde ela terminar; a tela se atualiza sozinha.');
    return;
  }
  estado.controle = new AbortController();
  ocupado(true);
  try {
    const r = await tarefa();
    concluir(r);
    await salvar(true);
    if (estado.controle.signal.aborted) throw new DOMException('Interrompido', 'AbortError');
    progresso(1, 1, textoFim(r));
  } catch (e) {
    await salvar(true);
    if (e.name === 'AbortError') progresso(0, 1, 'Coleta interrompida. O que já foi lido ficou salvo.');
    else { log(`Erro: ${e.message}`); progresso(0, 1, `Erro: ${e.message}`); }
  } finally {
    estado.coletando = false;
    await soltarTrava();
    ocupado(false);
    desenhar();
  }
}

const textoResultado = r => `Concluído: ${r.novas.length} matéria(s) nova(s) com datas.` +
  (r.falhas.length ? ` ${r.falhas.length} matéria(s) não abriram mesmo após 4 tentativas; use "Tentar as que falharam" mais tarde.` : ' Nenhuma falha.');

/**
 * modo 'incremental': o que saiu desde a última atualização (DJEA + calendário a partir daquele mês).
 * modo 'completo': todas as páginas de todas as pesquisas e o calendário do ano inteiro (só quando pedido).
 */
async function buscar(modo = 'incremental') {
  const cfg = lerConfig();
  salvarConfig();
  if (modo === 'completo' && !confirm('A carga completa refaz todas as pesquisas no DJEA e varre o calendário do ano inteiro. Pode levar vários minutos. Continuar?')) return;
  const { ultimaAtualizacao } = await chrome.storage.local.get('ultimaAtualizacao');
  const desde = modo === 'incremental' ? (ultimaAtualizacao?.quando || null) : null;
  const inicio = Date.now();
  let resultado = null;
  await executar(async () => {
    resultado = await coletar(cfg, { ...ganchosDeColeta(), falhasAnteriores: estado.falhas, modo, desde });
    progresso(0, 0, modo === 'completo' ? 'Varrendo o calendário do TJCE (ano inteiro)…' : 'Atualizando o calendário do TJCE…');
    if (window.PRAZOS_WEB) {
      // Na versão web não existe background nem aba auxiliar da extensão: tenta ler o calendário diretamente via proxy.
      try {
        const calWeb = await obterCalendario(cfg.ano, estado.calTJCE?.fonte, msg => log(msg));
        if (calWeb?.datas?.length) {
          estado.calTJCE = mesclarCalendario(estado.calTJCE, calWeb.datas, calWeb.fonte);
          await chrome.storage.local.set({ calendarioTJCE: estado.calTJCE });
          resultado.calOk = true;
        } else {
          resultado.calOk = false;
          log('Calendário web: não foi possível extrair eventos automaticamente nesta tentativa.');
        }
      } catch (e) {
        resultado.calOk = false;
        log(`Calendário web: ${e.message}`);
      }
    } else {
      const cal = await chrome.runtime.sendMessage({ alvo: 'background', cmd: 'calendarioPorAba', ano: cfg.ano, desde }).catch(() => null);
      resultado.calOk = cal && cal.total != null;
    }
    return resultado;
  }, r => `${modo === 'completo' ? 'Carga completa concluída' : 'Atualização concluída'}: ${r.novas.length} ato(s) novo(s) com datas` +
    (r.falhas.length ? `; ${r.falhas.length} matéria(s) não abriram (use "Tentar as que falharam").` : '.') +
    (r.calOk ? '' : ' O calendário do TJCE não respondeu desta vez.'));
  // Avança a "última atualização" só quando a rodada terminou bem; senão a próxima retroage a partir da anterior.
  if (resultado && !estado.controle.signal.aborted && resultado.calOk && !(resultado.pesquisasComFalha > 0)) {
    await chrome.storage.local.set({ ultimaAtualizacao: { quando: inicio, modo, novas: resultado.novas.length, falhas: resultado.falhas.length } });
  }
  desenharUltima();
}

async function desenharUltima() {
  const { ultimaAtualizacao: u } = await chrome.storage.local.get('ultimaAtualizacao');
  const el = $('#ultimaAtualizacao');
  if (!el) return;
  el.textContent = u
    ? `Última atualização: ${new Date(u.quando).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} (${u.modo === 'completo' ? 'carga completa' : 'atualização'}). A próxima busca começa daí.`
    : 'Nenhuma atualização registrada ainda: a primeira busca percorre tudo.';
}

function repetirFalhas() {
  if (!estado.falhas.length) return;
  const cfg = lerConfig();
  return executar(() => processarLista(estado.falhas, { ...ganchosDeColeta(), conexoes: cfg.conexoes, ano: cfg.ano, forcar: true }), textoResultado);
}

function varrer() {
  const ini = +$('#idIni').value, fim = +$('#idFim').value;
  if (!ini || !fim || fim < ini) { log('Informe uma faixa válida (início ≤ fim).'); return; }
  if (fim - ini > 20000 && !confirm(`São ${fim - ini + 1} matérias. Isso pode levar bastante tempo. Continuar?`)) return;
  const cfg = lerConfig();
  salvarConfig();
  const ids = Array.from({ length: fim - ini + 1 }, (_, k) => ini + k);
  return executar(() => processarLista(ids, { ...ganchosDeColeta(), conexoes: cfg.conexoes, ano: cfg.ano }), textoResultado);
}

// ---------- busca automática ----------
async function carregarAuto() {
  const { auto = {} } = await chrome.storage.local.get('auto');
  $('#autoAtivo').checked = !!auto.ativo;
  $('#autoHora').value = auto.hora || '07:00';
  desenharAuto(auto);
}

function desenharAuto(auto) {
  const u = auto.ultima;
  let txt = auto.ativo ? `Atualização agendada para todo dia às ${auto.hora || '07:00'}.` : 'Desligada.';
  if (u) {
    const quando = new Date(u.quando).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    txt += ` Última execução: ${quando} — ${u.erro ? `erro: ${u.erro}` :
      `${u.novas} portaria(s) nova(s), ${u.novasDatasComarcas} data(s) nas comarcas${u.falhas ? `, ${u.falhas} falha(s)` : ''}`}.`;
  }
  $('#autoStatus').textContent = txt;
}

async function salvarAuto() {
  const { auto = {} } = await chrome.storage.local.get('auto');
  const novo = { ...auto, ativo: $('#autoAtivo').checked, hora: $('#autoHora').value || '07:00' };
  await chrome.storage.local.set({ auto: novo });
  await chrome.runtime.sendMessage({ alvo: 'background', cmd: 'reagendar' });
  desenharAuto(novo);
}

async function rodarAutoAgora() {
  $('#btnAutoAgora').disabled = true;
  $('#autoStatus').textContent = 'Busca automática iniciada em segundo plano. Você pode fechar esta aba.';
  await chrome.runtime.sendMessage({ alvo: 'background', cmd: 'coletarAgora' });
  setTimeout(() => { $('#btnAutoAgora').disabled = false; }, 5000);
}

// Quando a busca automática grava algo, a tela recarrega os dados.
function ouvirMudancas() {
  let t = null;
  chrome.storage.onChanged.addListener((mud, area) => {
    if (area !== 'local') return;
    if (mud.auto) desenharAuto(mud.auto.newValue || {});
    if (mud.ultimaAtualizacao) desenharUltima();
    if (mud.calendarioTJCE) { estado.calTJCE = mud.calendarioTJCE.newValue || null; desenhar(); }
    if (mud.calTela && mud.calTela.newValue?.length) {
      const tela = datasDaTela(mud.calTela.newValue);
      if (tela.length) { estado.calTJCE = mesclarCalendario(estado.calTJCE, tela, estado.calTJCE?.fonte || { tipo: 'tela' }); chrome.storage.local.set({ calendarioTJCE: estado.calTJCE }); }
    }
    if (mud.cadastroJuizes && mud.cadastroJuizes.newValue && linhaEditando === null) { estado.cadastro = mud.cadastroJuizes.newValue; desenharJuizes(); }
    const origemTrava = mud.coletaEmAndamento && (mud.coletaEmAndamento.newValue || mud.coletaEmAndamento.oldValue)?.origem;
    if (origemTrava === 'automatica' && !estado.coletando) {
      const rodando = !!mud.coletaEmAndamento.newValue;
      $('#btnBuscar').disabled = rodando;
      $('#btnAtualizar').disabled = rodando;
      if (rodando) progresso(0, 0, 'Busca automática em andamento…');
      else progresso(1, 1, 'Busca automática concluída.');
    }
    if ((mud.materias || mud.falhas || mud.atosMag) && !estado.coletando) {
      clearTimeout(t);
      t = setTimeout(async () => {
        const d = await chrome.storage.local.get(['materias', 'falhas', 'maiorId', 'atosMag']);
        estado.materias = d.materias || {};
        estado.atosMag = d.atosMag || {};
        estado.falhas = d.falhas || [];
        estado.maiorId = d.maiorId || 0;
        desenhar();
      }, 800);
    }
  });
}

async function analisarUma() {
  const v = $('#umaMateria').value.trim();
  const id = +((v.match(/materias\/(\d+)/) || [])[1] || v.replace(/\D/g, ''));
  const saida = $('#resultadoUma');
  saida.hidden = false;
  if (!id) { saida.textContent = 'Informe um ID numérico ou o link da matéria.'; return; }
  saida.textContent = `Baixando matéria ${id}…`;
  try {
    const texto = await baixarMateria(id);
    if (!texto) { saida.textContent = `A matéria ${id} não existe ou não abriu.`; return; }
    const r = analisarTexto(texto, { id, anoPadrao: lerConfig().ano });
    const linhas = [
      `${r.titulo}`, `Local: ${r.local}`, `Disponibilizada: ${r.disponibilizada}`,
      `Relevante: ${r.relevante ? 'sim' : 'não'}`, ''
    ];
    for (const d of r.datas) linhas.push(`${br(d.data)}  ${d.tipo}  ${d.municipios.join(', ') || '(todo o Estado)'}  [${d.origem}]\n   ${d.trecho}`);
    const m = analisarMagistrados(texto, { id, anoPadrao: lerConfig().ano });
    linhas.push('', `Juízes (comarcas de trabalho): ${m.eventos.length} designação(ões)/férias, ${m.lotacoes.length} lotação(ões)`);
    for (const e of m.eventos) {
      linhas.push(`${e.inicio ? brC(e.inicio) : '?'} a ${e.fim ? brC(e.fim) : '?'}  ${e.comarca || '?'} — ${e.unidade || '?'}: ${e.motivo.toLowerCase()}` +
        `${e.ausente ? ` de ${e.ausente}` : ''}, responde ${e.substituto || '?'}`);
    }
    saida.textContent = linhas.join('\n');
    if (r.relevante || m.relevante) {
      if (r.relevante) estado.materias[id] = { ...r, texto, v: PARSER_VERSION };
      else if (!(id in estado.materias)) estado.materias[id] = 0;
      estado.atosMag[id] = m.relevante ? { ...m, texto: (m.eventos.length || m.lotacoes.length) ? texto : undefined, v: MAG_VERSION } : 0;
      if (id > estado.maiorId) estado.maiorId = id;
      await salvar(true);
      desenhar();
    }
  } catch (e) {
    saida.textContent = `Erro: ${e.message}`;
  }
}

async function reanalisar() {
  let n = 0;
  for (const [id, r] of Object.entries(estado.materias)) {
    if (r && r.texto) {
      const novo = analisarTexto(r.texto, { id: +id });
      estado.materias[id] = novo.relevante ? { ...novo, texto: r.texto, v: PARSER_VERSION } : 0;
      n++;
    }
  }
  for (const [id, r] of Object.entries(estado.atosMag)) {
    if (r && r.texto) {
      const novo = analisarMagistrados(r.texto, { id: +id });
      estado.atosMag[id] = novo.relevante ? { ...novo, texto: (novo.eventos.length || novo.lotacoes.length) ? r.texto : undefined, v: MAG_VERSION } : 0;
      n++;
    }
  }
  await salvar(true);
  log(`${n} análise(s) refeita(s).`);
  desenhar();
}

async function limpar() {
  if (!confirm('Apagar todas as matérias salvas? A configuração é mantida.')) return;
  estado.materias = {};
  estado.atosMag = {};
  estado.maiorId = 0;
  estado.falhas = [];
  await salvar(true);
  desenhar();
}

// ---------- dados derivados ----------
function todasAsLinhas() {
  const out = [];
  const vistas = new Set();
  for (const r of Object.values(estado.materias)) {
    if (!r || !r.relevante) continue;
    for (const d of r.datas) {
      const munis = d.municipios.length ? d.municipios : [''];
      for (const m of munis) {
        const chave = `${d.data}|${m}|${r.id}`;
        if (vistas.has(chave)) continue;
        vistas.add(chave);
        const tipo = d.prazos === 'correm' ? 'Prazos não suspensos' : d.tipo;
        out.push({ data: d.data, municipio: m, tipo, tipoAto: d.tipo, prazos: d.prazos || null, unidade: d.unidade || null, trecho: d.trecho, origem: d.origem,
          titulo: r.titulo, numero: r.numero, url: r.url, disponibilizada: r.disponibilizada, id: r.id });
      }
    }
  }
  // Calendário Eletrônico do TJCE: entra quando o DJEA não trouxe a mesma data para o mesmo município.
  const doDjea = new Set(out.map(l => `${l.data}|${l.municipio}`));
  for (const d of estado.calTJCE?.datas || []) {
    for (const m of d.municipios.length ? d.municipios : ['']) {
      if (doDjea.has(`${d.data}|${m}`)) continue;
      doDjea.add(`${d.data}|${m}`);
      out.push({ data: d.data, municipio: m, tipo: d.prazos === 'correm' ? 'Prazos não suspensos' : d.tipo, tipoAto: d.tipo,
        prazos: d.prazos || null, unidade: null, trecho: d.trecho, origem: 'calendario', titulo: d.titulo,
        numero: 'Calendário TJCE', url: URL_CALENDARIO, disponibilizada: '', id: `cal-${d.data}-${m}` });
    }
  }
  return out.sort((a, b) => a.data.localeCompare(b.data) || a.municipio.localeCompare(b.municipio, 'pt-BR'));
}

// Linhas da aba de feriados: DJEA + calendário-base (nacionais/estaduais) do ano em tela.
// Datas gerais já lidas no DJEA têm prioridade (trazem o link do ato).
function linhasDaTela() {
  const djea = todasAsLinhas();
  const geraisDjea = new Set(djea.filter(l => !l.municipio).map(l => l.data));
  const base = calendarioBase(estado.filtro.ano)
    .filter(b => !geraisDjea.has(b.data))
    .map(b => ({ data: b.data, municipio: '', tipo: b.tipo, trecho: b.motivo, origem: 'base',
      titulo: b.fonte, numero: 'Calendário-base', url: '', disponibilizada: '', id: 'base-' + b.data }));
  return [...djea, ...base].sort((a, b) => a.data.localeCompare(b.data) || a.municipio.localeCompare(b.municipio, 'pt-BR'));
}

function municipiosDaComarca(sede) {
  if (!sede) return new Set(COMARCA_DO_MUNICIPIO.keys());
  const c = COMARCAS.find(x => x.sede === sede);
  return new Set([c.sede, ...c.vinculadas]);
}

function filtrar(linhas, { ignorarDia = false } = {}) {
  const f = estado.filtro;
  const permitidos = municipiosDaComarca(f.comarca);
  const busca = fold(f.busca.trim());
  return linhas.filter(l =>
    l.data.startsWith(String(f.ano)) &&
    (l.municipio ? permitidos.has(l.municipio) : f.gerais) &&
    (!f.tipo || l.tipo === f.tipo) &&
    (!busca || fold(l.trecho + ' ' + l.titulo).includes(busca)) &&
    (ignorarDia || !f.dia || l.data === f.dia));
}

const br = iso => iso.split('-').reverse().join('/');
const semanaDe = iso => SEMANA[new Date(iso + 'T12:00:00').getDay()];

// ---------- desenho ----------
function desenhar() {
  desenharJuizes();
  desenharCalendarioInfo();
  const todas = linhasDaTela();
  const anos = [...new Set(todas.map(l => +l.data.slice(0, 4)))];
  if (!anos.includes(estado.filtro.ano)) anos.push(estado.filtro.ano);
  anos.sort();
  const sel = $('#fAno');
  sel.innerHTML = anos.map(a => `<option ${a === estado.filtro.ano ? 'selected' : ''}>${a}</option>`).join('');

  const semDia = filtrar(todas, { ignorarDia: true });
  const visiveis = filtrar(todas);
  desenharNumeros(todas);
  desenharAno(semDia);
  desenharTabela(visiveis);

  const atos = Object.values(estado.materias).filter(r => r && r.relevante).length;
  const total = Object.keys(estado.materias).length;
  $('#infoCache').textContent = `${total} matérias já lidas, ${atos} com datas de expediente.`;
  $('#maiorId').textContent = estado.maiorId ? `Maior ID já visto: ${estado.maiorId}` : '';
  const nf = estado.falhas.length;
  $('#avisoFalhas').hidden = !nf;
  $('#avisoFalhas span').textContent = `${nf} matéria(s) não abriram na última coleta.`;
}

function desenharNumeros(todas) {
  const permitidos = municipiosDaComarca(estado.filtro.comarca);
  const doAno = todas.filter(l => l.data.startsWith(String(estado.filtro.ano)) && permitidos.has(l.municipio));
  const munis = new Set(doAno.map(l => l.municipio));
  const atos = new Set(doAno.map(l => l.id));
  $('#numeros').innerHTML = [
    [doAno.length, `datas municipais em ${estado.filtro.ano}`],
    [munis.size, 'municípios com datas'],
    [atos.size, 'atos']
  ].map(([n, r]) => `<div><dt>${r}</dt><dd>${n}</dd></div>`).join('');
}

function desenharAno(linhas) {
  const f = estado.filtro;
  const porDia = new Map();
  for (const l of linhas) {
    if (!porDia.has(l.data)) porDia.set(l.data, []);
    porDia.get(l.data).push(l);
  }
  $('#tituloAno').innerHTML = `${f.ano}${f.comarca ? `<small>Comarca de ${esc(f.comarca)}</small>` : ''}`;
  const meses = $('#meses');
  meses.innerHTML = '';
  for (let m = 0; m < 12; m++) {
    const caixa = document.createElement('div');
    caixa.className = 'mes';
    const primeiro = new Date(f.ano, m, 1).getDay();
    const diasNoMes = new Date(f.ano, m + 1, 0).getDate();
    let html = `<h3>${MESES_NOME[m]}</h3><div class="grade">` +
      SEMANA.map(s => `<span class="sem">${s[0]}</span>`).join('') +
      '<span></span>'.repeat(primeiro);
    for (let d = 1; d <= diasNoMes; d++) {
      const iso = `${f.ano}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const fds = [0, 6].includes(new Date(f.ano, m, d).getDay());
      const itens = porDia.get(iso);
      if (itens) {
        const tipos = [...new Set(itens.map(i => i.tipo))];
        const cores = tipos.map(t => CORES[t] || 'var(--outro)');
        const fundo = cores.length === 1 ? cores[0]
          : `linear-gradient(135deg, ${cores.map((c, i) => `${c} ${i / cores.length * 100}% ${(i + 1) / cores.length * 100}%`).join(', ')})`;
        const munis = [...new Set(itens.map(i => i.municipio || 'Todo o Estado'))];
        const dica = `${br(iso)}\n${tipos.join(', ')}\n${munis.slice(0, 12).join(', ')}${munis.length > 12 ? ` e mais ${munis.length - 12}` : ''}`;
        html += `<button class="dia marcado${f.dia === iso ? ' ativo' : ''}" style="background:${fundo}" data-dia="${iso}" title="${esc(dica)}" aria-label="${esc(dica)}">${d}</button>`;
      } else {
        html += `<span class="dia${fds ? ' fds' : ''}">${d}</span>`;
      }
    }
    caixa.innerHTML = html + '</div>';
    meses.appendChild(caixa);
  }
  const aviso = $('#diaAtivo');
  if (f.dia) {
    aviso.hidden = false;
    aviso.innerHTML = `Mostrando só ${br(f.dia)} (${semanaDe(f.dia)}). <button id="btnTodosDias">Ver o ano todo</button>`;
  } else aviso.hidden = true;
}

function desenharTabela(linhas) {
  const corpo = $('#tabela tbody');
  const MAX = 1500;
  corpo.innerHTML = linhas.slice(0, MAX).map(l => `
    <tr>
      <td class="data">${br(l.data)}<small>${semanaDe(l.data)}</small></td>
      <td class="muni${l.municipio ? '' : ' geral'}">${esc(l.municipio || 'Todo o Estado')}${rotuloVinculo(l.municipio)}${l.unidade ? `<span class="origem">só ${esc(l.unidade)}</span>` : ''}</td>
      <td><span class="selo ${CLASSE_TIPO[l.tipo] || 't-outro'}">${esc(l.tipo)}</span>
        ${l.origem === 'ementa' ? '<span class="origem" title="O município foi lido do cabeçalho do ato, não da mesma frase da data.">município pelo cabeçalho</span>' : ''}</td>
      <td class="ato">${l.url ? `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.numero || l.titulo || 'Matéria ' + l.id)}</a><small>${l.origem === 'calendario' ? 'Calendário eletrônico' : 'DJEA ' + esc((l.disponibilizada || '').slice(0, 10))}</small>` : `${esc(l.numero)}<small>${esc(l.titulo)}</small>`}</td>
      <td class="trecho">${esc(l.trecho)}</td>
    </tr>`).join('');
  const vazio = $('#vazio');
  if (!linhas.length) {
    vazio.hidden = false;
    const nada = !Object.values(estado.materias).some(r => r && r.relevante);
    vazio.textContent = nada
      ? 'Nenhuma portaria analisada ainda. Escolha o ano do ato e clique em "Buscar no DJEA".'
      : 'Nenhuma data com esses filtros. Tente outro ano, outra comarca ou marque "Incluir feriados nacionais e estaduais".';
  } else {
    vazio.hidden = linhas.length <= MAX;
    if (linhas.length > MAX) vazio.textContent = `Mostrando ${MAX} de ${linhas.length} linhas. Filtre por município ou exporte para ver tudo.`;
  }
}

function rotuloVinculo(m) {
  const c = COMARCA_DO_MUNICIPIO.get(m);
  return c && c.vinculada ? `<span class="origem">vinculado a ${esc(c.comarca)}</span>` : '';
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- exportação ----------
function baixar(nome, conteudo, tipo) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = Object.assign(document.createElement('a'), { href: url, download: nome });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const nomeArquivo = ext => `feriados-municipais-tjce-${estado.filtro.ano}${estado.filtro.comarca ? '-' + fold(estado.filtro.comarca).replace(/\W+/g, '-') : ''}.${ext}`;

function exportarCsv() {
  const linhas = filtrar(linhasDaTela());
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = ['data;dia_semana;municipio;unidade;tipo;ato;disponibilizada;link;trecho',
    ...linhas.map(l => [br(l.data), semanaDe(l.data), l.municipio || 'Todo o Estado', l.unidade || '', l.tipo, l.numero || l.titulo,
      l.disponibilizada, l.url, l.trecho].map(q).join(';'))].join('\r\n');
  baixar(nomeArquivo('csv'), '\ufeff' + csv, 'text/csv;charset=utf-8');
}

function exportarJson() {
  const linhas = filtrar(linhasDaTela());
  const porMunicipio = {};
  for (const l of linhas) {
    const k = l.municipio || 'Todo o Estado';
    (porMunicipio[k] ||= []).push({ data: l.data, tipo: l.tipo, ato: l.numero || l.titulo, link: l.url });
  }
  baixar(nomeArquivo('json'), JSON.stringify({ geradoEm: new Date().toISOString(), ano: estado.filtro.ano, porMunicipio }, null, 2), 'application/json');
}

function exportarIcs() {
  const linhas = filtrar(linhasDaTela());
  const e = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const dobra = l => l.length <= 74 ? l : l.match(/.{1,74}/g).join('\r\n ');
  const agora = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const eventos = linhas.map(l => {
    const ini = l.data.replace(/-/g, '');
    const fim = new Date(new Date(l.data + 'T12:00:00Z').getTime() + 864e5).toISOString().slice(0, 10).replace(/-/g, '');
    return ['BEGIN:VEVENT',
      `UID:${ini}-${fold(l.municipio || 'estado').replace(/\W+/g, '')}-${l.id}@feriados-tjce`,
      `DTSTAMP:${agora}`, `DTSTART;VALUE=DATE:${ini}`, `DTEND;VALUE=DATE:${fim}`,
      `SUMMARY:${e(`${l.tipo} — ${l.municipio || 'Todo o Estado'}`)}`,
      `DESCRIPTION:${e(`${l.numero || l.titulo}\n${l.trecho}\n${l.url}`)}`,
      `URL:${l.url}`, 'TRANSP:TRANSPARENT', 'END:VEVENT'].map(dobra).join('\r\n');
  });
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Feriados municipais TJCE//DJEA//PT-BR',
    'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Feriados municipais TJCE', ...eventos, 'END:VCALENDAR'].join('\r\n');
  baixar(nomeArquivo('ics'), ics, 'text/calendar;charset=utf-8');
}


// ---------- juízes ----------
const normNum = n => { const m = String(n || '').match(/(\d+)\s*\/\s*(\d{4})/); return m ? `${+m[1]}/${m[2]}` : null; };
const brC = iso => iso ? iso.split('-').reverse().join('/') : '?';
const brCurto = iso => iso ? brC(iso).slice(0, 5) : '?';
const ativoEm = (e, d) => (e.inicio ? e.inicio <= d : (e.dataPublicacao || '') <= d) && (!e.fim || e.fim >= d);

/** Eventos e lotações lidos do DJEA, já sem os atos revogados. */
function dadosJuizes() {
  const regs = Object.values(estado.atosMag).filter(r => r && r.relevante);
  const cancelados = new Set(regs.flatMap(r => r.cancela || []));
  const porJuiz = new Map();
  for (const r of regs) {
    for (const l of r.lotacoes || []) {
      const k = chaveNome(l.nome), atual = porJuiz.get(k);
      if (!atual || (r.dataPublicacao || '') > (atual.data || '')) porJuiz.set(k, { ...l, data: r.dataPublicacao, numero: r.numero, url: r.url });
    }
  }
  const eventos = [];
  for (const r of regs) {
    if (cancelados.has(normNum(r.numero))) continue;
    for (const e of r.eventos || []) eventos.push({ ...e, numero: r.numero, url: r.url, dataPublicacao: r.dataPublicacao, id: r.id });
  }
  const unicos = new Map();
  for (const e of eventos.sort((a, b) => (a.dataPublicacao || '').localeCompare(b.dataPublicacao || ''))) {
    unicos.set([e.comarca, chaveUnidade(e.unidade), e.inicio, e.fim, chaveNome(e.substituto)].join('|'), e);
  }
  return { lotacoes: [...porJuiz.values()], eventos: [...unicos.values()] };
}

/** Compara uma linha do cadastro com o que foi lido do DJEA. */
function conferir(u, dia, dj, unicaNaComarca) {
  const k = chaveUnidade(u.unidade);
  const casa = x => x.comarca === u.comarca && (chaveUnidade(x.unidade) === k || (unicaNaComarca && /unica|outra/.test(chaveUnidade(x.unidade))));
  const sit = situacaoUnidade(u, dia, estado.cadastro.atualizadoEm);
  const ativos = dj.eventos.filter(e => casa(e) && ativoEm(e, dia)).sort((a, b) => (b.dataPublicacao || '').localeCompare(a.dataPublicacao || ''));
  const lot = dj.lotacoes.filter(casa).sort((a, b) => (b.data || '').localeCompare(a.data || ''))[0];
  const link = x => x?.url ? ` <a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(normNum(x.numero) || 'ato')}</a>` : '';
  const comAfastamento = sit.estado === 'afastado' || sit.estado === 'vaga';
  // Unidade sem titular cadastrado: o DJEA sugere o titular (botão "Usar").
  const sugestao = !u.titular && lot && sit.estado === 'nao-cadastrado' ? lot.nome : null;
  const sug = sugestao ? `${esc(sugestao)} (${brC(lot.data)})${link(lot)} <button class="usar" data-usar="${u.i}" data-nome="${esc(sugestao)}">Usar</button>` : '';
  const e = ativos[0];
  if (e) {
    if (comAfastamento && u.responde && e.substituto && mesmoJuiz(u.responde, e.substituto)) return { cls: 'ok', html: `Confere${link(e)}` };
    if (comAfastamento) return { cls: 'diverge', html: `DJEA: responde ${esc(e.substituto || '?')}${link(e)}` };
    const oque = e.motivo === 'Não informado' ? 'designação' : e.motivo.toLowerCase();
    return { cls: 'diverge', sugestao,
      html: `DJEA: ${esc(oque)}${e.ausente ? ` de ${esc(e.ausente)}` : ''} até ${brCurto(e.fim)}, responde ${esc(e.substituto || '?')}${link(e)}` +
        (sug ? `<br>Titular segundo o DJEA: ${sug}` : '') };
  }
  // Nada em curso na data: confere designações futuras (afastamento previsto ou ainda não cadastrado).
  const futuros = dj.eventos.filter(x => casa(x) && x.inicio && x.inicio > dia).sort((a, b) => a.inicio.localeCompare(b.inicio));
  const per = x => `${brCurto(x.inicio)} a ${brCurto(x.fim)}`;
  if (sit.estado === 'previsto') {
    const p = sit.periodo;
    const sobrepoe = x => (!p.fim || x.inicio <= p.fim) && (!x.fim || !p.inicio || x.fim >= p.inicio);
    const f = futuros.find(sobrepoe);
    if (f) {
      const mesmoPeriodo = f.inicio === p.inicio && (!p.fim || f.fim === p.fim);
      if (u.responde && f.substituto && mesmoJuiz(u.responde, f.substituto)) {
        return { cls: 'ok', html: `Confere${mesmoPeriodo ? '' : ` (DJEA: ${per(f)})`}${link(f)}` };
      }
      return { cls: 'diverge', html: `DJEA: ${per(f)}, responde ${esc(f.substituto || '?')}${link(f)}` };
    }
    return { cls: '', html: 'Nenhum ato lido para este período' };
  }
  if (futuros.length && !comAfastamento) {
    const f = futuros[0];
    const oque = f.motivo === 'Não informado' ? 'designação' : f.motivo.toLowerCase();
    return { cls: 'diverge', sugestao,
      html: `DJEA (previsto): ${esc(oque)}${f.ausente ? ` de ${esc(f.ausente)}` : ''} ${per(f)}, responde ${esc(f.substituto || '?')}${link(f)}` +
        (sug ? `<br>Titular segundo o DJEA: ${sug}` : '') };
  }
  if (lot && u.titular && !mesmoJuiz(lot.nome, u.titular)) return { cls: 'diverge', html: `DJEA aponta titular ${esc(lot.nome)} (${brC(lot.data)})${link(lot)}` };
  if (sugestao) return { cls: 'sugere', sugestao, html: `DJEA: titular ${sug}` };
  if (comAfastamento) return { cls: '', html: 'Nenhum ato lido para este período' };
  if (lot && u.titular) return { cls: 'ok', html: `Titular confere${link(lot)}` };
  return { cls: '', html: '—' };
}

function textoSituacao(u, dia) {
  const s = situacaoUnidade(u, dia, estado.cadastro.atualizadoEm);
  const p = s.periodo || {};
  // dd/mm, com o ano quando for outro que não o da data consultada
  const brCurto = iso => iso ? (iso.slice(0, 4) === dia.slice(0, 4) ? brC(iso).slice(0, 5) : brC(iso)) : '?';
  const ate = p.indeterminado ? 'tempo indeterminado' : p.fim ? `até ${brCurto(p.fim)}` : '';
  const de = p.inicio && p.fim ? `${brCurto(p.inicio)} a ${brCurto(p.fim)}` : ate;
  return {
    estado: s.estado,
    html: {
      'exercicio': 'Em exercício',
      'afastado': `Afastado <small>${esc(de)}</small>`,
      'vaga': `Sem titular <small>${esc(ate)}</small>`,
      'previsto': `Afastamento previsto <small>${esc(de)}</small>`,
      'encerrado': `Em exercício <small>(afastamento até ${brCurto(p.fim)} encerrado)</small>`,
      'nao-cadastrado': 'Não cadastrado'
    }[s.estado]
  };
}

let linhaEditando = null; // índice no cadastro, ou 'nova'
let sugestoes = [];       // titulares sugeridos pelo DJEA para unidades sem titular cadastrado

function desenharJuizes() {
  if (!$('#jData').value) $('#jData').value = new Date().toLocaleDateString('sv-SE');
  const dia = $('#jData').value;
  const filtroCom = $('#jComarca').value;
  const filtroArea = $('#jArea').value;
  const naArea = unidade => { const a = areaUnidade(unidade); return !filtroArea || a === 'misto' || a === filtroArea; };
  const dj = dadosJuizes();
  sugestoes = [];
  const porComarca = new Map();
  for (const u of estado.cadastro.unidades) porComarca.set(u.comarca, (porComarca.get(u.comarca) || 0) + 1);
  // Varas únicas primeiro; depois cada comarca com várias varas, na ordem em que aparecem no cadastro.
  const ordemComarca = [...new Set(estado.cadastro.unidades.map(u => u.comarca))];
  const unidades = estado.cadastro.unidades.map((u, i) => ({ ...u, i }))
    .filter(u => (!filtroCom || u.comarca === filtroCom) && naArea(u.unidade))
    .sort((a, b) => {
      const ma = porComarca.get(a.comarca) > 1, mb = porComarca.get(b.comarca) > 1;
      if (ma !== mb) return ma ? 1 : -1;
      if (ma) return ordemComarca.indexOf(a.comarca) - ordemComarca.indexOf(b.comarca) || a.i - b.i;
      return a.i - b.i;
    });

  let linhas = '', grupoAtual = null, nAfast = 0, nVaga = 0, nDiv = 0, nPrev = 0;
  // Comarcas de vara única ficam juntas; as de várias varas ganham um subtítulo.
  for (const u of unidades) {
    const multi = porComarca.get(u.comarca) > 1;
    const grupo = multi ? u.comarca : (filtroArea ? 'Varas únicas (competência cível e criminal)' : 'Varas únicas');
    if (grupo !== grupoAtual && (filtroCom === '' || multi)) { linhas += `<tr class="grupo"><td colspan="6">${esc(grupo)}</td></tr>`; grupoAtual = grupo; }
    if (linhaEditando === u.i) { linhas += linhaEdicao(u); continue; }
    const vinc = COMARCAS.find(c => c.sede === u.comarca)?.vinculadas || [];
    const sit = textoSituacao(u, dia);
    const conf = conferir(u, dia, dj, porComarca.get(u.comarca) === 1);
    if (sit.estado === 'afastado') nAfast++;
    if (sit.estado === 'vaga') nVaga++;
    if (sit.estado === 'previsto') nPrev++;
    if (conf.cls === 'diverge') nDiv++;
    if (conf.sugestao) sugestoes.push({ i: u.i, nome: conf.sugestao });
    const ausente = sit.estado === 'afastado';
    linhas += `<tr>
      <td><span class="uni">${esc(multi ? u.unidade : u.comarca)}</span>${multi ? '' : `<span class="vinc">${esc(u.unidade)}${vinc.length ? ' · ' + esc(vinc.join(', ')) : ''}</span>`}</td>
      <td>${u.titular ? `<span class="${ausente ? 'riscado' : ''}">${esc(u.titular)}</span>` : '<span class="vazio-cel">—</span>'}</td>
      <td><span class="estado ${sit.estado}">${sit.html}</span></td>
      <td>${['afastado', 'vaga', 'previsto'].includes(sit.estado) && u.responde ? esc(u.responde) : '<span class="vazio-cel">—</span>'}</td>
      <td><span class="conf ${conf.cls}">${conf.html}</span></td>
      <td><button class="editar" data-editar="${u.i}" title="Editar">Editar</button></td>
    </tr>`;
  }
  if (linhaEditando === 'nova') linhas += linhaEdicao({ i: 'nova', comarca: filtroCom || COMARCAS[0].sede, unidade: '', titular: '', periodo: '', responde: '' });
  $('#tabelaUnid tbody').innerHTML = linhas;

  const partes = [];
  if (nAfast) partes.push(`${nAfast} com titular afastado`);
  if (nVaga) partes.push(`${nVaga} sem titular`);
  if (nPrev) partes.push(`${nPrev} com afastamento previsto`);
  partes.push(nDiv ? `${nDiv} divergência(s) com o DJEA` : 'nenhuma divergência com o DJEA');
  if (sugestoes.length) partes.push(`${sugestoes.length} titular(es) sugerido(s) pelo DJEA`);
  const bs = $('#btnUsarSugestoes');
  bs.hidden = !sugestoes.length;
  bs.textContent = `Preencher ${sugestoes.length} titular(es) com o DJEA`;
  $('#jResumo').textContent = `${brC(dia)}: ${partes.join(' · ')}.`;
  $('#jAtualizado').textContent = `Cadastro atualizado em ${brC(estado.cadastro.atualizadoEm)}.` + (estado.avisoCadastro ? ' ' + estado.avisoCadastro : '') + (estado.avisoReleitura ? ' ' + estado.avisoReleitura : '');

  // Designações lidas no DJEA
  const mostrar = $('#jMostrar').value;
  let lista = dj.eventos.filter(e => (!filtroCom || e.comarca === filtroCom) && naArea(e.unidade));
  $('#jQtd').textContent = `(${lista.length})`;
  if (mostrar === 'atuais') lista = lista.filter(e => !e.fim || e.fim >= dia).sort((a, b) => (a.inicio || '').localeCompare(b.inicio || ''));
  else lista.sort((a, b) => (b.inicio || '').localeCompare(a.inicio || ''));
  $('#tabelaJuiz tbody').innerHTML = lista.map(e => `<tr class="${ativoEm(e, dia) ? 'em-curso' : ''}">
      <td class="periodo">${brC(e.inicio)} a ${brC(e.fim)}</td>
      <td><b>${esc(e.comarca)}</b><span class="origem">${esc(e.unidade)}</span></td>
      <td>${esc(e.motivo)}</td>
      <td>${esc(e.ausente || '—')}</td>
      <td>${e.substituto ? esc(e.substituto) + (e.substitutoLotacao ? `<span class="origem">titular de ${esc(e.substitutoLotacao.unidade)}</span>` : '') : '—'}</td>
      <td class="ato"><a href="${esc(e.url)}" target="_blank" rel="noopener" title="${esc(e.trecho)}">${esc(e.numero || 'Matéria ' + e.id)}</a><small>DJEA ${brC(e.dataPublicacao)}</small></td>
    </tr>`).join('');
  const vazio = $('#jVazio');
  vazio.hidden = lista.length > 0;
  vazio.textContent = dj.eventos.length ? 'Nenhuma designação com esses filtros.' :
    'Nenhuma portaria de férias ou designação lida ainda. Rode a coleta com "Coletar também férias e designações de juízes" marcado.';
}

function linhaEdicao(u) {
  const opcoes = COMARCAS.map(c => `<option ${c.sede === u.comarca ? 'selected' : ''}>${esc(c.sede)}</option>`).join('');
  return `<tr class="editando" data-linha="${u.i}">
    <td><select data-campo="comarca">${opcoes}</select>
        <input data-campo="unidade" value="${esc(u.unidade)}" placeholder="Vara Única, 1ª Vara Cível…" style="margin-top:6px"></td>
    <td><input data-campo="titular" value="${esc(u.titular)}" placeholder="Vazio se a unidade estiver sem titular"></td>
    <td><input data-campo="periodo" value="${esc(u.periodo)}" placeholder="Vazio se em exercício">
        <div class="dica">Ex.: 14/09 a 03/10 · Até 28/02/2027 · Tempo indeterminado</div></td>
    <td><input data-campo="responde" value="${esc(u.responde)}" placeholder="Quem responde"></td>
    <td colspan="2"><div class="acoes-linha">
      <button class="primario" data-acao="salvar">Salvar</button>
      <button data-acao="cancelar">Cancelar</button>
      ${u.i !== 'nova' ? '<button class="perigo" data-acao="excluir">Excluir</button>' : ''}
    </div></td></tr>`;
}

async function salvarCadastro() {
  estado.cadastro.atualizadoEm = new Date().toLocaleDateString('sv-SE');
  await chrome.storage.local.set({ cadastroJuizes: estado.cadastro });
}

async function usarSugestoes(lista) {
  for (const { i, nome } of lista) if (estado.cadastro.unidades[i] && !estado.cadastro.unidades[i].titular) estado.cadastro.unidades[i].titular = nome;
  await salvarCadastro();
  desenharJuizes();
}

async function acaoTabelaUnid(ev) {
  const us = ev.target.closest('[data-usar]');
  if (us) { await usarSugestoes([{ i: +us.dataset.usar, nome: us.dataset.nome }]); return; }
  const ed = ev.target.closest('[data-editar]');
  if (ed) { linhaEditando = +ed.dataset.editar; desenharJuizes(); $('#tabelaUnid tr.editando input[data-campo="titular"]')?.focus(); return; }
  const b = ev.target.closest('[data-acao]');
  if (!b) return;
  const tr = b.closest('tr');
  const idx = tr.dataset.linha === 'nova' ? 'nova' : +tr.dataset.linha;
  if (b.dataset.acao === 'cancelar') { linhaEditando = null; desenharJuizes(); return; }
  if (b.dataset.acao === 'excluir') {
    if (!confirm('Excluir esta unidade do cadastro?')) return;
    estado.cadastro.unidades.splice(idx, 1);
  } else {
    const v = {};
    tr.querySelectorAll('[data-campo]').forEach(el => { v[el.dataset.campo] = el.value.trim(); });
    if (!v.unidade) { tr.querySelector('[data-campo="unidade"]').focus(); return; }
    if (v.periodo && !lerPeriodo(v.periodo, new Date().toISOString()) ) {
      alert('Não entendi o período. Use, por exemplo: 14/09 a 03/10, Até 28/02/2027 ou Tempo indeterminado.');
      return;
    }
    if (idx === 'nova') estado.cadastro.unidades.push(v); else estado.cadastro.unidades[idx] = v;
  }
  linhaEditando = null;
  await salvarCadastro();
  desenharJuizes();
}

// ---------- calendário eletrônico do TJCE ----------
function desenharCalendarioInfo() {
  if (estado.importandoCal) return; // não troca a mensagem de progresso no meio da importação
  const c = estado.calTJCE;
  const el = $('#calInfo');
  if (!el) return;
  if (!c || !c.datas?.length) { el.textContent = 'Nenhuma data importada ainda.'; return; }
  const munis = new Set(c.datas.flatMap(d => d.municipios));
  const quando = new Date(c.atualizadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  el.textContent = `${c.datas.length} data(s) importada(s), ${munis.size} município(s) das comarcas. Atualizado em ${quando}` +
    (c.fonte?.tipo === 'url' ? '; a busca diária também atualiza.' : '.');
}

async function importarCalendario() {
  const info = $('#calInfo');
  const ano = lerConfig().ano;
  $('#btnCalImportar').disabled = true;
  estado.importandoCal = true;
  info.textContent = 'Lendo o Calendário Eletrônico do TJCE…';
  try {
    const { calCapturas = [], calTela = [] } = await chrome.storage.local.get(['calCapturas', 'calTela']);
    const cap = lerCapturas(calCapturas);
    const tela = datasDaTela(calTela);
    const fonte = estado.calTJCE?.fonte || cap.fonte;
    let r = null;
    try { r = await obterCalendario(ano, fonte, log); } catch (e) { log(`Calendário: ${e.message}`); }
    const datas = [...(r?.datas || []), ...cap.datas, ...tela];
    if (tela.length) log(`Calendário: ${tela.length} data(s) lidas da tela do calendário.`);
    if (!datas.length) {
      // Eventos embutidos na página (FullCalendar): abre o calendário em segundo plano e percorre os meses.
      info.textContent = 'Abrindo o calendário do TJCE em segundo plano e percorrendo os meses de ' + ano + '…';
      log('Calendário: lendo pelo próprio calendário (aba em segundo plano).');
      const res = await chrome.runtime.sendMessage({ alvo: 'background', cmd: 'calendarioPorAba', ano });
      const { calendarioTJCE } = await chrome.storage.local.get('calendarioTJCE');
      estado.calTJCE = calendarioTJCE || estado.calTJCE;
      log(`Calendário: varredura terminou com ${res?.total ?? 'nenhum'} evento(s) lidos; ${res?.datas || 0} data(s) das comarcas guardadas.`);
      estado.importandoCal = false;
      if (!res?.datas) {
        info.textContent = res?.total == null
          ? 'O calendário não respondeu a tempo. Tente de novo; se persistir, use "Copiar diagnóstico".'
          : `O calendário trouxe ${res.total} evento(s), mas nenhum das comarcas de trabalho. Use "Copiar diagnóstico" para eu ajustar a leitura.`;
        return;
      }
      desenhar();
      desenharCalendarioInfo();
      return;
    }
    estado.calTJCE = mesclarCalendario(estado.calTJCE, datas, r?.fonte || cap.fonte);
    await chrome.storage.local.set({ calendarioTJCE: estado.calTJCE });
    estado.importandoCal = false;
    desenhar();
  } catch (e) {
    estado.importandoCal = false;
    info.textContent = `Erro ao importar o calendário: ${e.message}`;
  } finally {
    estado.importandoCal = false;
    $('#btnCalImportar').disabled = false;
  }
}

async function copiarDiagnostico() {
  const d = await chrome.storage.local.get(['calDiag', 'calPagina', 'calTela', 'calCapturas', 'calendarioTJCE', 'calHtml']);
  const linhas = [`Diagnóstico do Calendário TJCE — ${new Date().toLocaleString('pt-BR')} — extensão ${chrome.runtime.getManifest().version}`, ''];
  linhas.push('== Registro (calendário) ==');
  linhas.push(...$('#registro').textContent.split('\n').filter(l => /Calendário/.test(l)).slice(0, 20));
  linhas.push('', '== Página do calendário ==', JSON.stringify(d.calPagina || 'não aberta ainda', null, 1));
  linhas.push('', `== Requisições da página (${(d.calDiag || []).length}) ==`);
  for (const r of (d.calDiag || []).slice(0, 40)) linhas.push(`${r.metodo} ${r.status} ${r.url} | ${r.tipoConteudo} | ${r.tamanho} car. | ${r.datas} datas | ${r.inicio}`);
  linhas.push('', `== Respostas com cara de eventos: ${(d.calCapturas || []).length} ==`);
  for (const c of (d.calCapturas || []).slice(0, 3)) linhas.push(`${c.metodo} ${c.url} ${c.corpo ? '| corpo: ' + c.corpo.slice(0, 200) : ''}`, (c.texto || '').slice(0, 600));
  linhas.push('', `== Eventos lidos da tela: ${(d.calTela || []).length} ==`);
  for (const i of (d.calTela || []).slice(0, 15)) linhas.push(`${i.data} | ${i.texto} | ${i.classes} ${i.cor}`);
  linhas.push('', `== Datas importadas: ${d.calendarioTJCE?.datas?.length || 0} ==`);
  for (const x of (d.calendarioTJCE?.datas || []).slice(0, 10)) linhas.push(`${x.data} | ${x.tipo} | ${x.municipios.join(', ') || 'todo o Estado'} | ${x.titulo}`);
  linhas.push('', `== Elementos de evento no HTML: ${d.calHtml?.total ?? '?'} ==`, ...(d.calHtml?.amostras || []));
  const texto = linhas.join('\n');
  try { await navigator.clipboard.writeText(texto); $('#calInfo').textContent = 'Diagnóstico copiado. Cole na conversa.'; }
  catch { baixar(`diagnostico-calendario-${hoje()}.txt`, texto, 'text/plain'); $('#calInfo').textContent = 'Diagnóstico baixado como arquivo.'; }
}

// ---------- compartilhar ----------
const ARQUIVOS_EXTENSAO = ['manifest.json', 'background.js', 'offscreen.html', 'offscreen.js', 'app.html', 'app.css', 'app.js',
  'parser.js', 'djea.js', 'coleta.js', 'calendario.js', 'comarcas.js', 'municipios.js', 'magistrados.js', 'cadastro.js', 'zip.js',
  'calendario-tjce.js', 'cal-gancho.js', 'cal-ponte.js',
  'icone16.png', 'icone48.png', 'icone128.png', 'LEIAME.md'];

async function montarPacote() {
  const d = await chrome.storage.local.get(['materias', 'atosMag', 'maiorId', 'config', 'cadastroJuizes', 'calendarioTJCE']);
  return {
    formato: 'feriados-tjce-dados', versao: 1, exportadoEm: new Date().toISOString(),
    materias: d.materias || {}, atosMag: d.atosMag || {}, maiorId: d.maiorId || 0,
    config: d.config || null, cadastroJuizes: d.cadastroJuizes || estado.cadastro, calendarioTJCE: d.calendarioTJCE || null
  };
}

const hoje = () => new Date().toLocaleDateString('sv-SE');
function resumoPacote(p) {
  const fer = Object.values(p.materias).filter(r => r && r.relevante).length;
  const jui = Object.values(p.atosMag).filter(r => r && r.relevante && r.eventos?.length).length;
  return `${fer} ato(s) de feriado, ${jui} de juízes, ${p.cadastroJuizes?.unidades?.length || 0} unidade(s) no cadastro`;
}

async function exportarZip() {
  const info = $('#infoCompartilhar');
  info.textContent = 'Montando o pacote…';
  try {
    await salvar(true);
    const pacote = await montarPacote();
    const arquivos = [];
    for (const nome of ARQUIVOS_EXTENSAO) {
      const r = await fetch(chrome.runtime.getURL(nome));
      if (!r.ok) throw new Error(`não foi possível ler ${nome}`);
      arquivos.push({ nome: `feriados-tjce/${nome}`, dados: new Uint8Array(await r.arrayBuffer()) });
    }
    arquivos.push({ nome: 'feriados-tjce/dados-iniciais.json', dados: JSON.stringify(pacote) });
    baixar(`feriados-tjce-com-dados-${hoje()}.zip`, criarZip(arquivos), 'application/zip');
    info.textContent = `Pacote gerado com ${resumoPacote(pacote)}.`;
  } catch (e) {
    info.textContent = `Erro ao gerar o pacote: ${e.message}`;
  }
}

async function exportarDados() {
  await salvar(true);
  const pacote = await montarPacote();
  baixar(`feriados-tjce-dados-${hoje()}.json`, JSON.stringify(pacote), 'application/json');
  $('#infoCompartilhar').textContent = `Arquivo gerado com ${resumoPacote(pacote)}.`;
}

/**
 * Junta um pacote aos dados locais. Atos do DJEA: une (o que já foi lido aqui é mantido).
 * Cadastro de juízes: fica o mais recente.
 */
async function aplicarPacote(p, { perguntar = false } = {}) {
  if (!p || p.formato !== 'feriados-tjce-dados') throw new Error('arquivo não é um pacote de dados desta extensão');
  const d = await chrome.storage.local.get(['materias', 'atosMag', 'maiorId', 'config', 'cadastroJuizes']);
  const materias = d.materias || {}, atosMag = d.atosMag || {};
  let novos = 0;
  for (const [id, v] of Object.entries(p.materias || {})) {
    if (!(id in materias) || (!materias[id] && v)) { materias[id] = v; novos++; }
  }
  for (const [id, v] of Object.entries(p.atosMag || {})) {
    if (!(id in atosMag) || (!atosMag[id] && v)) atosMag[id] = v;
  }
  const atualizacao = { materias, atosMag, maiorId: Math.max(d.maiorId || 0, p.maiorId || 0) };
  if (p.calendarioTJCE?.datas?.length) {
    const { calendarioTJCE: calLocal } = await chrome.storage.local.get('calendarioTJCE');
    atualizacao.calendarioTJCE = mesclarCalendario(calLocal, p.calendarioTJCE.datas, calLocal?.fonte || p.calendarioTJCE.fonte);
    estado.calTJCE = atualizacao.calendarioTJCE;
  }
  if (!d.config && p.config) atualizacao.config = p.config;
  const local = d.cadastroJuizes, vindo = p.cadastroJuizes;
  let cadastroTrocado = false;
  if (vindo && (!local || (vindo.atualizadoEm || '') > (local.atualizadoEm || ''))) {
    if (!local || !perguntar || confirm(`O cadastro de juízes do arquivo é de ${brC(vindo.atualizadoEm)}; o seu é de ${brC(local.atualizadoEm)}. Usar o do arquivo?`)) {
      atualizacao.cadastroJuizes = mesclarCadastroBase(vindo).cadastro; cadastroTrocado = true;
    }
  }
  await chrome.storage.local.set(atualizacao);
  estado.materias = materias; estado.atosMag = atosMag; estado.maiorId = atualizacao.maiorId;
  if (cadastroTrocado) estado.cadastro = atualizacao.cadastroJuizes;
  if (atualizacao.config) await carregar();
  return { novos, cadastroTrocado };
}

async function importarDados(arquivo) {
  const info = $('#infoCompartilhar');
  try {
    const p = JSON.parse(await arquivo.text());
    const r = await aplicarPacote(p, { perguntar: true });
    info.textContent = `Importado: ${r.novos} ato(s) novo(s)${r.cadastroTrocado ? ', cadastro de juízes atualizado' : ''}.`;
    desenhar();
  } catch (e) {
    info.textContent = `Não foi possível importar: ${e.message}`;
  }
}

// Pacote embutido (dados-iniciais.json): aplicado uma vez, na primeira abertura após instalar.
async function aplicarPacoteEmbutido() {
  let p;
  try {
    const r = await fetch(chrome.runtime.getURL('dados-iniciais.json'));
    if (!r.ok) return;
    p = await r.json();
  } catch { return; }
  const { pacoteAplicado } = await chrome.storage.local.get('pacoteAplicado');
  if (pacoteAplicado === p.exportadoEm) return;
  await aplicarPacote(p);
  await chrome.storage.local.set({ pacoteAplicado: p.exportadoEm });
  log(`Dados do pacote de ${new Date(p.exportadoEm).toLocaleDateString('pt-BR')} carregados: ${resumoPacote(p)}.`);
}

// ---------- abas ----------
function trocarAba(id) {
  for (const aba of document.querySelectorAll('[role=tab]')) {
    const ativa = aba.id === id;
    aba.setAttribute('aria-selected', String(ativa));
    document.getElementById(aba.getAttribute('aria-controls')).hidden = !ativa;
  }
  chrome.storage.local.set({ aba: id });
}

// ---------- calculadoras (cível e criminal) ----------
const CALCS = {
  civel: { p: 'c', chave: 'calc', saida: '#resultado',
    campos: ['cPrazo', 'cUnidade', 'cEvento', 'cData', 'cComarca', 'cMunicipais', 'cDobro', 'cVinculadas', 'cGeraisDjea', 'cExtras'] },
  penal: { p: 'p', chave: 'calcPenal', saida: '#resultadoPenal',
    campos: ['pPrazo', 'pEvento', 'pData', 'pComarca', 'pMunicipais', 'pDobro', 'pExcecao', 'pVinculadas', 'pGeraisDjea', 'pExtras'] }
};
function lerCalc(modo = 'civel') {
  const o = {};
  for (const id of CALCS[modo].campos) { const el = $('#' + id); o[id] = el.type === 'checkbox' ? el.checked : el.value; }
  return o;
}
function aplicarCalc(o = {}, modo = 'civel') {
  for (const id of CALCS[modo].campos) {
    if (!(id in o)) continue;
    const el = $('#' + id);
    if (el.type === 'checkbox') el.checked = o[id]; else el.value = o[id];
  }
  const data = $('#' + CALCS[modo].p + 'Data');
  if (!data.value) data.value = new Date().toLocaleDateString('sv-SE');
}

function extrasManuais(texto) {
  const out = [];
  for (const linha of texto.split('\n')) {
    const m = linha.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s*[-–—:]?\s*(.*)$/);
    if (!m) continue;
    out.push({ data: `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`, motivo: m[4] || 'Sem expediente (informado)',
      efeito: 'fechado', escopo: 'manual', fonte: 'Informado na calculadora' });
  }
  return out;
}

function extrasDoDjea(sede, { municipais, vinculadas, gerais }) {
  const c = COMARCAS.find(x => x.sede === sede);
  const out = [];
  for (const l of todasAsLinhas()) {
    let escopo;
    if (!l.municipio) { if (!gerais) continue; escopo = 'geral-djea'; }
    else if (l.municipio === c.sede) { if (!municipais) continue; escopo = 'municipal'; }
    else if (c.vinculadas.includes(l.municipio)) { if (!municipais || !vinculadas) continue; escopo = 'vinculado'; }
    else continue;
    // Ato de uma unidade só (ex.: 1º Juizado) não muda a contagem da comarca: fica como informação.
    const efeito = (l.prazos === 'correm' || l.unidade) ? 'informativo'
      : l.tipo === 'Suspensão de prazos' ? 'suspende'
      : l.tipo === 'Expediente alterado' ? 'reduzido' : 'fechado';
    out.push({ data: l.data, efeito, escopo,
      motivo: `${l.tipoAto || l.tipo} — ${l.unidade ? `só ${l.unidade}, ` : ''}${l.municipio || 'todo o Estado'}`, fonte: l.numero || l.titulo, url: l.url, trecho: l.trecho });
  }
  return out;
}

function calcular(modo = 'civel') {
  const cfg = CALCS[modo], P = cfg.p;
  const o = lerCalc(modo);
  const v = k => o[P + k];
  chrome.storage.local.set({ [cfg.chave]: o });
  const saida = $(cfg.saida);
  const prazo = parseInt(v('Prazo'), 10);
  if (!prazo || prazo < 1 || !v('Data')) { saida.innerHTML = '<p class="vazio-calc">Informe a quantidade de dias e a data do evento.</p>'; return; }

  const comarca = v('Comarca');
  const ano0 = +v('Data').slice(0, 4);
  const anos = [ano0 - 1, ano0, ano0 + 1, ano0 + 2];
  const djea = extrasDoDjea(comarca, { municipais: v('Municipais') === 'sim', vinculadas: v('Vinculadas'), gerais: v('GeraisDjea') });
  const mapa = montarMapa(anos, [...djea, ...extrasManuais(v('Extras'))]);

  let r;
  try {
    r = modo === 'penal'
      ? calcularPrazoPenal({ prazo, evento: v('Evento'), data: v('Data'), dobro: v('Dobro'), excecaoRecesso: v('Excecao'), mapa })
      : calcularPrazo({ prazo, unidade: v('Unidade'), evento: v('Evento'), data: v('Data'), dobro: v('Dobro'), mapa });
  } catch (e) {
    saida.innerHTML = `<p class="vazio-calc">${esc(e.message)}</p>`;
    return;
  }

  // Avisos sobre a cobertura dos dados municipais.
  const alertas = [];
  if (v('Municipais') === 'sim') {
    const anosDoPrazo = [...new Set([r.dias[0].data, r.vencimento].map(d => +d.slice(0, 4)))];
    for (const a of anosDoPrazo) {
      const tem = todasAsLinhas().some(l => l.municipio === comarca && l.data.startsWith(String(a)));
      if (!tem) alertas.push(`Nenhum feriado municipal de ${comarca} em ${a} foi lido ainda, nem no DJEA nem no Calendário Eletrônico do TJCE. Rode a coleta ou a importação do calendário, ou confira lá antes de confiar na data.`);
    }
  } else {
    alertas.push('Feriados municipais desligados: só o calendário geral foi considerado.');
  }

  const SEM = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  const dsem = iso => SEM[new Date(iso + 'T12:00:00').getDay()];
  const rotEvento = modo === 'penal'
    ? { djen: 'Intimação considerada', portal: 'Intimação considerada', intimacao: 'Intimação' }[v('Evento')]
    : { djen: 'Publicação considerada', portal: 'Ciência considerada', ciencia: 'Dia do começo' }[v('Evento')];
  const contagem = modo === 'penal' ? 'corridos (CPP)' : (v('Unidade') === 'uteis' ? 'úteis' : 'corridos');

  // Dias especiais dentro do período, com a fonte.
  const naoUteis = [];
  for (let d = r.dias[0].data; d <= r.vencimento; d = somarDias(d, 1)) {
    const s = situacao(d, mapa);
    if (s.itens.length) naoUteis.push(s);
  }
  const legenda = modo === 'penal' ? `
      <li><i style="background:#d9ebe8"></i>Dia contado</li>
      <li><i style="background:repeating-linear-gradient(135deg,#d9ebe8 0 4px,#c3ccd4 4px 8px)"></i>Contado, sem expediente</li>
      <li><i style="background:var(--feriado)"></i>Feriado municipal (fora da contagem)</li>
      <li><i style="background:#8c99a5"></i>Sem expediente (fora da contagem)</li>
      <li><i style="background:#ecd3d3"></i>Prazo suspenso (art. 798-A ou ato)</li>
      <li><i style="background:var(--acao)"></i>Vencimento</li>` : `
      <li><i style="background:#d9ebe8"></i>Dia contado</li>
      <li><i style="background:var(--feriado)"></i>Feriado municipal</li>
      <li><i style="background:#8c99a5"></i>Fim de semana e feriado geral</li>
      <li><i style="background:#ecd3d3"></i>Prazo suspenso (art. 220 ou ato)</li>
      <li><i style="background:var(--acao)"></i>Vencimento</li>`;

  saida.innerHTML = `
    <p class="venc-rotulo">Último dia do prazo</p>
    <p class="venc">${br(r.vencimento)}</p>
    <p class="venc-semana">${dsem(r.vencimento)}</p>
    <ul class="marcos">
      <li><b>${rotEvento}</b>${br(r.marco)}</li>
      <li><b>1º dia da contagem</b>${br(r.inicio)}</li>
      <li><b>Prazo contado</b>${r.total} dias ${contagem}</li>
      <li><b>Comarca</b>${esc(comarca)}</li>
    </ul>
    ${alertas.map(a => `<p class="alerta">${esc(a)}</p>`).join('')}
    <h3 class="secao">Como a data foi obtida</h3>
    <ol class="passos">${r.passos.map(p => `<li>${esc(p.texto)} <span class="base">${esc(p.base)}</span></li>`).join('')}</ol>
    <ul class="legenda-trilha">${legenda}
    </ul>
    <div class="trilha">${trilha(r, mapa)}</div>
    ${naoUteis.length ? `<h3 class="secao">Datas especiais no período</h3>
    <table class="nao-uteis"><tbody>${naoUteis.map(s => `<tr><td>${br(s.iso)}</td><td>${s.itens.map(i =>
      `${esc(i.motivo)}${{ reduzido: ' (expediente reduzido)', informativo: / só /.test(i.motivo) ? ' (vale só para essa unidade; dia contado normalmente)' : ' (o ato diz que os prazos não são suspensos; dia contado normalmente)', suspende: ' (prazos suspensos, expediente normal)' }[i.efeito] || ''} <span class="base">${i.url
        ? `<a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.fonte)}</a>` : esc(i.fonte || '')}</span>`).join('<br>')}</td></tr>`).join('')}</tbody></table>` : ''}`;
}

function trilha(r, mapa) {
  const porDia = new Map();
  for (const d of r.dias) {
    const atual = porDia.get(d.data);
    const prio = { vencimento: 4, marco: 3, contado: 2, pulado: 1, disponibilizacao: 0, envio: 0 };
    if (!atual || prio[d.papel] > prio[atual.papel]) porDia.set(d.data, d);
  }
  const ini = r.dias[0].data, fim = r.vencimento;
  const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  let html = '';
  let a = +ini.slice(0, 4), m = +ini.slice(5, 7);
  const aF = +fim.slice(0, 4), mF = +fim.slice(5, 7);
  let guarda = 0;
  while ((a < aF || (a === aF && m <= mF)) && guarda++ < 14) {
    const primeiro = new Date(a, m - 1, 1).getDay();
    const nDias = new Date(a, m, 0).getDate();
    html += `<div class="mes"><h3>${MESES[m - 1]} ${a}</h3><div class="grade">` +
      ['d','s','t','q','q','s','s'].map(x => `<span class="sem">${x}</span>`).join('') + '<span></span>'.repeat(primeiro);
    for (let d = 1; d <= nDias; d++) {
      const iso = `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const s = situacao(iso, mapa);
      const info = porDia.get(iso);
      const cls = ['dia'];
      let sup = '';
      const dentro = iso >= ini && iso <= fim;
      if (info?.papel === 'vencimento') cls.push('vencimento');
      else if (info?.papel === 'marco') cls.push('marco');
      else if (info?.papel === 'contado') { cls.push('contado'); if (s.fechado) cls.push('nao-util'); else if (s.reduzido) cls.push('reduz'); sup = `<sup>${info.n}</sup>`; }
      if (dentro && info?.papel !== 'vencimento' && info?.papel !== 'contado') {
        // Dia tirado da contagem por suspensão de prazos (art. 220 do CPC, art. 798-A do CPP ou ato): rosa.
        if (info?.papel === 'pulado' && info.motivos?.some(m => /suspens/i.test(m))) cls.push('pul-susp');
        else if (s.itens.some(i => i.escopo === 'municipal' || i.escopo === 'vinculado')) cls.push('pul-municipal');
        else if (s.fechado) cls.push('pul-geral');
        else if (info?.papel === 'pulado' && s.suspenso) cls.push('pul-susp');
      } else if (!dentro && s.fds) cls.push('fds');
      const dica = [s.motivos.join('; '), info?.papel === 'contado' ? `${info.n}º dia` : ''].filter(Boolean).join(' — ');
      html += `<span class="${cls.join(' ')}" title="${esc(br(iso) + (dica ? ': ' + dica : ''))}">${d}${sup}</span>`;
    }
    html += '</div></div>';
    if (++m > 12) { m = 1; a++; }
  }
  return html;
}

// ---------- eventos ----------
function ligar() {
  const rotuloComarca = c => c.sede + (c.vinculadas.length ? ` (${c.vinculadas.join(', ').replace(/, ([^,]*)$/, ' e $1')})` : '');
  $('#fComarca').innerHTML = '<option value="">Todas as comarcas de trabalho</option>' +
    COMARCAS.map(c => `<option value="${esc(c.sede)}">${esc(rotuloComarca(c))}</option>`).join('');
  const opcoesComarca = COMARCAS.map(c => `<option value="${esc(c.sede)}">${esc(rotuloComarca(c))}</option>`).join('');
  $('#jComarca').innerHTML = '<option value="">Todas</option>' + opcoesComarca;
  $('#jData').addEventListener('change', desenharJuizes);
  $('#jComarca').addEventListener('change', () => { linhaEditando = null; desenharJuizes(); });
  $('#jMostrar').addEventListener('change', desenharJuizes);
  $('#tabelaUnid').addEventListener('click', acaoTabelaUnid);
  $('#tabelaUnid').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('tr.editando input')) e.target.closest('tr').querySelector('[data-acao="salvar"]').click();
    if (e.key === 'Escape' && linhaEditando !== null) { linhaEditando = null; desenharJuizes(); }
  });
  $('#btnNovaUnidade').addEventListener('click', () => { linhaEditando = 'nova'; desenharJuizes(); });
  $('#jArea').addEventListener('change', () => { linhaEditando = null; desenharJuizes(); });
  $('#btnUsarSugestoes').addEventListener('click', () => {
    if (confirm(`Preencher ${sugestoes.length} titular(es) com os nomes lidos no DJEA? Confira depois na tabela.`)) usarSugestoes(sugestoes);
  });
  $('#btnExportarZip').addEventListener('click', exportarZip);
  $('#btnCalImportar').addEventListener('click', importarCalendario);
  $('#btnCalAbrir').addEventListener('click', () => chrome.tabs.create({ url: URL_CALENDARIO }));
  $('#btnCalDiag').addEventListener('click', copiarDiagnostico);
  $('#btnExportarJson').addEventListener('click', exportarDados);
  $('#btnImportarJson').addEventListener('click', () => $('#arquivoImportar').click());
  $('#arquivoImportar').addEventListener('change', e => { if (e.target.files[0]) importarDados(e.target.files[0]); e.target.value = ''; });
  $('#cComarca').innerHTML = COMARCAS.map(c => `<option value="${esc(c.sede)}">${esc(rotuloComarca(c))}</option>`).join('');
  $('#pComarca').innerHTML = $('#cComarca').innerHTML;
  $('#formPenal').addEventListener('submit', e => { e.preventDefault(); calcular('penal'); });
  for (const aba of document.querySelectorAll('[role=tab]')) aba.addEventListener('click', () => trocarAba(aba.id));
  $('#formCalc').addEventListener('submit', e => { e.preventDefault(); calcular('civel'); });
  $('#btnBuscar').addEventListener('click', () => buscar('completo'));
  $('#btnAtualizar').addEventListener('click', () => buscar('incremental'));
  $('#btnVarrer').addEventListener('click', varrer);
  $('#btnRepetir').addEventListener('click', repetirFalhas);
  $('#autoAtivo').addEventListener('change', salvarAuto);
  $('#autoHora').addEventListener('change', salvarAuto);
  $('#btnAutoAgora').addEventListener('click', rodarAutoAgora);
  $('#btnParar').addEventListener('click', () => estado.controle?.abort());
  $('#btnAnalisar').addEventListener('click', analisarUma);
  $('#umaMateria').addEventListener('keydown', e => { if (e.key === 'Enter') analisarUma(); });
  $('#btnReanalisar').addEventListener('click', reanalisar);
  $('#btnLimpar').addEventListener('click', limpar);
  $('#btnCsv').addEventListener('click', exportarCsv);
  $('#btnJson').addEventListener('click', exportarJson);
  $('#btnIcs').addEventListener('click', exportarIcs);
  for (const id of ['ano', 'termos', 'somentePortarias', 'porComarca', 'magistrados', 'maxPaginas', 'conexoes']) $('#' + id).addEventListener('change', salvarConfig);

  const atualiza = (campo, valor) => { estado.filtro[campo] = valor; estado.filtro.dia = campo === 'dia' ? valor : ''; desenhar(); };
  $('#fAno').addEventListener('change', e => atualiza('ano', +e.target.value));
  $('#fComarca').addEventListener('change', e => atualiza('comarca', e.target.value));
  $('#fTipo').addEventListener('change', e => atualiza('tipo', e.target.value));
  $('#fBusca').addEventListener('input', e => atualiza('busca', e.target.value));
  $('#fGerais').addEventListener('change', e => atualiza('gerais', e.target.checked));
  $('#meses').addEventListener('click', e => {
    const b = e.target.closest('[data-dia]');
    if (b) atualiza('dia', estado.filtro.dia === b.dataset.dia ? '' : b.dataset.dia);
  });
  $('#diaAtivo').addEventListener('click', e => { if (e.target.id === 'btnTodosDias') atualiza('dia', ''); });
}

(async () => {
  await carregar();
  ligar();
  aplicarCalc(estado.calcSalvo, 'civel');
  aplicarCalc(estado.calcPenalSalvo, 'penal');
  await carregarAuto();
  desenharUltima();
  await aplicarPacoteEmbutido();
  ouvirMudancas();
  trocarAba(estado.aba);
  // Reanalisa automaticamente o que foi salvo com uma versão anterior do analisador.
  if (Object.values(estado.materias).some(r => r && r.texto && r.v !== PARSER_VERSION) ||
      Object.values(estado.atosMag).some(r => r && r.texto && r.v !== MAG_VERSION)) await reanalisar();
  desenhar();
})();
