// Coleta no DJEA, sem dependência da tela: usada pela busca manual (app.js)
// e pela busca automática diária (offscreen.js).
import { analisarTexto, PARSER_VERSION } from './parser.js';
import { analisarMagistrados, MAG_VERSION } from './magistrados.js';
import { baixarMateria, descobrirFormulario, pesquisar, emLotes, espera } from './djea.js';
import { COMARCA_DO_MUNICIPIO, COMARCAS } from './comarcas.js';

export const TERMOS_PADRAO = ['feriado', 'ponto facultativo', 'suspensão do expediente', 'não haverá expediente'];

const nada = () => {};

/**
 * Baixa e analisa uma lista de IDs, com até 4 passadas para os que falharem.
 * Cada matéria passa pelos dois analisadores (feriados e juízes).
 * aoRegistrar(id, feriado, juizes): cada valor = registro relevante | 0 (nada) | -1 (inexistente)
 */
export async function processarIds(ids, {
  conexoes = 3, ano, conhecidos = new Set(), forcar = false, signal,
  log = nada, aoRegistrar = nada, aoProgresso = nada
} = {}) {
  const lista = [...ids];
  let pendentes = lista.filter(id => forcar || !conhecidos.has(id));
  log(`${lista.length} matérias na lista, ${pendentes.length} ainda não analisadas.`);
  const novas = [];
  const novasMag = [];
  let maiorId = 0;
  const PASSADAS = 4;
  for (let passada = 1; passada <= PASSADAS && pendentes.length && !signal?.aborted; passada++) {
    const falhas = [];
    const conc = passada === 1 ? conexoes : Math.max(1, Math.floor(conexoes / 2 ** (passada - 1)));
    if (passada > 1) {
      log(`Repetindo ${pendentes.length} matéria(s) que falharam (tentativa ${passada} de ${PASSADAS}, ${conc} conexão(ões)).`);
      aoProgresso(`Aguardando para repetir ${pendentes.length} matéria(s) que falharam…`, 0, pendentes.length);
      await espera(4000 * passada, signal);
    }
    await emLotes(pendentes, conc, async id => {
      try {
        const texto = await baixarMateria(id, signal);
        if (!texto) { aoRegistrar(id, -1, -1); return; }
        if (id > maiorId) maiorId = id;
        const r = analisarTexto(texto, { id, anoPadrao: ano });
        let feriado = 0, juizes = 0;
        if (r.relevante) {
          feriado = { ...r, texto, v: PARSER_VERSION };
          novas.push(feriado);
          log(`Matéria ${id}: ${r.datas.length} data(s) — ${r.titulo}`);
        }
        const m = analisarMagistrados(texto, { id, anoPadrao: ano });
        if (m.relevante) {
          const comTexto = m.eventos.length || m.lotacoes.length;
          juizes = { ...m, texto: comTexto ? texto : undefined, v: MAG_VERSION };
          if (m.eventos.length) {
            novasMag.push(juizes);
            log(`Matéria ${id}: ${m.eventos.length} designação(ões)/férias de juiz — ${m.titulo}`);
          }
        }
        aoRegistrar(id, feriado, juizes);
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        falhas.push(id);
        if (passada === PASSADAS) log(`Matéria ${id} não abriu: ${e.message}`);
      }
    }, (f, t) => aoProgresso(
      `${passada > 1 ? `Repetição ${passada - 1}: ` : ''}${f} de ${t} matérias analisadas${falhas.length ? `, ${falhas.length} com falha` : ''}`, f, t),
    signal);
    pendentes = falhas;
  }
  return { novas, novasMag, falhas: pendentes, maiorId };
}

function listaDeTermos(cfg, f) {
  const termos = (cfg.termos?.length ? cfg.termos : TERMOS_PADRAO).map(t => ({ termo: t, qualquerOrdem: false }));
  if (cfg.porComarca ?? true) {
    for (const m of COMARCA_DO_MUNICIPIO.keys()) {
      termos.push(f.radioQualquerOrdem
        ? { termo: `expediente ${m}`, qualquerOrdem: true }
        : { termo: m, qualquerOrdem: false });
    }
  }
  if (cfg.magistrados ?? true) {
    termos.push({ termo: 'responder pela', qualquerOrdem: false });
    // Portarias em tabela da Presidência ("…constantes da relação abaixo para responderem pelas Comarcas…").
    termos.push({ termo: 'responderem pelas', qualquerOrdem: false });
    termos.push({ termo: 'designado(a) para responder', qualquerOrdem: false });
    termos.push({ termo: 'responder durante férias', qualquerOrdem: false });
    for (const c of COMARCAS) {
      if (f.radioQualquerOrdem) {
        termos.push({ termo: `responder ${c.sede}`, qualquerOrdem: true });
        termos.push({ termo: `férias ${c.sede}`, qualquerOrdem: true });
      } else if (!(cfg.porComarca ?? true)) {
        termos.push({ termo: c.sede, qualquerOrdem: false });
      }
    }
  }
  return termos;
}

/**
 * Pesquisa todos os termos, junta os IDs (mais as falhas anteriores) e processa.
 * cfg: { ano, termos, porComarca, somentePortarias, maxPaginas, conexoes }
 */
export async function coletar(cfg, {
  conhecidos = new Set(), falhasAnteriores = [], signal, modo = 'completo', desde = null,
  log = nada, aoRegistrar = nada, aoProgresso = nada
} = {}) {
  aoProgresso('Lendo o formulário de consulta do DJEA…', 0, 0);
  const f = await descobrirFormulario(log, signal);
  const termos = listaDeTermos(cfg, f);
  if (modo === 'incremental') {
    if (!f.ordem) log('Atenção: ordenação "mais recente primeiro" não encontrada no DJEA; a atualização vai ler as páginas como na carga completa.');
    return coletarIncremental(cfg, f, termos, { conhecidos, falhasAnteriores, signal, desde, log, aoRegistrar, aoProgresso });
  }
  const opcoes = {
    ano: cfg.ano, somentePortarias: cfg.somentePortarias ?? true,
    maxPaginas: Math.max(1, cfg.maxPaginas || 40), signal, log
  };
  const ids = new Set();
  const comFalha = [];
  let cortados = 0;
  for (const [i, t] of termos.entries()) {
    if (signal?.aborted) break;
    aoProgresso(`Pesquisando "${t.termo}" (${i + 1} de ${termos.length})…`, i, termos.length);
    try {
      const r = await pesquisar(f, { ...opcoes, ...t });
      r.ids.forEach(id => ids.add(id));
      if (r.falhas) comFalha.push(t);
      if (r.cortado) cortados++;
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      log(`Falha ao pesquisar "${t.termo}": ${e.message}`);
      comFalha.push(t);
    }
  }
  // O calendário do ano é publicado em dezembro do ano anterior: pesquisa também os atos daquele ano.
  const anoAnterior = (cfg.ano || new Date().getFullYear()) - 1;
  const termosAnteriores = [...new Set(['feriados e pontos facultativos', ...(cfg.termos?.length ? cfg.termos : TERMOS_PADRAO)])];
  for (const [i, termo] of termosAnteriores.entries()) {
    if (signal?.aborted) break;
    aoProgresso(`Pesquisando "${termo}" em atos de ${anoAnterior} (${i + 1} de ${termosAnteriores.length})…`, i, termosAnteriores.length);
    try {
      const r = await pesquisar(f, { ...opcoes, ano: anoAnterior, maxPaginas: Math.min(opcoes.maxPaginas, 15), termo, qualquerOrdem: false });
      r.ids.forEach(id => ids.add(id));
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      log(`Falha ao pesquisar "${termo}" (${anoAnterior}): ${e.message}`);
    }
  }
  if (comFalha.length && !signal?.aborted) {
    log(`Repetindo ${comFalha.length} pesquisa(s) que tiveram falhas.`);
    await espera(5000, signal);
    for (const t of comFalha) {
      try { (await pesquisar(f, { ...opcoes, ...t })).ids.forEach(id => ids.add(id)); }
      catch (e) { if (e.name === 'AbortError') throw e; log(`"${t.termo}" falhou de novo: ${e.message}`); }
    }
  }
  if (cortados) log(`${cortados} pesquisa(s) tinham mais páginas que o limite. Aumente "Páginas por termo" se faltar alguma portaria.`);
  let maiorId = Math.max(0, ...ids);
  falhasAnteriores.forEach(id => ids.add(id));
  if (!ids.size) {
    log('A pesquisa não devolveu links de matérias.');
    return { novas: [], novasMag: [], falhas: [], maiorId, encontrados: 0 };
  }
  const r = await processarIds(ids, {
    conexoes: cfg.conexoes || 3, ano: cfg.ano, conhecidos, signal, log, aoRegistrar, aoProgresso
  });
  return { ...r, maiorId: Math.max(maiorId, r.maiorId), encontrados: ids.size };
}

/**
 * Atualização: pesquisa os mesmos termos, mas em cada um para na primeira página que só tem atos já lidos.
 * Os anos vão do ano da última atualização até o atual (cobre a virada de ano e dias sem atualização).
 */
async function coletarIncremental(cfg, f, termos, { conhecidos, falhasAnteriores, signal, desde, log, aoRegistrar, aoProgresso }) {
  const anoAtual = cfg.ano || new Date().getFullYear();
  const anoDesde = desde ? Math.min(new Date(desde).getFullYear(), anoAtual) : anoAtual;
  const anos = []; for (let a = anoDesde; a <= anoAtual; a++) anos.push(a);
  const tarefas = anos.flatMap(ano => termos.map(t => ({ ...t, ano })));
  const opcoes = { somentePortarias: cfg.somentePortarias ?? true, maxPaginas: Math.max(1, cfg.maxPaginas || 40), signal, log, pararEmConhecidos: conhecidos };
  const ids = new Set();
  let feitas = 0, paginas = 0, comFalha = 0;
  log(`Atualização desde ${desde ? new Date(desde).toLocaleString('pt-BR') : 'o início'}: ${tarefas.length} pesquisa(s) em ${anos.join(', ')}.`);
  await emLotes(tarefas, Math.max(1, cfg.conexoes || 3), async t => {
    try {
      const r = await pesquisar(f, { ...opcoes, ...t });
      r.ids.forEach(id => ids.add(id));
      paginas += r.paginas || 1;
      if (r.falhas) comFalha++;
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      comFalha++;
      log(`Falha ao pesquisar "${t.termo}" (${t.ano}): ${e.message}`);
    }
  }, () => aoProgresso(`Atualizando: ${++feitas} de ${tarefas.length} pesquisas…`, feitas, tarefas.length), signal);
  const novos = [...ids].filter(id => !conhecidos.has(id));
  log(`Atualização: ${paginas} página(s) consultadas, ${novos.length} ato(s) novo(s)${comFalha ? `, ${comFalha} pesquisa(s) com falha` : ''}.`);
  falhasAnteriores.forEach(id => ids.add(id));
  const r = await processarIds(ids, { conexoes: cfg.conexoes || 3, ano: anoAtual, conhecidos, signal, log, aoRegistrar, aoProgresso });
  return { ...r, maiorId: Math.max(0, r.maiorId, ...ids), encontrados: ids.size, pesquisasComFalha: comFalha };
}

/** Datas municipais novas nas comarcas de trabalho, para o aviso. */
export function datasDasComarcas(registros) {
  const out = [];
  for (const r of registros) {
    for (const d of r.datas || []) {
      for (const m of d.municipios) {
        if (COMARCA_DO_MUNICIPIO.has(m)) out.push({ data: d.data, municipio: m, tipo: d.tipo });
      }
    }
  }
  return out.sort((a, b) => a.data.localeCompare(b.data));
}
