import { lerCapturas, mesclarCalendario, URL_CALENDARIO } from './calendario-tjce.js';
import { MAG_VERSION } from './magistrados.js';

// Service worker: abre a tela, agenda a busca diária e grava o que o
// documento offscreen (onde a coleta roda, pois aqui não há DOMParser) envia.
const ALARME = 'coleta-diaria';
const TRAVA_MAX = 2 * 3600e3;
const get = k => chrome.storage.local.get(k);
const set = o => chrome.storage.local.set(o);

chrome.action.onClicked.addListener(abrirTela);
chrome.runtime.onInstalled.addListener(reagendar);
chrome.runtime.onStartup.addListener(async () => { await reagendar(); await verificarAtraso(); });
chrome.alarms.onAlarm.addListener(a => { if (a.name === ALARME) coletarAutomatico(); });
chrome.notifications.onClicked.addListener(id => { chrome.notifications.clear(id); abrirTela(); });

// Analisador de juízes mudou de versão: as matérias descartadas antes (0) deixam de contar como lidas.
async function migrarVersaoMag() {
  const { magVersao, atosMag = {} } = await get(['magVersao', 'atosMag']);
  if ((magVersao || 0) >= MAG_VERSION) return;
  for (const id of Object.keys(atosMag)) if (atosMag[id] === 0) delete atosMag[id];
  await set({ atosMag, magVersao: MAG_VERSION });
}

async function abrirTela() {
  const url = chrome.runtime.getURL('app.html');
  const [aberta] = await chrome.tabs.query({ url });
  if (aberta) {
    await chrome.tabs.update(aberta.id, { active: true });
    await chrome.windows.update(aberta.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

async function reagendar() {
  const { auto = {} } = await get('auto');
  await chrome.alarms.clear(ALARME);
  if (!auto.ativo) return;
  const [h, m] = (auto.hora || '07:00').split(':').map(Number);
  const prox = new Date();
  prox.setHours(h, m, 0, 0);
  if (prox.getTime() <= Date.now()) prox.setDate(prox.getDate() + 1);
  await chrome.alarms.create(ALARME, { when: prox.getTime(), periodInMinutes: 1440 });
}

// Se o navegador estava fechado no horário, roda ao abrir.
async function verificarAtraso() {
  const { auto = {} } = await get('auto');
  if (!auto.ativo) return;
  const [h, m] = (auto.hora || '07:00').split(':').map(Number);
  const hojeNoHorario = new Date(); hojeNoHorario.setHours(h, m, 0, 0);
  const ultima = auto.ultima?.quando || 0;
  if (Date.now() >= hojeNoHorario.getTime() && ultima < hojeNoHorario.getTime()) coletarAutomatico();
}

// ---------- execução ----------
let rodando = false;
let avisarPronto = null;
let filaGravacao = Promise.resolve();

// modo: 'incremental' (busca diária e botão "Atualizar") ou 'completo' (carga total, só quando pedida).
let modoAtual = 'incremental', desdeAtual = null, inicioAtual = 0;
async function coletarAutomatico(modo = 'incremental') {
  if (rodando) return;
  await migrarVersaoMag();
  const d = await get(['config', 'materias', 'atosMag', 'falhas', 'coletaEmAndamento', 'calendarioTJCE', 'ultimaAtualizacao']);
  modoAtual = modo; inicioAtual = Date.now();
  desdeAtual = modo === 'incremental' ? (d.ultimaAtualizacao?.quando || null) : null;
  if (d.coletaEmAndamento && Date.now() - d.coletaEmAndamento.desde < TRAVA_MAX) return;
  rodando = true;
  await set({ coletaEmAndamento: { desde: Date.now(), origem: 'automatica' } });
  try {
    await abrirOffscreen();
    const cfg = { ...(d.config || {}), ano: new Date().getFullYear() };
    await chrome.runtime.sendMessage({
      alvo: 'offscreen', cmd: 'coletar', cfg,
      conhecidos: Object.keys(d.materias || {}).filter(id => id in (d.atosMag || {})).map(Number),
      falhas: d.falhas || [],
      calFonte: d.calendarioTJCE?.fonte || null,
      modo: modoAtual, desde: desdeAtual
    });
  } catch (e) {
    await finalizar({ erro: e.message, novas: 0, falhas: d.falhas || [], novasDatas: [] });
  }
}

async function abrirOffscreen() {
  const existentes = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (existentes.length) await chrome.offscreen.closeDocument();
  const pronto = new Promise((ok, falha) => {
    avisarPronto = ok;
    setTimeout(() => falha(new Error('o documento de coleta não respondeu')), 15000);
  });
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['DOM_PARSER'],
    justification: 'Ler as páginas do DJEA para extrair feriados e pontos facultativos.'
  });
  await pronto;
}

function gravarLote(registros, magistrados = {}) {
  filaGravacao = filaGravacao.then(async () => {
    const { materias = {}, atosMag = {} } = await get(['materias', 'atosMag']);
    Object.assign(materias, registros);
    Object.assign(atosMag, magistrados);
    await set({ materias, atosMag });
  }).catch(e => console.warn('Falha ao gravar lote', e));
  return filaGravacao;
}

async function finalizar(resumo) {
  await filaGravacao;
  const d = await get(['materias', 'falhas', 'maiorId', 'auto']);
  const conhecidos = d.materias || {};
  const falhas = [...new Set([...(d.falhas || []).filter(id => !(id in conhecidos)), ...(resumo.falhas || [])])];
  const auto = { ...(d.auto || {}), ultima: {
    quando: Date.now(), novas: resumo.novas, falhas: (resumo.falhas || []).length,
    novasDatasComarcas: resumo.novasDatas.length, novasDesignacoes: (resumo.novasDesignacoes || []).length, erro: resumo.erro || null, log: resumo.log || []
  } };
  await set({ falhas, auto, maiorId: Math.max(d.maiorId || 0, resumo.maiorId || 0) });
  await chrome.storage.local.remove('coletaEmAndamento');
  try { await chrome.offscreen.closeDocument(); } catch {}
  rodando = false;
  // Calendário Eletrônico: varredura pela própria página (aba inativa), desde o mês da última atualização.
  let calOk = true;
  try { const c = await calendarioPorAba(new Date().getFullYear(), desdeAtual); calOk = c.total != null; }
  catch (e) { calOk = false; console.warn('calendário por aba', e); }
  // Só avança a "última atualização" se a rodada terminou bem; senão a próxima retroage a partir da anterior.
  if (!resumo.erro && calOk && !(resumo.pesquisasComFalha > 0)) {
    await set({ ultimaAtualizacao: { quando: inicioAtual, modo: modoAtual, novas: resumo.novas, falhas: (resumo.falhas || []).length } });
  }
  if (resumo.novasDatas.length) avisar(resumo.novasDatas);
  if (resumo.novasDesignacoes?.length) avisarJuizes(resumo.novasDesignacoes);
}

function avisarJuizes(lista) {
  const br = iso => iso ? iso.split('-').reverse().join('/').slice(0, 5) : '?';
  const linhas = lista.slice(0, 4).map(e =>
    `${e.comarca}: ${e.motivo.toLowerCase()} ${br(e.inicio)}–${br(e.fim)}${e.substituto ? ` — responde ${e.substituto}` : ''}`);
  if (lista.length > 4) linhas.push(`e mais ${lista.length - 4}`);
  chrome.notifications.create('juizes-' + Date.now(), {
    type: 'basic', iconUrl: 'icone128.png', priority: 1,
    title: lista.length === 1 ? 'Nova férias/designação de juiz nas comarcas' : `${lista.length} novas férias/designações de juízes`,
    message: linhas.join('\n')
  });
}

function avisar(datas) {
  const br = iso => iso.split('-').reverse().join('/');
  const linhas = datas.slice(0, 4).map(d => `${br(d.data)} — ${d.municipio} (${d.tipo.toLowerCase()})`);
  if (datas.length > 4) linhas.push(`e mais ${datas.length - 4}`);
  chrome.notifications.create('novos-feriados-' + Date.now(), {
    type: 'basic', iconUrl: 'icone128.png', priority: 1,
    title: datas.length === 1 ? 'Nova data sem expediente nas comarcas' : `${datas.length} novas datas sem expediente nas comarcas`,
    message: linhas.join('\n')
  });
}

chrome.runtime.onMessage.addListener((msg, _remetente, responder) => {
  if (msg?.alvo !== 'background') return;
  switch (msg.cmd || msg.tipo) {
    case 'reagendar': reagendar().then(() => responder({ ok: true })); return true;
    case 'coletarAgora': coletarAutomatico(msg.modo || 'incremental'); responder({ ok: true }); return;
    case 'pronto': avisarPronto?.(); return;
    case 'lote': gravarLote(msg.registros, msg.magistrados).then(() => responder({ ok: true })); return true;
    case 'pulso': return;
    case 'fim': finalizar(msg.resumo); return;
    case 'calendarioCapturado': guardarCaptura(msg); return;
    case 'calendario': guardarCalendario(msg); return;
    case 'calendarioTela': guardarTela(msg); return;
    case 'calendarioHtml': set({ calHtml: { total: msg.total, amostras: msg.amostras, quando: Date.now() } }); return;
    case 'calendarioVarreduraFim': avisarVarredura?.(msg.total); return;
    case 'calendarioPorAba': calendarioPorAba(msg.ano || new Date().getFullYear(), msg.desde || null).then(responder, e => responder({ erro: e.message })); return true;
    case 'calendarioDiag': guardarLista('calDiag', msg.item, 60); return;
    case 'calendarioPagina': set({ calPagina: { ...msg.resumo, quando: Date.now() } }); return;
  }
});

// Respostas do Calendário Eletrônico do TJCE capturadas quando o usuário abre a página.
// A tela da extensão interpreta as capturas e aprende o endereço para consultar o ano todo.
function guardarCaptura(msg) {
  filaGravacao = filaGravacao.then(async () => {
    const { calCapturas = [], calendarioTJCE } = await get(['calCapturas', 'calendarioTJCE']);
    const nova = { url: msg.url, metodo: msg.metodo, corpo: msg.corpo, tipoConteudo: msg.tipoConteudo, texto: msg.texto, quando: Date.now() };
    const lista = [nova, ...calCapturas.filter(c => !(c.url === nova.url && c.corpo === nova.corpo && c.metodo === nova.metodo))].slice(0, 24);
    const atualizacao = { calCapturas: lista };
    // Converte já aqui, para funcionar mesmo com a tela da extensão fechada.
    const cap = lerCapturas([nova]);
    if (cap.datas.length) atualizacao.calendarioTJCE = mesclarCalendario(calendarioTJCE, cap.datas, cap.fonte || calendarioTJCE?.fonte);
    await set(atualizacao);
  }).catch(e => console.warn('captura do calendário', e));
  return filaGravacao;
}

// Abre o calendário do TJCE numa aba em segundo plano; o gancho percorre os meses e envia os eventos.
let avisarVarredura = null;
async function calendarioPorAba(ano, desde = null) {
  // desde: data ISO da última atualização → a varredura começa no mês dela (não em janeiro).
  const de = desde ? `&de=${new Date(desde).toISOString().slice(0, 7)}` : '';
  const aba = await chrome.tabs.create({ url: `${URL_CALENDARIO}#feriados-tjce-varrer=${ano}${de}`, active: false });
  const total = await new Promise(ok => { avisarVarredura = ok; setTimeout(() => ok(null), 90000); });
  avisarVarredura = null;
  try { await chrome.tabs.remove(aba.id); } catch {}
  await filaGravacao;
  const { calendarioTJCE } = await get('calendarioTJCE');
  return { total, datas: calendarioTJCE?.datas?.length || 0 };
}

async function guardarCalendario(msg) {
  filaGravacao = filaGravacao.then(async () => {
    const { calendarioTJCE } = await get('calendarioTJCE');
    const mapa = new Map();
    for (const d of [...(calendarioTJCE?.datas || []), ...msg.datas]) mapa.set(`${d.data}|${d.municipios.join(',')}|${d.tipo}`, d);
    await set({ calendarioTJCE: { datas: [...mapa.values()].sort((a, b) => a.data.localeCompare(b.data)),
      fonte: msg.fonte || calendarioTJCE?.fonte || null, atualizadoEm: new Date().toISOString() } });
  });
  return filaGravacao;
}

// Eventos lidos da tela do calendário: acumulados por data+texto (o usuário vai passando os meses).
async function guardarTela(msg) {
  const { calTela = [] } = await get('calTela');
  const mapa = new Map(calTela.map(i => [`${i.data}|${i.texto}`, i]));
  for (const i of msg.itens) mapa.set(`${i.data}|${i.texto}`, { ...i, quando: Date.now() });
  await set({ calTela: [...mapa.values()].slice(-3000) });
}

async function guardarLista(chave, item, max) {
  const d = await get(chave);
  await set({ [chave]: [{ ...item, quando: Date.now() }, ...(d[chave] || [])].slice(0, max) });
}
