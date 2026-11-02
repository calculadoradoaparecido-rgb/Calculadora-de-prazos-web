// Calendário Eletrônico do TJCE (https://www.tjce.jus.br/calendario/).
// A página inclui eventos em nós ocultos e os usa para montar o calendário visual. Este módulo:
//  1) entende listas de eventos em formatos comuns (FullCalendar, WordPress, JSON próprio);
//  2) tenta descobrir sozinho de onde a página carrega os eventos;
//  3) repete uma consulta capturada no navegador (cal-gancho.js) para o ano inteiro.
import { fold, municipiosFortes, municipiosEmTrecho } from './parser.js';
import { COMARCA_DO_MUNICIPIO } from './comarcas.js';

export const URL_CALENDARIO = 'https://www.tjce.jus.br/calendario/';
const ORIGEM = new URL(URL_CALENDARIO).origin;

// ---------- datas ----------
function lerData(v) {
  if (v == null) return null;
  if (typeof v === 'number') { const d = new Date(v > 1e11 ? v : v * 1000); return isNaN(d) ? null : d.toISOString().slice(0, 10); }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}
const temHora = v => typeof v === 'string' && /T\d{2}:\d{2}|\s\d{2}:\d{2}/.test(v) && !/T00:00(:00)?/.test(v);
const somar = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const semHtml = s => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const CHAVES = {
  inicio: /^(start|start_?date|data|date|inicio|data_?inicio|dt_?inicio|dtstart|data_?evento|dia)$/i,
  fim: /^(end|end_?date|fim|data_?fim|dt_?fim|dtend|termino|data_?termino)$/i,
  titulo: /^(title|titulo|nome|name|summary|evento|assunto)$/i,
  categoria: /^(classname|classe|class|tipo|categoria|category|type|color|backgroundcolor|cor|legenda|tipo_?evento)$/i,
  descricao: /desc|observ|detalhe|conteudo|content|texto|local|comarca/i,
  diaInteiro: /^(allday|all_?day|dia_?inteiro)$/i
};

function achatar(o) {
  // Junta as propriedades de um nível abaixo (o FullCalendar usa extendedProps); as do nível de cima prevalecem.
  const out = {};
  for (const v of Object.values(o)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v)) if (!(k2 in out)) out[k2] = v2;
    }
  }
  for (const [k, v] of Object.entries(o)) {
    if (!(v && typeof v === 'object' && !Array.isArray(v))) out[k] = v;
  }
  return out;
}

function eventoDeObjeto(obj) {
  const o = achatar(obj);
  let inicioBruto, fimBruto, titulo = '', cats = [], descs = [], diaInteiro = null;
  for (const [k, v] of Object.entries(o)) {
    if (inicioBruto === undefined && CHAVES.inicio.test(k) && lerData(v)) inicioBruto = v;
    else if (fimBruto === undefined && CHAVES.fim.test(k) && lerData(v)) fimBruto = v;
    else if (!titulo && CHAVES.titulo.test(k) && typeof v === 'string') titulo = semHtml(v);
    else if (CHAVES.categoria.test(k) && (typeof v === 'string' || Array.isArray(v))) cats.push([].concat(v).join(' '));
    else if (CHAVES.descricao.test(k) && typeof v === 'string') descs.push(semHtml(v));
    else if (CHAVES.diaInteiro.test(k)) diaInteiro = !!v;
  }
  const inicio = lerData(inicioBruto);
  if (!inicio || !(titulo || descs.length)) return null;
  let fim = lerData(fimBruto) || inicio;
  // No FullCalendar o "end" de evento de dia inteiro é exclusivo.
  if (fim > inicio && (diaInteiro === true || (diaInteiro === null && !temHora(fimBruto)))) fim = somar(fim, -1);
  if (fim < inicio) fim = inicio;
  return { inicio, fim, titulo, categoria: cats.join(' '), descricao: descs.join(' ').slice(0, 600) };
}

/** Percorre qualquer JSON e devolve os objetos que parecem eventos de calendário. */
export function eventosDeJson(json) {
  const out = [];
  const visitar = (n, prof) => {
    if (prof > 6 || n == null) return;
    if (Array.isArray(n)) {
      const evs = n.filter(x => x && typeof x === 'object' && !Array.isArray(x)).map(eventoDeObjeto).filter(Boolean);
      if (evs.length && evs.length >= n.length / 3) { out.push(...evs); return; }
      n.forEach(x => visitar(x, prof + 1));
    } else if (typeof n === 'object') {
      Object.values(n).forEach(x => visitar(x, prof + 1));
    }
  };
  visitar(json, 0);
  return out;
}

// ---------- classificação ----------
const TODO_ESTADO = /todo o estado|todas as comarcas|ambito do poder judiciario|feriado (?:estadual|nacional)|nacional|estadual/;

/** Transforma eventos brutos em datas no mesmo formato das portarias do DJEA. */
export function classificarEventos(eventos) {
  const datas = [];
  for (const e of eventos) {
    const t = fold(`${e.titulo} | ${e.categoria} | ${e.descricao}`);
    let tipo = null, prazos = null;
    if (/teletrabalho/.test(t)) { tipo = 'Prazos não suspensos'; prazos = 'correm'; }
    else if (/expediente reduzido|ate as \d|a partir das \d/.test(t)) tipo = 'Expediente alterado';
    else if (/ponto facultativo/.test(t)) tipo = 'Ponto facultativo';
    else if (/feriado/.test(t)) tipo = 'Feriado';
    else if (/recesso/.test(t)) tipo = 'Recesso';
    else if (/suspens\w*\s+(?:d[oe]s?\s+)?prazos/.test(t)) { tipo = 'Suspensão de prazos'; prazos = 'suspensos'; }
    else if (/suspens\w*\s+(?:d[oe]\s+)?(?:atendimento|expediente)|sem expediente|nao havera expediente/.test(t)) tipo = 'Suspensão de expediente';
    if (!tipo) continue; // sessões, eventos institucionais etc.
    if (/prazos?[^.;]{0,40}(?:transcorr|corr|flu|normal)|nao havera suspensao de prazos/.test(t)) prazos = 'correm';
    let municipios = municipiosFortes(t);
    if (!municipios.length) municipios = municipiosEmTrecho(fold(`${e.titulo} ${e.descricao}`)).filter(m => m !== 'Marco' || /comarca de marco/.test(t));
    const geral = !municipios.length && (/feriado (?:estadual|nacional)|ponto facultativo|recesso/.test(fold(e.categoria)) || TODO_ESTADO.test(t));
    if (!municipios.length && !geral) continue;
    for (let d = e.inicio, n = 0; d <= e.fim && n < 60; d = somar(d, 1), n++) {
      datas.push({ data: d, municipios, tipo, prazos, titulo: e.titulo, categoria: e.categoria, trecho: [e.titulo, e.descricao].filter(Boolean).join(' — ').slice(0, 280) });
    }
  }
  const vistos = new Set();
  return datas.filter(d => { const k = `${d.data}|${d.municipios.join(',')}|${d.tipo}`; if (vistos.has(k)) return false; vistos.add(k); return true; });
}

// ---------- descoberta da fonte ----------
async function texto(url, opts = {}) {
  const r = await fetch(url, { credentials: 'include', ...opts });
  const corpo = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} (${r.headers.get('content-type') || 'tipo desconhecido'}): ${corpo.slice(0, 180).replace(/\s+/g, ' ')}`);
  return corpo;
}

/** Procura listas JSON com datas dentro de um código JavaScript (eventos embutidos na página). */
function jsonsEmbutidos(codigo) {
  const achados = [];
  const re = /[\[{]/g;
  let m, tentativas = 0;
  while ((m = re.exec(codigo)) && tentativas < 400) {
    const ini = m.index;
    const espia = codigo.slice(ini, ini + 400);
    if (!/\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4}/.test(espia) || !/start|title|titulo|data|inicio/i.test(espia)) continue;
    tentativas++;
    // casa colchetes/chaves respeitando strings
    let prof = 0, str = null, fim = -1;
    for (let i = ini; i < codigo.length && i < ini + 2e6; i++) {
      const c = codigo[i];
      if (str) { if (c === '\\') i++; else if (c === str) str = null; continue; }
      if (c === '"' || c === "'" || c === '`') { str = c; continue; }
      if (c === '[' || c === '{') prof++;
      else if (c === ']' || c === '}') { prof--; if (prof === 0) { fim = i; break; } }
    }
    if (fim < 0) continue;
    const trecho = codigo.slice(ini, fim + 1);
    for (const tentativa of [trecho, paraJson(trecho)]) {
      try { const j = JSON.parse(tentativa); const evs = eventosDeJson(j); if (evs.length) { achados.push(...evs); re.lastIndex = fim; break; } } catch {}
    }
  }
  return achados;
}

/** Os eventos do TJCE também vêm renderizados no HTML, em nós ocultos
 * .eventos_calendario usados para inicializar o FullCalendar. */
function eventosDoHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return [...doc.querySelectorAll('.eventos_calendario')].map(el => ({
    id: el.getAttribute('data-id') || '',
    title: el.getAttribute('data-title') || '',
    start: el.getAttribute('data-start') || '',
    end: el.getAttribute('data-end') || '',
    description: el.getAttribute('data-description') || '',
    backgroundColor: el.getAttribute('data-background-color') || ''
  })).filter(e => lerData(e.start) && (e.title || e.description));
}

// Converte objeto literal simples de JS em JSON (chaves sem aspas, aspas simples, vírgula final).
function paraJson(js) {
  return js
    .replace(/'((?:[^'\\]|\\.)*)'/g, (_, s) => JSON.stringify(s.replace(/\\'/g, "'")))
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
    .replace(/,\s*([}\]])/g, '$1');
}

function urlsCandidatas(codigos) {
  const urls = new Set();
  for (const c of codigos) {
    for (const m of c.matchAll(/["'`]((?:https?:\/\/[^"'`\s]*tjce\.jus\.br)?\/[^"'`\s<>]*?(?:wp-json|admin-ajax\.php|calend|event|feriad)[^"'`\s<>]*)["'`]/gi)) {
      if (/\.(?:css|png|jpe?g|svg|gif|woff2?)(?:\?|$)/i.test(m[1])) continue;
      urls.add(new URL(m[1], ORIGEM).href);
    }
    for (const m of c.matchAll(/action\s*[:=]\s*["'`]([\w-]*(?:calend|event|feriad)[\w-]*)["'`]/gi)) {
      urls.add(`${ORIGEM}/wp-admin/admin-ajax.php?action=${encodeURIComponent(m[1])}`);
    }
  }
  return [...urls].slice(0, 25);
}

/** Variações de uma URL para pedir um intervalo de datas. */
export function comIntervalo(url, inicio, fim) {
  const u = new URL(url);
  let mexeu = false;
  for (const k of [...u.searchParams.keys()]) {
    if (/^(start|inicio|data_?inicio|de|from|dt_?inicio|start_?date)$/i.test(k)) { u.searchParams.set(k, inicio); mexeu = true; }
    if (/^(end|fim|data_?fim|ate|to|dt_?fim|end_?date)$/i.test(k)) { u.searchParams.set(k, fim); mexeu = true; }
    if (/^(ano|year)$/i.test(k)) { u.searchParams.set(k, inicio.slice(0, 4)); mexeu = true; }
  }
  return { url: u.href, mexeu };
}

async function provarUrl(url, ano, log) {
  const ini = `${ano}-01-01`, fim = `${ano + 1}-01-01`;
  const sep = url.includes('?') ? '&' : '?';
  const variantes = [comIntervalo(url, ini, fim).url, `${url}${sep}start=${ini}&end=${fim}`, url];
  for (const v of [...new Set(variantes)]) {
    try {
      const r = await fetch(v, { credentials: 'include' });
      const t = await r.text();
      let evs = [];
      try { evs = eventosDeJson(JSON.parse(t)); } catch { evs = jsonsEmbutidos(t); }
      log(`Calendário: tentei ${v} → HTTP ${r.status}, ${r.headers.get('content-type') || '?'}, ${t.length} caracteres, ${evs.length} evento(s). Início: ${t.slice(0, 100).replace(/\s+/g, ' ')}`);
      if (evs.length) return { url: v, eventos: evs };
    } catch (e) { log(`Calendário: tentei ${v} → erro ${e.message}`); }
  }
  if (/admin-ajax\.php/.test(url)) {
    try {
      const u = new URL(url);
      const corpo = new URLSearchParams({ action: u.searchParams.get('action') || '', start: ini, end: fim });
      const t = await texto(`${u.origin}${u.pathname}`, { method: 'POST', body: corpo, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      const evs = eventosDeJson(JSON.parse(t));
      if (evs.length) return { url, metodo: 'POST', corpo: corpo.toString(), eventos: evs };
    } catch {}
  }
  return null;
}

/**
 * Tenta obter os eventos do ano sem intervenção: eventos embutidos na página,
 * ou um endereço de dados citado nos scripts da página.
 */
export async function descobrirCalendario(ano, log = () => {}) {
  const html = await texto(URL_CALENDARIO);
  const eventosHtml = eventosDoHtml(html);
  if (eventosHtml.length) {
    log(`Calendário: ${eventosHtml.length} evento(s) lidos dos dados incorporados no HTML oficial.`);
    return { fonte: { tipo: 'pagina' }, eventos: eventosHtml };
  }
  log(`Calendário: HTML oficial recebido sem elementos .eventos_calendario (${html.length} caracteres). Início: ${html.slice(0, 180).replace(/\s+/g, ' ')}`);
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  const inline = scripts.map(s => s[2]).filter(Boolean);
  const embutidos = inline.flatMap(jsonsEmbutidos);
  if (embutidos.length) { log(`Calendário: ${embutidos.length} evento(s) embutidos na página.`); return { fonte: { tipo: 'pagina' }, eventos: embutidos }; }
  const externos = scripts.map(s => (s[1].match(/src=["']([^"']+)["']/) || [])[1]).filter(Boolean)
    .map(src => new URL(src, URL_CALENDARIO).href)
    .filter(u => u.startsWith(ORIGEM) && !/jquery|bootstrap|cookie|gtag|analytics|recaptcha|vlibras/i.test(u))
    .slice(0, 20);
  const codigos = [...inline];
  for (const u of externos) { try { codigos.push(await texto(u)); } catch {} }
  for (const c of codigos.slice(inline.length)) {
    const evs = jsonsEmbutidos(c);
    if (evs.length) return { fonte: { tipo: 'pagina' }, eventos: evs };
  }
  const candidatas = urlsCandidatas(codigos);
  const iframes = [...html.matchAll(/<iframe\b[^>]*src=["']([^"']+)["']/gi)].map(m => m[1]);
  log(`Calendário: ${externos.length} script(s) lidos, ${candidatas.length} endereço(s) candidato(s): ${candidatas.join(' | ') || 'nenhum'}.` +
    (iframes.length ? ` Iframes na página: ${iframes.join(' | ')}` : ' Sem iframes.'));
  for (const u of candidatas) {
    const r = await provarUrl(u, ano, log);
    if (r) return { fonte: { tipo: 'url', url: r.url, metodo: r.metodo || 'GET', corpo: r.corpo || null }, eventos: r.eventos };
  }
  return null;
}

/** Repete uma consulta conhecida (descoberta ou capturada) para o ano pedido. */
export async function consultarFonte(fonte, ano) {
  if (!fonte || fonte.tipo === 'pagina') return null;
  const ini = `${ano}-01-01`, fim = `${ano + 1}-01-01`;
  const alvo = comIntervalo(fonte.url, ini, fim);
  let corpo = fonte.corpo;
  if (corpo) {
    const p = new URLSearchParams(corpo);
    for (const k of [...p.keys()]) {
      if (/^(start|inicio|data_?inicio|de|from|start_?date)$/i.test(k)) p.set(k, ini);
      if (/^(end|fim|data_?fim|ate|to|end_?date)$/i.test(k)) p.set(k, fim);
    }
    corpo = p.toString();
  }
  const opts = fonte.metodo === 'POST'
    ? { method: 'POST', body: corpo, headers: { 'Content-Type': fonte.tipoConteudo || 'application/x-www-form-urlencoded' } } : {};
  const t = await texto(alvo.url, opts);
  return eventosDeJson(JSON.parse(t));
}

/** Datas que interessam às comarcas de trabalho (ou a todo o Estado). */
export const interessa = d => !d.municipios.length || d.municipios.some(m => COMARCA_DO_MUNICIPIO.has(m));

/** Datas das capturas feitas no navegador; devolve também a última fonte que trouxe eventos. */
export function lerCapturas(capturas = []) {
  let fonte = null; const datas = [];
  for (const c of capturas) {
    let evs = [];
    try { evs = eventosDeJson(JSON.parse(c.texto)); } catch { evs = jsonsEmbutidos(c.texto || ''); }
    if (!evs.length) continue;
    datas.push(...classificarEventos(evs).filter(interessa));
    if (!fonte) fonte = c.metodo === 'FULLCALENDAR' ? { tipo: 'fullcalendar' }
      : { tipo: 'url', url: c.url, metodo: c.metodo || 'GET', corpo: c.corpo || null, tipoConteudo: c.tipoConteudo || null, capturada: true };
  }
  return { fonte, datas };
}

/** Consulta o ano (e o seguinte, se já houver eventos) pela fonte conhecida; se não houver, tenta descobrir. */
export async function obterCalendario(ano, fonteConhecida, log = () => {}) {
  // Eventos que só existem dentro da página (FullCalendar): quem lê é a varredura em aba (background.js).
  if (fonteConhecida?.tipo === 'fullcalendar') return null;
  const anos = [ano, ano + 1];
  if (fonteConhecida && fonteConhecida.tipo === 'url') {
    const datas = [];
    for (const a of anos) {
      try { datas.push(...classificarEventos(await consultarFonte(fonteConhecida, a) || []).filter(interessa)); }
      catch (e) { log(`Calendário: falha ao consultar ${a}: ${e.message}`); }
    }
    if (datas.length) return { fonte: fonteConhecida, datas };
    log('Calendário: a fonte conhecida não devolveu eventos; tentando descobrir de novo.');
  }
  const r = await descobrirCalendario(ano, log);
  if (!r) return null;
  let datas = classificarEventos(r.eventos).filter(interessa);
  if (r.fonte.tipo === 'url') {
    try { datas.push(...classificarEventos(await consultarFonte(r.fonte, ano + 1) || []).filter(interessa)); } catch {}
  }
  return { fonte: r.fonte, datas };
}

/** Junta datas novas às já guardadas (mesma data, municípios e tipo contam uma vez). */
export function mesclarCalendario(atual, novas, fonte) {
  const mapa = new Map();
  for (const d of [...(atual?.datas || []), ...novas]) mapa.set(`${d.data}|${d.municipios.join(',')}|${d.tipo}`, d);
  return { datas: [...mapa.values()].sort((a, b) => a.data.localeCompare(b.data)), fonte: fonte || atual?.fonte || null, atualizadoEm: new Date().toISOString() };
}

/** Eventos lidos da tela do calendário (célula com data + texto do evento). */
export function datasDaTela(itens = []) {
  const eventos = itens.map(i => ({ inicio: i.data, fim: i.data, titulo: i.texto, categoria: `${i.classes || ''} ${i.cor || ''}`, descricao: '' }));
  return classificarEventos(eventos).filter(interessa);
}
