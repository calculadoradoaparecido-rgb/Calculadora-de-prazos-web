// Acesso ao DJEA do TJCE (https://djea-con.tjce.jus.br).
// A extensão tem host_permission para o domínio, então as requisições
// saem do navegador do usuário sem bloqueio de CORS.
export const BASE = 'https://djea-con.tjce.jus.br';

export const espera = (ms, signal) => new Promise((ok, falha) => {
  if (signal?.aborted) return falha(new DOMException('Interrompido', 'AbortError'));
  const t = setTimeout(ok, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); falha(new DOMException('Interrompido', 'AbortError')); }, { once: true });
});

/**
 * GET/POST com até 4 tentativas. Repete em erro de rede, tempo esgotado (30 s),
 * HTTP 429 e 5xx, esperando 1,5 s, 3 s, 6 s... (ou o Retry-After do servidor).
 * Devolve null só para 404.
 */
export async function obterHtml(url, { signal, method = 'GET', body, tentativas = 4 } = {}) {
  let ultimo;
  for (let t = 0; t < tentativas; t++) {
    if (signal?.aborted) throw new DOMException('Interrompido', 'AbortError');
    const ctrl = new AbortController();
    const relogio = setTimeout(() => ctrl.abort(), 30000);
    const repassa = () => ctrl.abort();
    signal?.addEventListener('abort', repassa, { once: true });
    let esperar = 1500 * 2 ** t;
    try {
      const opts = { credentials: 'include', signal: ctrl.signal, method };
      if (body) {
        opts.body = body;
        opts.headers = { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' };
      }
      const r = await fetch(url, opts);
      if (r.status === 404) return null;
      if (r.ok) return await r.text();
      ultimo = new Error(`HTTP ${r.status}`);
      const ra = +r.headers.get('Retry-After');
      if (ra) esperar = ra * 1000;
      if (r.status !== 429 && r.status < 500) throw ultimo;
    } catch (e) {
      if (signal?.aborted) throw new DOMException('Interrompido', 'AbortError');
      ultimo = e.name === 'AbortError' ? new Error('tempo esgotado') : e;
      if (/HTTP 4\d\d/.test(ultimo.message) && !/429/.test(ultimo.message)) throw ultimo;
    } finally {
      clearTimeout(relogio);
      signal?.removeEventListener('abort', repassa);
    }
    if (t < tentativas - 1) await espera(esperar, signal);
  }
  throw new Error(`${ultimo?.message || 'falha'} em ${url} (após ${tentativas} tentativas)`);
}

export const paraDoc = html => new DOMParser().parseFromString(html, 'text/html');

// HTML -> texto preservando parágrafos e transformando cada <tr> em "| a | b | c |".
const BLOCOS = new Set(['P','DIV','H1','H2','H3','H4','H5','H6','LI','UL','OL','TABLE','THEAD','TBODY',
  'SECTION','ARTICLE','HR','BLOCKQUOTE','PRE','HEADER','FOOTER','NAV','MAIN','DL','DT','DD']);

export function htmlParaTexto(raiz) {
  const out = [];
  const andar = (no, emCelula) => {
    if (no.nodeType === 3) { out.push(no.nodeValue.replace(/\s+/g, ' ')); return; }
    if (no.nodeType !== 1) return;
    const t = no.tagName;
    if (t === 'SCRIPT' || t === 'STYLE' || t === 'NOSCRIPT' || t === 'TEMPLATE') return;
    if (t === 'BR') { out.push(emCelula ? ' ; ' : '\n'); return; }
    if (t === 'TR' && !emCelula) {
      const celulas = [...no.children].filter(c => c.tagName === 'TD' || c.tagName === 'TH').map(c => {
        const ini = out.length;
        for (const filho of c.childNodes) andar(filho, true);
        const txt = out.splice(ini).join('').replace(/\s+/g, ' ').replace(/^( ; )+|( ; )+$/g, '').trim();
        return txt.replace(/\|/g, '/');
      });
      out.push('\n| ' + celulas.join(' | ') + ' |\n');
      return;
    }
    const bloco = BLOCOS.has(t);
    if (bloco) out.push(emCelula ? ' ; ' : '\n');
    for (const filho of no.childNodes) andar(filho, emCelula);
    if (bloco) out.push(emCelula ? ' ; ' : '\n');
  };
  andar(raiz, false);
  return out.join('')
    .split('\n').map(l => l.replace(/[ \t\u00a0]+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();
}

/** Baixa uma matéria e devolve o texto, ou null se o ID não existir. */
export async function baixarMateria(id, signal) {
  const html = await obterHtml(`${BASE}/materias/${id}`, { signal });
  if (!html) return null;
  const doc = paraDoc(html);
  const texto = htmlParaTexto(doc.body);
  if (!/Local de Publica[cç][aã]o/i.test(texto)) {
    if (/n[aã]o (foi )?encontrad|inexistente|n[aã]o existe/i.test(texto)) return null;
    throw new Error('a página veio sem o conteúdo da matéria');
  }
  return texto;
}

// ---------- Formulário de consulta ----------

const ehCampo = el => el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName);
const tipoDeInput = el => (el.getAttribute('type') || 'text').toLowerCase();

function campoPorRotulo(form, doc, re) {
  for (const l of form.querySelectorAll('label')) {
    if (!re.test(l.textContent)) continue;
    let el = l.htmlFor ? doc.getElementById(l.htmlFor) : null;
    if (!ehCampo(el)) el = l.querySelector('input,select,textarea');
    if (!el) {
      let n = l.nextElementSibling, passos = 0;
      while (n && !el && passos++ < 4) {
        el = ehCampo(n) ? n : n.querySelector('input,select,textarea');
        n = n.nextElementSibling;
      }
    }
    if (!el && l.parentElement) el = l.parentElement.querySelector('input,select,textarea');
    if (el) return el;
  }
  return null;
}

const temOpcao = (sel, re) => [...sel.options].some(o => re.test(o.textContent.trim()));

/**
 * Lê a página de consulta e identifica os campos pelo rótulo/opções,
 * sem depender dos nomes internos (que podem mudar).
 */
export async function descobrirFormulario(log, signal) {
  const html = await obterHtml(`${BASE}/materias`, { signal });
  if (!html) throw new Error('A página de consulta do DJEA não respondeu.');
  const doc = paraDoc(html);
  const selects = [...doc.querySelectorAll('select')];
  const selTipo = selects.find(s => temOpcao(s, /^PORTARIA$/i));
  const form = selTipo?.closest('form') || doc.querySelector('form');
  if (!form) throw new Error('Formulário de consulta não encontrado na página do DJEA.');

  const campos = [...form.querySelectorAll('input,select,textarea')];
  const ano = campoPorRotulo(form, doc, /ano do ato/i) || campos.find(e => /(^|_|\[)ano/i.test(e.name || ''));
  const numero = campoPorRotulo(form, doc, /n[uú]mero do ato/i);
  const ordem = selects.find(s => form.contains(s) && temOpcao(s, /mais recente/i));
  const excluir = new Set(['radio', 'checkbox', 'hidden', 'submit', 'button', 'date', 'number']);
  let termo = campos.find(e => e.tagName !== 'SELECT' && !excluir.has(tipoDeInput(e)) &&
    /termo|texto|search|busca|palavra|query|pesquisa|conteudo|^q$/i.test(e.name || e.id || ''));
  if (!termo) {
    termo = campos.find(e => e.tagName === 'INPUT' && ['text', 'search'].includes(tipoDeInput(e)) &&
      e !== ano && e !== numero && !/data|period|inicio|fim|ano|numero/i.test((e.name || '') + (e.id || '')));
  }
  const textoDoRadio = r => (r.closest('label')?.textContent ||
    (r.id && doc.querySelector(`label[for="${r.id}"]`)?.textContent) ||
    r.nextSibling?.textContent || r.parentElement?.textContent || '');
  const radios = [...form.querySelectorAll('input[type=radio]')];
  const radioQualquerOrdem = radios.find(r => /qualquer ordem/i.test(textoDoRadio(r))) || null;
  const submit = form.querySelector('input[type=submit][name], button[type=submit][name], button[name]:not([type])');
  const descr = el => el ? `${el.tagName.toLowerCase()}[name="${el.name || ''}"]` : 'não encontrado';
  log(`Formulário: ${(form.getAttribute('method') || 'get').toUpperCase()} ${form.getAttribute('action') || '(mesma página)'}`);
  log(`  "palavras em qualquer ordem" → ${descr(radioQualquerOrdem)}`);
  log(`  termo → ${descr(termo)} | tipo → ${descr(selTipo)} | ano → ${descr(ano)} | ordem → ${descr(ordem)}`);
  if (!termo) log('  Atenção: campo de termo não identificado; a pesquisa vai trazer matérias sem filtro de texto.');

  return {
    form, selTipo, ano, termo, ordem, submit, radioQualquerOrdem,
    action: new URL(form.getAttribute('action') || '/materias', BASE).href,
    method: (form.getAttribute('method') || 'get').toLowerCase()
  };
}

function serializar(form, valores, submit) {
  const p = new URLSearchParams();
  const gruposSobrescritos = new Set([...valores.keys()].filter(e => tipoDeInput(e) === 'radio').map(e => e.name));
  for (const el of form.querySelectorAll('input,select,textarea')) {
    if (!el.name || el.disabled) continue;
    const tipo = tipoDeInput(el);
    if (tipo === 'radio' && gruposSobrescritos.has(el.name) && !valores.has(el)) continue;
    if (['submit', 'button', 'file', 'reset', 'image'].includes(tipo)) continue;
    if (valores.has(el)) { p.append(el.name, valores.get(el)); continue; }
    if ((tipo === 'checkbox' || tipo === 'radio') && !el.checked) continue;
    if (el.tagName === 'SELECT') {
      if (el.multiple) [...el.selectedOptions].forEach(o => p.append(el.name, o.value));
      else p.append(el.name, el.value);
      continue;
    }
    p.append(el.name, el.value);
  }
  if (submit?.name) p.append(submit.name, submit.value || submit.textContent.trim());
  return p;
}

function idsDoHtml(html) {
  const ids = new Set();
  for (const m of html.matchAll(/materias\/(\d{2,})/g)) ids.add(+m[1]);
  return ids;
}

function paginacao(html) {
  let nome = null, max = 1;
  for (const m of html.matchAll(/[?&](?:amp;)?(page|pagina|pg|p)=(\d+)/gi)) {
    nome = nome || m[1];
    max = Math.max(max, +m[2]);
  }
  return { nome: nome || 'page', max };
}

/**
 * Faz uma pesquisa por termo e percorre as páginas de resultado.
 * Devolve o conjunto de IDs de matéria encontrados.
 */
export async function pesquisar(f, { termo, ano, somentePortarias, maxPaginas, qualquerOrdem = false, pararEmConhecidos = null, signal, log }) {
  const valores = new Map();
  if (f.termo) valores.set(f.termo, termo);
  if (f.ano) valores.set(f.ano, String(ano));
  if (f.selTipo) {
    const op = [...f.selTipo.options].find(o => /^PORTARIA$/i.test(o.textContent.trim()));
    valores.set(f.selTipo, somentePortarias && op ? op.value : '');
  }
  if (f.ordem) {
    const op = [...f.ordem.options].find(o => /mais recente/i.test(o.textContent));
    if (op) valores.set(f.ordem, op.value);
  }
  if (qualquerOrdem && f.radioQualquerOrdem) valores.set(f.radioQualquerOrdem, f.radioQualquerOrdem.value);
  const base = serializar(f.form, valores, f.submit);

  let nomePag = 'page';
  const pedir = async pagina => {
    const p = new URLSearchParams(base);
    if (pagina > 1) p.set(nomePag, String(pagina));
    if (f.method === 'post') return obterHtml(f.action, { signal, method: 'POST', body: p.toString() });
    const u = new URL(f.action);
    p.forEach((v, k) => u.searchParams.append(k, v));
    return obterHtml(u.href, { signal });
  };

  const html1 = (await pedir(1)) || '';
  const pag1 = paginacao(html1);
  nomePag = pag1.nome;
  let maxConhecido = pag1.max;
  const ids = idsDoHtml(html1);
  const falhas = [];
  let p = 2, vazias = 0;
  // Modo incremental: só vale se os resultados vierem do mais recente para o mais antigo.
  const soConhecidos = conj => pararEmConhecidos && f.ordem && conj.size && [...conj].every(i => pararEmConhecidos.has(i));
  if (soConhecidos(ids)) maxConhecido = 1;
  // O paginador costuma mostrar só algumas páginas por vez; o máximo é atualizado a cada página lida.
  while (p <= Math.min(maxConhecido, maxPaginas) && !signal?.aborted) {
    try {
      const html = (await pedir(p)) || '';
      maxConhecido = Math.max(maxConhecido, paginacao(html).max);
      const novos = idsDoHtml(html);
      novos.forEach(i => ids.add(i));
      vazias = novos.size ? 0 : vazias + 1;
      if (vazias >= 2) break;
      if (soConhecidos(novos)) { p++; break; }
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      falhas.push(p);
    }
    p++;
  }
  if (!pararEmConhecidos) log(`"${termo}": ${ids.size} matérias em ${p - 1} página(s)` +
      (maxConhecido > maxPaginas ? `; há mais páginas além do limite de ${maxPaginas}` : '') +
      (falhas.length ? `; páginas com falha: ${falhas.join(', ')}` : '') + '.');
  return { ids, falhas: falhas.length, cortado: !pararEmConhecidos && maxConhecido > maxPaginas, paginas: p - 1 };
}

export async function emLotes(itens, conexoes, fn, aoAvancar, signal) {
  let i = 0, feitos = 0;
  const trabalhadores = Array.from({ length: Math.max(1, conexoes) }, async () => {
    while (i < itens.length && !signal?.aborted) {
      const k = i++;
      try { await fn(itens[k], k); } catch (e) { if (e.name !== 'AbortError') console.warn(e); }
      feitos++;
      aoAvancar?.(feitos, itens.length);
    }
  });
  await Promise.all(trabalhadores);
}
