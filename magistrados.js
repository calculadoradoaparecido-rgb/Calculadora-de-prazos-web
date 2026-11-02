// Análise de atos sobre juízes: designações para responder por unidade
// (férias, licença, afastamento), concessões de férias, lotação ("Titular da…")
// e revogações de portarias anteriores.
import { fold, parseHeader, municipiosFortes, municipiosEmTrecho, datasEmTexto } from './parser.js';
import { COMARCAS } from './comarcas.js';

export const MAG_VERSION = 4;
const SEDES = new Set(COMARCAS.map(c => c.sede));

const PREFIXO = String.raw`(?:(?:MM\.?|Exmo\.?|Exma\.?|Dr\.?|Dra\.?)\s+)*(?:[Jj]u[ií]za?|[Mm]agistrad[oa])(?:\s+de\s+[Dd]ireito)?(?:\s+[Ss]ubstitut[oa])?(?:\s+[Tt]itular)?\s+`;
const NOME = String.raw`\p{Lu}[\p{L}'’.\-]+(?:\s+(?:(?:d[aeo]s?|e|DE|DA|DO|DOS|DAS|E)\s+)?\p{Lu}[\p{L}'’.\-]+)*`;
const RE_JUIZ = new RegExp(PREFIXO + '(' + NOME + ')', 'gu');
const RE_TITULAR = new RegExp(PREFIXO + '(' + NOME + ')\\s*,\\s*(?:[Jj]u[ií]za?\\s+)?[Tt]itular\\s+(d[aoe]s?\\s+[^,;]+?)(?=\\s*,|\\s+para\\b|\\s*;|\\.\\s|$)', 'gu');

const MOTIVOS = [
  [/f[eé]rias/i, 'Férias'],
  [/licen[cç]a[\s-]*(?:m[eé]dica|sa[uú]de|maternidade|paternidade|pr[eê]mio)?/i, 'Licença'],
  [/afastamento/i, 'Afastamento'],
  [/vac[aâ]ncia|unidade vaga|cargo vago/i, 'Vacância'],
  [/compensa[cç][aã]o|folga/i, 'Compensação'],
  [/impedimento|suspei[cç][aã]o/i, 'Impedimento/suspeição'],
  [/aus[eê]ncia/i, 'Ausência'],
  [/plant[aã]o/i, 'Plantão']
];
const motivoDe = t => (MOTIVOS.find(([re]) => re.test(t)) || [null, 'Não informado'])[1];

const limparNome = n => n.replace(/\s+/g, ' ').replace(/[.,;]+$/, '').trim()
  .split(' ').map(p => /^(d[aeo]s?|e)$/i.test(p) ? p.toLowerCase() : p.charAt(0) + p.slice(1).toLowerCase()).join(' ');
export const chaveNome = n => fold(n || '').replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();

function comarcaDaUnidade(unidade, comarcaPadrao = null) {
  if (!unidade) return comarcaPadrao;
  const f = fold(unidade);
  if (/mesma comarca/.test(f) && comarcaPadrao) return comarcaPadrao;
  const fortes = municipiosFortes(f);
  if (fortes.length) return fortes[0];
  const qualquer = municipiosEmTrecho(f);
  return qualquer[0] || comarcaPadrao;
}

// Divide o corpo em frases/parágrafos sem quebrar abreviações comuns.
function paragrafos(corpo) {
  return corpo.split(/\n+/).flatMap(p => p.split(/(?<=[a-zà-ú0-9)])\.\s+(?=(?:Art\.|Par[aá]grafo|\p{Lu}{2,}))/u))
    .map(p => p.trim()).filter(Boolean);
}

function periodo(trecho, anoRef, dataPub) {
  const datas = datasEmTexto(trecho, anoRef, dataPub);
  if (!datas.length) return { inicio: null, fim: null };
  const f = fold(trecho);
  if (datas.length === 1) {
    if (/\bate\s+(?:o\s+dia\s+)?\d/.test(f) && !/periodo|a partir/.test(f)) return { inicio: dataPub, fim: datas[0] };
    if (/a partir d/.test(f)) return { inicio: datas[0], fim: null };
    return { inicio: datas[0], fim: datas[0] };
  }
  return { inicio: datas[0], fim: datas[datas.length - 1] };
}

// ---------- Portarias em tabela ----------
// Modelo da Presidência: "RESOLVE designar os(as) magistrados(as) constantes da relação abaixo
// para responderem pelas Comarcas e Varas, em face das férias…", seguido de tabelas
// | Período | Comarca | Magistrado(a) Titular/Respondendo | Magistrado(a) designado(a) para responder |.
// Cada <tr> chega como "| a | b | c |" (djea.js) e cada <br> dentro da célula como " ; ".

const celulas = linha => linha.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());

/** Identifica as colunas pelo cabeçalho; devolve null se a linha não for cabeçalho desse modelo. */
function colunasDoCabecalho(cels) {
  const f = cels.map(c => fold(c));
  const ach = (re, excluir = []) => f.findIndex((c, i) => re.test(c) && !excluir.includes(i));
  const sub = ach(/designad|substitut|respondera\b/);
  if (sub < 0) return null;
  const ini = ach(/periodo|inicio|data/, [sub]);
  if (ini < 0) return null;
  const fimSep = ach(/^(?:fim|termino|data final|ate)\b/, [sub, ini]);
  const uni = ach(/comarca|unidade|vara|juizo|orgao|lotacao/, [sub, ini, fimSep]);
  if (uni < 0) return null;
  const aus = ach(/titular|afastad|em ferias|ausente|substituid/, [sub, ini, fimSep, uni]);
  return { n: cels.length, ini, fim: fimSep, uni, aus, sub };
}

const ano4 = a => a ? (a.length === 2 ? 2000 + +a : +a) : null;
const iso = (a, m, d) => {
  const dt = new Date(Date.UTC(a, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
};

/** "26/10 a 24/11/26", "08/10 a 22/10/26 e 27/10 a 31/10/26", "01/10/2026 a 30/10/2026" -> [{inicio, fim}]. */
export function periodosDaCelula(texto, anoRef, dataPub = null) {
  const t = texto.replace(/\s+/g, ' ');
  const re = /(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?\s*(?:a|à|ate|até|-|–|—)\s*(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?/gi;
  const out = [];
  for (const m of t.matchAll(re)) {
    const [d1, m1, d2, m2] = [+m[1], +m[2], +m[4], +m[5]];
    const a2 = ano4(m[6]) || ano4(m[3]) || anoRef;
    const a1 = ano4(m[3]) || (m1 > m2 ? a2 - 1 : a2);
    const inicio = iso(a1, m1, d1), fim = iso(a2, m2, d2);
    if (inicio && fim && inicio <= fim) out.push({ inicio, fim });
  }
  if (out.length) return out;
  const p = periodo(t, anoRef, dataPub);
  return p.inicio || p.fim ? [p] : [];
}

/** "José Flávio Bezerra Morais, Titular da 2ª Vara Cível do Crato" -> { nome, titularDe } */
function pessoaDaCelula(texto) {
  const t = texto.replace(/\s*;\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const semPrefixo = t.replace(new RegExp('^' + PREFIXO, 'u'), '');
  const nome = limparNome(semPrefixo.split(/\s*[,(–—-]\s*|\s+(?:titular|respondendo|juiz[a]?)\b/i)[0]);
  const mTit = /\btitular\s+(?:d[aoe]s?\s+)?(.+?)(?=\s*[,;(]|$)/i.exec(t);
  return { nome: /\p{L}{2,}\s+\p{L}{2,}/u.test(nome) ? nome : '', titularDe: mTit ? mTit[1].trim() : '' };
}

function eventosDeTabelas(corpo, { anoRef, dataPub, motivoGeral, lotPorNome, lotacoes }) {
  const eventos = [];
  let cols = null;
  for (const linha of corpo.split('\n')) {
    if (!linha.trim().startsWith('|')) continue;
    const cels = celulas(linha);
    const cab = colunasDoCabecalho(cels);
    if (cab) { cols = cab; continue; }
    if (!cols || cels.length !== cols.n) continue;
    const sub = pessoaDaCelula(cels[cols.sub]);
    if (!sub.nome) continue;
    let unidade = cels[cols.uni].replace(/\s*;\s*/g, ' ').replace(/\s+/g, ' ').trim();
    const comarca = comarcaDaUnidade(unidade);
    const ausCel = cols.aus >= 0 ? pessoaDaCelula(cels[cols.aus]) : { nome: '' };
    const txtPer = cols.fim >= 0 ? `${cels[cols.ini]} a ${cels[cols.fim]}` : cels[cols.ini];
    const pers = periodosDaCelula(txtPer.replace(/\s*;\s*/g, ' '), anoRef, dataPub);
    // Lotação do substituto ("Fulano, Titular da 2ª Vara Cível do Crato").
    let lotSub = lotPorNome.get(chaveNome(sub.nome)) || null;
    if (sub.titularDe && /vara|juizado|n[uú]cleo|unidade|turma|jecc|jecrim/i.test(sub.titularDe)) {
      const c = comarcaDaUnidade(sub.titularDe);
      lotSub = { nome: sub.nome, unidade: sub.titularDe, comarca: c };
      lotPorNome.set(chaveNome(sub.nome), lotSub);
      if (c && SEDES.has(c) && !lotacoes.some(l => chaveNome(l.nome) === chaveNome(sub.nome))) lotacoes.push(lotSub);
    }
    const motivo = motivoDe(cels.join(' ')) !== 'Não informado' ? motivoDe(cels.join(' ')) : motivoGeral;
    const trecho = linha.replace(/\s+/g, ' ').slice(0, 400);
    for (const p of pers.length ? pers : [{ inicio: null, fim: null }]) {
      eventos.push({
        tipo: 'designacao', origem: 'tabela', substituto: sub.nome,
        substitutoLotacao: lotSub ? { unidade: lotSub.unidade, comarca: lotSub.comarca } : null,
        unidade, comarca, motivo, ausente: ausCel.nome || null, ausenteTitular: false,
        inicio: p.inicio, fim: p.fim, trecho
      });
    }
  }
  return eventos;
}

/**
 * @returns {{relevante:boolean, eventos:Array, lotacoes:Array, cancela:string[]}}
 */
export function analisarMagistrados(textoBruto, meta = {}) {
  const header = parseHeader(textoBruto);
  const mNum = /N[uú]mero do ato:\s*[^\n]+/i.exec(textoBruto);
  let corpo = mNum ? textoBruto.slice(mNum.index + mNum[0].length) : textoBruto;
  const corte = corpo.search(/\n\s*(?:Voltar|Gerar PDF da Mat)/i);
  if (corte >= 0) corpo = corpo.slice(0, corte);
  const anoRef = +((header.numero.match(/\/(\d{4})/) || [])[1] || meta.anoPadrao || new Date().getFullYear());
  const dp = header.disponibilizada.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  const dataPub = dp ? `${dp[3]}-${dp[2]}-${dp[1]}` : null;
  const base = {
    id: meta.id ?? null, url: meta.id ? `https://djea-con.tjce.jus.br/materias/${meta.id}` : '',
    numero: header.numero, disponibilizada: header.disponibilizada, dataPublicacao: dataPub,
    titulo: (corpo.split('\n').find(l => l.trim()) || '').trim().slice(0, 120)
  };
  const fCorpo = fold(corpo);
  if (!/ju[ií]z|magistrad/.test(fCorpo) || !/responder|f[eé]rias|ferias|licenca|afastamento|titular/.test(fCorpo)) {
    return { ...base, relevante: false, eventos: [], lotacoes: [], cancela: [] };
  }

  // Lotação: "Juiz de Direito Fulano, Titular da Vara Única da Comarca de X"
  const lotacoes = [];
  const lotPorNome = new Map();
  for (const m of corpo.matchAll(RE_TITULAR)) {
    const nome = limparNome(m[1]);
    const unidade = m[2].replace(/^d[aoe]s?\s+/i, '').replace(/\s+/g, ' ').trim();
    // Descarta trechos que não são nome de unidade (linhas de tabela, "acervo do magistrado…" etc.).
    if (unidade.length > 140 || /\|/.test(unidade) || !/vara|juizado|n[uú]cleo|unidade|turma|c[aâ]mara/i.test(unidade)) continue;
    const comarca = comarcaDaUnidade(unidade);
    const lot = { nome, unidade, comarca };
    lotPorNome.set(chaveNome(nome), lot);
    if (comarca && SEDES.has(comarca)) lotacoes.push(lot);
  }

  // Revogações: "revoga/torna sem efeito a Portaria nº 1304/2023"
  const cancela = [...fCorpo.matchAll(/(?:revog\w*|torn\w*\s+sem\s+efeito|cancel\w*)\s+(?:d?a\s+|parcialmente\s+a\s+)?portaria\s+n[º°o.]*\s*(\d+)\s*\/\s*(\d{4})/g)]
    .map(m => `${+m[1]}/${m[2]}`).filter((v, i, a) => a.indexOf(v) === i);

  // Ausentes citados nos "considerandos" (padrão "Considerando o gozo de férias do Juiz X")
  const ausentesConsiderando = [];
  const eventos = [];
  const pars = paragrafos(corpo);
  for (const p of pars) {
    const fp = fold(p);
    if (/^considerando/.test(fp)) {
      if (/f[eé]rias|ferias|licenca|afastamento/.test(fp) && !/designou/.test(fp)) {
        const j = [...p.matchAll(RE_JUIZ)][0];
        if (j) ausentesConsiderando.push({ nome: limparNome(j[1]), motivo: motivoDe(p), ...periodo(p, anoRef, dataPub) });
      }
      continue;
    }

    // Designação para responder por unidade
    const iResp = fp.search(/\bresponder\b/);
    if (/designa|fica designad|designar/.test(fp) && iResp > 0) {
      const antes = p.slice(0, iResp);
      const juizes = [...antes.matchAll(RE_JUIZ)];
      if (!juizes.length) continue;
      const substituto = limparNome(juizes[juizes.length - 1][1]);
      const lotSub = lotPorNome.get(chaveNome(substituto)) || null;
      const depois = p.slice(iResp);
      const mUni = /responder\s*,?\s*(?:(?:sem\s+preju[ií]zo[^,]*|cumulativamente|interinamente)\s*,?\s*)*(?:pel[oa]s?|por)\s+(.+?)(?=\s*,|\s+durante\b|\s+no\s+per[ií]odo|\s+nos?\s+dias?\b|\s+at[eé]\b|\s+a\s+partir|\s+em\s+raz[aã]o|\s+por\s+motivo|\s+enquanto|\s*;|\.\s|\.$|$)/i.exec(depois);
      let unidade = mUni ? mUni[1].replace(/\s+/g, ' ').trim() : '';
      const comarca = comarcaDaUnidade(unidade, lotSub?.comarca || null);
      if (comarca) unidade = unidade.replace(/d[ae]\s+mesma\s+comarca/i, `da Comarca de ${comarca}`);
      let motivo = motivoDe(depois);
      if (motivo === 'Plantão') continue;
      let ausente = null;
      const mAus = new RegExp(String.raw`(?:f[eé]rias|licen[cç]a[^,;]{0,25}?|afastamento|aus[eê]ncia|impedimento)\s+(?:regulamentares\s+)?d[oa]\s+` + PREFIXO + '(' + NOME + ')', 'u').exec(depois);
      if (mAus) ausente = limparNome(mAus[1]);
      const per = periodo(depois, anoRef, dataPub);
      if (!ausente && ausentesConsiderando.length) {
        const c = ausentesConsiderando.find(a => !per.inicio || !a.inicio || a.inicio <= (per.fim || per.inicio)) || ausentesConsiderando[0];
        ausente = c.nome;
        if (motivo === 'Não informado') motivo = c.motivo;
        if (!per.inicio && c.inicio) { per.inicio = c.inicio; per.fim = c.fim; }
      }
      eventos.push({
        tipo: 'designacao', substituto, substitutoLotacao: lotSub ? { unidade: lotSub.unidade, comarca: lotSub.comarca } : null,
        unidade, comarca, motivo, ausente,
        ausenteTitular: !ausente && /d[ao]\s+(?:magistrad[ao]|ju[ií]za?)\s+titular|d[ao]\s+titular/i.test(depois),
        inicio: per.inicio, fim: per.fim, trecho: p.replace(/\s+/g, ' ').slice(0, 400)
      });
      continue;
    }

    // Concessão de férias/licença sem designação ("Conceder ao Juiz X ... férias ...")
    if (/conced|deferi|autoriz|marca/.test(fp) && /f[eé]rias|ferias|licenca/.test(fp)) {
      const j = [...p.matchAll(RE_JUIZ)][0];
      if (!j) continue;
      const nome = limparNome(j[1]);
      const lot = lotPorNome.get(chaveNome(nome));
      const per = periodo(p, anoRef, dataPub);
      if (!per.inicio && !per.fim) continue;
      eventos.push({
        tipo: 'ausencia', substituto: null, substitutoLotacao: null,
        unidade: lot?.unidade || '', comarca: lot?.comarca || comarcaDaUnidade(p) || null,
        motivo: motivoDe(p), ausente: nome, ausenteTitular: false,
        inicio: per.inicio, fim: per.fim, trecho: p.replace(/\s+/g, ' ').slice(0, 400)
      });
    }
  }

  // Portarias em tabela (Período | Comarca | Titular | Designado).
  const resolve = pars.find(p => /resolve|designa/i.test(p) && /abaixo|rela[cç][aã]o|seguintes|tabela/i.test(p)) || corpo;
  const motivoGeral = motivoDe(resolve);
  eventos.push(...eventosDeTabelas(corpo, { anoRef, dataPub, motivoGeral, lotPorNome, lotacoes }));

  // Quem está de férias/licença numa unidade é o titular dela (se não for vacância).
  // Nas tabelas a coluna é "Titular/Respondendo", então não se infere lotação a partir dela.
  for (const e of eventos) {
    if (e.tipo === 'designacao' && e.origem !== 'tabela' && e.ausente && e.unidade && SEDES.has(e.comarca) &&
        !['Vacância', 'Impedimento/suspeição'].includes(e.motivo) && !lotPorNome.has(chaveNome(e.ausente))) {
      const lot = { nome: e.ausente, unidade: e.unidade, comarca: e.comarca, inferida: true };
      lotPorNome.set(chaveNome(e.ausente), lot);
      lotacoes.push(lot);
    }
  }

  const nossos = eventos.filter(e => SEDES.has(e.comarca) || SEDES.has(e.substitutoLotacao?.comarca));
  const relevante = nossos.length > 0 || lotacoes.length > 0 || cancela.length > 0;
  return { ...base, relevante, eventos: nossos, lotacoes, cancela };
}
