// Análise do texto de uma matéria do DJEA (TJCE).
// Trabalha só com texto: o HTML já chega convertido por djea.js (htmlToText),
// com linhas de tabela no formato "| célula | célula |".
import { MUNICIPIOS } from './municipios.js';

export const PARSER_VERSION = 14;

const MES_RE = '(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)';
const MESES = ['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];

// Remove acentos e passa para minúsculas SEM alterar o comprimento do texto,
// para que os índices do texto "dobrado" valham também no texto original.
export function fold(s) {
  let o = '';
  for (const c of s) {
    let b = c.normalize('NFD')[0].toLowerCase();
    if (b.length !== c.length) b = c.length === 1 ? c.toLowerCase().slice(0, 1) : c;
    o += b;
  }
  return o;
}

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Nomes que também são palavras comuns (e "março" sem acento vira "marco").
// Só contam quando vêm depois de "Comarca de", "Município de" etc.
const AMBIGUOS = new Set([
  'marco','cruz','graca','jardim','barro','milagres','aurora','independencia','redencao','granja',
  'catarina','salitre','umari','ipu','jati','fortim','baixio','horizonte','caridade','cascavel',
  'cedro','choro','madalena','palhano','porteiras','tarrafas','morrinhos','iracema','mulungu'
]);

const MUNI = MUNICIPIOS.map(nome => ({ nome, f: fold(nome) })).sort((a, b) => b.f.length - a.f.length);
const MUNI_POR_F = new Map(MUNI.map(m => [m.f, m.nome]));
const NOMES_ALT = MUNI.map(m => esc(m.f)).join('|');
const NOMES_NAO_AMBIGUOS = MUNI.filter(m => !AMBIGUOS.has(m.f)).map(m => esc(m.f)).join('|');

const ANCORA_SRC =
  '(?:comarcas?|municipios?|cidades?|forum|termos? judiciarios?|distritos? judiciarios?|vara unica)' +
  '\\s+(?:d[eoa]\\s+)?(?:(?:vinculad|agregad|anex)[ao]s?\\s+)?(?:(?:da|de)\\s+comarca\\s+)?(?:de|do|da|dos|das)\\s+';

// Cada "âncora" (Comarca de, Município de...) seguida de um ou mais nomes
// ("Comarcas de Crato, Barbalha e Missão Velha") vira uma cadeia com posição.
function cadeiasFortes(f) {
  const cadeias = [];
  const ancora = new RegExp(ANCORA_SRC, 'g');
  const nome = new RegExp(`(?:${NOMES_ALT})\\b`, 'y');
  const sep = /\s*(?:,|\be\b)\s*/y;
  let m;
  while ((m = ancora.exec(f))) {
    let p = ancora.lastIndex;
    const nomes = [];
    for (;;) {
      nome.lastIndex = p;
      const n = nome.exec(f);
      if (!n) break;
      nomes.push(MUNI_POR_F.get(n[0]));
      p = nome.lastIndex;
      sep.lastIndex = p;
      if (!sep.exec(f)) break;
      p = sep.lastIndex;
    }
    if (nomes.length) cadeias.push({ pos: m.index, fim: p, nomes });
  }
  return cadeias;
}

export function municipiosFortes(f) {
  return [...new Set(cadeiasFortes(f).flatMap(c => c.nomes))];
}

// Município da data: a última cadeia antes da data na mesma linha;
// se não houver, todas as cadeias da linha.
function municipiosDaLinha(linhaF, posNaLinha) {
  const cadeias = cadeiasFortes(linhaF);
  const antes = cadeias.filter(c => c.pos < posNaLinha);
  if (antes.length) {
    // Junta cadeias ligadas só por conectivos: "Comarca de Caririaçu e na Comarca Agregada de Granjeiro".
    const grupo = [antes[antes.length - 1]];
    for (let i = antes.length - 2; i >= 0; i--) {
      const entre = linhaF.slice(antes[i].fim, grupo[0].pos);
      if (!/^\s*(?:,|;|\be\b|\bbem como\b)?\s*(?:(?:n|d)?[ao]s?\s+)?(?:(?:forum|unidades?|varas?)\s+(?:d[ao]s?\s+)?)?$/.test(entre)) break;
      grupo.unshift(antes[i]);
    }
    return [...new Set(grupo.flatMap(c => c.nomes))];
  }
  return [...new Set(cadeias.flatMap(c => c.nomes))];
}

function municipiosFracos(f) {
  const out = new Set();
  const re = new RegExp(`\\b(?:${NOMES_NAO_AMBIGUOS})\\b`, 'g');
  let m;
  while ((m = re.exec(f))) out.add(MUNI_POR_F.get(m[0]));
  return [...out];
}

export function parseHeader(texto) {
  const g = re => ((texto.match(re) || [])[1] || '').trim();
  return {
    local: g(/Local de Publica[cç][aã]o:\s*([^\n]+)/i),
    disponibilizada: g(/Disponibilizada em:\s*([^\n]+)/i),
    numero: g(/N[uú]mero do ato:\s*([^\n]+)/i)
  };
}

function isoDe(a, m, d) {
  const dt = new Date(Date.UTC(a, m - 1, d));
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

// Reescreve linhas de tabela do tipo "| AGOSTO | 15 | Dia de N. Sra. ... |"
// como "15 de agosto de 2026 | Dia de N. Sra. ...", para o extrator de datas pegar.
// Reescreve linhas de anexo ("| MARÇO | 19 ; 25 | São José ; Data Magna |") como uma linha
// por data ("19 de marco de 2026 | São José"), marcadas com "§T " para o extrator saber
// que vieram de tabela (cada linha de anexo já é, por si, a declaração da data).
function reescreverTabelas(texto, anoAto) {
  let mesAtual = null, anoAtual = anoAto;
  const reMesRotulo = new RegExp(`^${MES_RE}(?:\\s*(?:\\/|de)?\\s*(\\d{2}|\\d{4}))?$`);
  const reInicioPeriodo = new RegExp(`^(\\d{1,2})\\s+de\\s+${MES_RE}\\s+de\\s+(\\d{4})`);
  return texto.split('\n').map(linha => {
    if (!linha.trim().startsWith('|')) { mesAtual = null; return linha; }
    const cel = linha.split('|').map(c => c.trim());
    if (cel[0] === '') cel.shift();
    if (cel.length && cel[cel.length - 1] === '') cel.pop();
    if (cel.length < 2) return linha;
    const c0 = fold(cel[0]).replace(/\s+/g, ' ').replace(/^[ ;]+|[ ;]+$/g, '').trim();
    const mRot = c0.match(reMesRotulo);
    const mPer = c0.match(reInicioPeriodo);
    if (mRot) {
      mesAtual = mRot[1];
      if (mRot[2]) anoAtual = mRot[2].length === 2 ? 2000 + +mRot[2] : +mRot[2];
    } else if (mPer) {
      // Rótulo de período ("01 DE DEZEMBRO DE 2026 a 06 JANEIRO DE 2027"): só fornece mês/ano.
      mesAtual = mPer[2]; anoAtual = +mPer[3];
    } else if (c0 !== '') {
      return linha;
    }
    const descr = cel.slice(2).join(' | ');
    if (!mesAtual || !/\d/.test(cel[1])) return '§T ' + descr;
    const partesDias = cel[1].split(';').map(x => x.trim()).filter(Boolean);
    const partesDescr = descr.split(';').map(x => x.trim()).filter(Boolean);
    const parear = partesDias.length > 1 && partesDias.length === partesDescr.length;
    return partesDias.map((d, i) => {
      const desc = parear ? partesDescr[i] : descr;
      if (/\d{1,2}\/\d{1,2}/.test(d)) return `§T ${d} | ${desc}`;
      const lista = d.replace(/\([^)]*\)/g, ' ').replace(/(\d)\s+(?=\d)/g, '$1, ').replace(/\s+/g, ' ').trim();
      if (!/\d/.test(lista)) return `§T ${desc}`;
      return `§T ${lista} de ${mesAtual} de ${anoAtual} | ${desc}`;
    }).join('\n');
  }).join('\n');
}

// Apaga a linha de assinatura ("..., em Fortaleza, 09 de janeiro de 2024.")
function mascararAssinaturas(texto) {
  const re = new RegExp(`[a-z)]\\s*(?:\\/\\s*ce)?\\s*,\\s*(?:em\\s+)?\\d{1,2}\\s*[º°]?\\s+de\\s+${MES_RE}\\s+de\\s+\\d{4}\\s*\\.?\\s*$`);
  let cidade = null;
  const linhas = texto.split('\n').map(l => {
    const lf = fold(l);
    if (!re.test(lf)) return l;
    const nome = new RegExp(`(?:^|[\\s,])(${NOMES_ALT})\\s*(?:\\/\\s*ce)?\\s*,`).exec(lf);
    if (nome) cidade = MUNI_POR_F.get(nome[1]);
    return ' '.repeat(l.length);
  });
  return { texto: linhas.join('\n'), cidade };
}

const RE_GATILHO_LOCAL = /\b(?:dia|dias|no|nos|na|nas|em|entre|data|datas|ate|e)\s*$/;
const RE_REFERENCIA = /\b(?:lei|leis|decreto|portaria|resolucao|provimento|emenda|oficio|processo|proc|dje|djea|djen|doe|dou|publicad[ao]s?|datad[ao]s?|assinad[ao]s?|edicao|nascid[ao])\b(?:[^.;:\n]|[.:](?=\d))*$/;

function ehReferencia(f, idx) {
  const pre = f.slice(Math.max(0, idx - 90), idx);
  if (RE_GATILHO_LOCAL.test(pre)) return false;
  return RE_REFERENCIA.test(pre);
}

function extrairDatas(f, anoAto, dataPub) {
  const achados = [];
  const ajustaAno = (d, m) => {
    let a = anoAto;
    if (dataPub) {
      const iso = isoDe(a, m, d);
      if (iso && (new Date(dataPub) - new Date(iso)) / 864e5 > 60) a += 1;
    }
    return a;
  };

  // 1) Por extenso: "dia 13 (treze) de abril de 2026", "dias 15, 16 e 17 de agosto", "de 20 a 24 de junho"
  const NUM = '\\d{1,2}(?:\\s*[º°])?(?:\\s*\\([^)\\n]{1,40}\\))?';
  const reTxt = new RegExp(
    `\\b(${NUM}(?:\\s*(?:,|\\be\\b|\\ba\\b|\\bate\\b)\\s*${NUM})*)\\s+de\\s+${MES_RE}(?:\\s*(?:de|\\/)\\s*(\\d{4}))?`, 'g');
  let m;
  while ((m = reTxt.exec(f))) {
    if (ehReferencia(f, m.index)) continue;
    const mes = MESES.indexOf(m[2]) + 1;
    let ano = m[3] ? +m[3] : null;
    if (!ano) {
      const adiante = f.slice(reTxt.lastIndex, reTxt.lastIndex + 70).match(/^[^.\n]*?\bde\s+(\d{4})\b/);
      if (adiante) ano = +adiante[1];
    }
    const tokens = m[1].replace(/\([^)]*\)/g, ' ').match(/\d{1,2}|\ba\b|\bate\b/g) || [];
    const dias = [];
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if ((t === 'a' || t === 'ate') && dias.length && /^\d+$/.test(tokens[i + 1] || '')) {
        const ini = dias[dias.length - 1], fim = +tokens[i + 1];
        for (let d = ini + 1; d <= fim && d - ini < 40; d++) dias.push(d);
        i++;
      } else if (/^\d+$/.test(t)) dias.push(+t);
    }
    for (const d of dias) {
      const a = ano || ajustaAno(d, mes);
      const iso = isoDe(a, mes, d);
      if (iso) achados.push({ iso, idx: m.index });
    }
  }

  // 2) Numéricas: 13/04/2026, 13.04.26 — e faixas "20/12/2026 a 06/01/2027"
  const reNum = /\b(\d{1,2})[\/.](\d{1,2})[\/.](\d{4}|\d{2})\b/g;
  const nums = [];
  while ((m = reNum.exec(f))) {
    if (ehReferencia(f, m.index)) continue;
    const a = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    const iso = isoDe(a, +m[2], +m[1]);
    if (iso) nums.push({ iso, idx: m.index, fim: reNum.lastIndex });
  }
  for (let i = 0; i < nums.length; i++) {
    achados.push({ iso: nums[i].iso, idx: nums[i].idx });
    const prox = nums[i + 1];
    if (prox && /^\s*(?:a|ate)\s*$/.test(f.slice(nums[i].fim, prox.idx))) {
      let d = new Date(nums[i].iso), fim = new Date(prox.iso), n = 0;
      while (d < fim && n++ < 40) {
        d = new Date(d.getTime() + 864e5);
        if (d < fim) achados.push({ iso: d.toISOString().slice(0, 10), idx: nums[i].idx });
      }
    }
  }

  return achados.filter(x => { const d = +x.iso.slice(0, 4) - anoAto; return d >= -1 && d <= 2; });
}

// Fechamento de só parte do dia ("a partir das 12:00 horas", "no período da tarde", "até as 14h").
const RE_HORARIO_PARCIAL = /a partir d[ea]s?\s*\d{1,2}\s*(?:h|:|horas)|ate as?\s*\d{1,2}\s*(?:h|:|horas)|(?:no\s+)?periodo da (?:tarde|manha)|turno (?:da )?(?:tarde|manha)|turno (?:vespertino|matutino)/;

function tipoDe(f, padrao = 'Expediente alterado', olharHorario = true) {
  if (olharHorario && /ponto facultativo ate as \d|expediente (?:normal )?(?:unico )?a partir das \d/.test(f)) return 'Expediente alterado';
  // Expediente encerrado antes (ou iniciado depois) da hora normal: o dia conta, mas o começo/vencimento
  // do prazo é protraído (CPC, art. 224, § 1º) — salvo se o ato suspender expressamente os prazos.
  if (olharHorario && RE_HORARIO_PARCIAL.test(f) && /suspen|fechamento|fechad|sem expediente|nao havera expediente/.test(f)
      && !/suspen\w*\s+(?:d[oe]s?\s+)?(?:os\s+)?prazos/.test(f)) return 'Expediente alterado';
  if (/ponto facultativo/.test(f)) return 'Ponto facultativo';
  if (/feriado/.test(f)) return 'Feriado';
  if (/recesso/.test(f)) return 'Recesso';
  const suspendeExpediente = /suspen\w*\s+(?:d[oe]s?\s+)?(?:[oa]s?\s+)?(?:expediente|atendimento)|nao havera expediente|sem expediente/.test(f);
  if (!suspendeExpediente && RE_PRAZOS_SUSPENSOS.test(f) && !RE_PRAZOS_CORREM.test(f)) return 'Suspensão de prazos';
  if (suspendeExpediente) return 'Suspensão de expediente';
  if (/antecip|adia|prorrog|reduzid|ate as \d|a partir das \d|teletrabalho/.test(f)) return 'Expediente alterado';
  return padrao;
}

// Frases que efetivamente declaram dia sem expediente (ou com expediente alterado).
const RE_OPERATIVO = new RegExp([
  'ponto facultativo',
  'suspen\\w*\\s+(?:d[oe]s?\\s+|a\\s+contagem\\s+d[oe]s?\\s+)?(?:[oa]s?\\s+)?(?:expediente|atendimento|prazos?)',
  'prazos[^.;\\n]{0,50}(?:suspens|interrompid)',
  'nao havera expediente', 'sem expediente',
  '(?:declar\\w*|fix\\w*|estabelec\\w*|consider\\w*\\s+como)\\s[^.\\n]{0,60}\\bferiados?\\b',
  '(?:antecip\\w*|adia\\w*|prorrog\\w*|alter\\w*)\\s[^.\\n]{0,40}(?:expediente|horario)',
  'recesso'
].join('|'));
// Atos que só falam de feriado de passagem: escalas de plantão, designações, férias, diárias.
const RE_ASSUNTO_ALHEIO = /\b(?:escalas?|plantao|plantonistas?|designa\w*|ferias|diarias|folgas?|substitui\w*|remo\w*|lotac\w*|nomea\w*|exonera\w*)\b/;
// O que o ato diz sobre os PRAZOS (independe de haver ou não expediente).
const RE_PRAZOS_CORREM = new RegExp([
  'nao\\s+(?:havera|haverá|ocorrera|implica\\w*|acarreta\\w*)\\s+(?:a\\s+)?(?:suspensao|interrupcao|prorrogacao)\\s+(?:d[oe]s?\\s+)?(?:contagem\\s+d[oe]s?\\s+)?prazos',
  'nao\\s+(?:serao|sera|ficam|ficarao|ficara|estao|estarao)\\s+(?:suspens|interrompid|prorrogad)\\w*\\s+(?:os\\s+)?(?:prazos|a\\s+contagem)',
  'prazos\\s+(?:processuais\\s+)?(?:\\w+\\s+){0,2}?(?:transcorr|decorr|corr|flu|segu|continu|permanec|mant|ter)\\w*\\s+(?:a\\s+|o\\s+|seu\\s+)?(?:fluir|correr|transcorrer|normalmente|regularmente|em\\s+curso|inalterad|curso\\s+normal|sem\\s+(?:alteracao|suspensao|interrupcao))',
  'nao\\s+(?:havera|haverá)\\s+(?:qualquer\\s+)?(?:alteracao|prejuizo)\\s+(?:n[ao]s?\\s+|para\\s+os\\s+)?(?:contagem\\s+d[oe]s?\\s+)?prazos',
  'sem\\s+(?:a\\s+)?(?:suspensao|interrupcao|prorrogacao)\\s+(?:d[oe]s?\\s+)?prazos',
  'sem\\s+prejuizo\\s+d[aoe]s?\\s+(?:fluencia\\s+d[oe]s?\\s+|contagem\\s+d[oe]s?\\s+)?prazos',
  'mantid\\w+\\s+(?:o\\s+curso\\s+d)?os\\s+prazos'
].join('|'));
const RE_PRAZOS_SUSPENSOS = /(?:suspen|prorrog|interromp)\w*\s+(?:d[oe]s?\s+|a\s+contagem\s+d[oe]s?\s+)?(?:tod[oa]s\s+)?(?:os\s+)?prazos|prazos[^.;\n]{0,50}(?:suspens|prorrogad|interrompid)/;

// Só o atendimento PRESENCIAL é suspenso e o funcionamento remoto/virtual é garantido: prazos correm.
const RE_SO_PRESENCIAL = /suspen\w*\s+(?:d[oe]s?\s+)?(?:o\s+)?(?:atendimento|expediente)\s+(?:forense\s+)?(?:ao\s+publico\s+)?presencial/;
const RE_REMOTO_GARANTIDO = /(?:resguardad|assegurad|garantid|mantid|preservad)\w*[^.]{0,140}(?:remot|virtual|eletronic|teletrabalho|balcao virtual)|(?:remot|virtual)\w*[^.]{0,60}(?:resguardad|assegurad|garantid|mantid)|(?:servidores|atividades|trabalhos)[^.]{0,120}(?:em\s+teletrabalho|trabalho\s+remoto|regime\s+(?:de\s+)?(?:teletrabalho|remoto))/;
// Ato que vale só para uma unidade ("1º Juizado Especial… da Comarca de X"), e não para o fórum todo.
const RE_UNIDADE_ESPECIFICA = /(?:no|na|do|da)\s+((?:\d+\s*[ºª°o]?\s*)?(?:unidade\s+do\s+)?(?:vara|juizado|nucleo)[^,;:\n]{0,70}?)\s+da\s+comarca\s+d[eo]\s/;
const RE_ABRANGE_FORUM = /forum|unidades\s+judiciarias|todas\s+as\s+(?:varas|unidades)|servidores\s+(?:do|da)\s+(?:forum|comarca)|ambito\s+da\s+comarca/;

const RE_DATA_NA_LINHA = /feriado|ponto facultativo|expediente|recesso|suspen|facultativ|fechamento|fechad[oa]|interdi/;
// Linha que só informa a volta ao normal ("o expediente será retomado no dia 07"): a data não é de suspensão.
const RE_RETOMADA = /(?:retomad|restabelecid|reabert|retorn|reinicia|volta\w*\s+a\s+funcionar|funcionara\s+normalmente)/;
const RE_ATO_ESTADUAL = /presiden(?:te|cia)\s+do\s+tribunal|atos do presidente|ambito do poder judiciario do estado do ceara(?!\s+situad)|todas as comarcas|todo o estado/;

/**
 * @param {string} textoBruto texto completo da página da matéria
 * @param {{id?:number,url?:string,anoPadrao?:number}} meta
 */
export function analisarTexto(textoBruto, meta = {}) {
  const header = parseHeader(textoBruto);
  let ini = 0;
  const mNum = /N[uú]mero do ato:\s*[^\n]+/i.exec(textoBruto);
  if (mNum) ini = mNum.index + mNum[0].length;
  else {
    const mLoc = /Local de Publica[cç][aã]o:/i.exec(textoBruto);
    if (mLoc) ini = mLoc.index;
  }
  let fimCorpo = textoBruto.slice(ini).search(/\n\s*(?:Voltar|Gerar PDF da Mat)/i);
  let corpo = fimCorpo >= 0 ? textoBruto.slice(ini, ini + fimCorpo) : textoBruto.slice(ini);
  corpo = corpo.replace(/\n{3,}/g, '\n\n').trim();

  const anoAto = +((header.numero.match(/\/(\d{4})/) || [])[1] ||
                   (header.disponibilizada.match(/(\d{4})/) || [])[1] || meta.anoPadrao || new Date().getFullYear());
  const dp = header.disponibilizada.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  const dataPub = dp ? `${dp[3]}-${dp[2]}-${dp[1]}` : null;
  const titulo = (corpo.split('\n').find(l => l.trim()) || '').trim().slice(0, 120);

  const base = {
    id: meta.id ?? null,
    url: meta.url ?? (meta.id ? `https://djea-con.tjce.jus.br/materias/${meta.id}` : ''),
    titulo, local: header.local, numero: header.numero,
    disponibilizada: header.disponibilizada, dataPublicacao: dataPub, anoAto
  };

  let trabalho = reescreverTabelas(corpo, anoAto);
  const assin = mascararAssinaturas(trabalho);
  trabalho = assin.texto;
  const f = fold(trabalho);

  const naoRelevante = { ...base, relevante: false, datas: [] };
  const fSemNegacao = f.replace(new RegExp(RE_PRAZOS_CORREM.source, 'g'), m => ' '.repeat(m.length));
  if (!RE_OPERATIVO.test(fSemNegacao)) return naoRelevante;
  // Efeito nos prazos declarado no ato: 'correm' (ex.: "não haverá suspensão de prazos") ou 'suspensos'.
  const soPresencial = RE_SO_PRESENCIAL.test(f) && RE_REMOTO_GARANTIDO.test(f) && !RE_PRAZOS_SUSPENSOS.test(fSemNegacao);
  const prazosMateria = (RE_PRAZOS_CORREM.test(f) || soPresencial) ? 'correm' : (RE_PRAZOS_SUSPENSOS.test(fSemNegacao) ? 'suspensos' : null);
  // Ementa = início do ato, até a primeira tabela.
  const ementaCurta = f.slice(0, 600);
  if (RE_ASSUNTO_ALHEIO.test(ementaCurta) && !RE_OPERATIVO.test(ementaCurta)) return naoRelevante;
  const atoEstadual = RE_ATO_ESTADUAL.test(fold(header.local) + '\n' + f.slice(0, 900));
  // Escopo: a ementa (e o art. 1º) falam de uma unidade só, e não do fórum ou de todas as unidades?
  const parteDecisoria = (f.match(/(?:^|\n)\s*(?:resolve|art\.?\s*1)[\s\S]{0,600}/) || [''])[0];
  const ementaEArt1 = f.slice(0, 500) + '\n' + parteDecisoria;
  const mUni = ementaEArt1.match(RE_UNIDADE_ESPECIFICA);
  const unidadeEspecifica = mUni && !RE_ABRANGE_FORUM.test(ementaEArt1) && !atoEstadual
    ? trabalho.slice(f.indexOf(mUni[1]), f.indexOf(mUni[1]) + mUni[1].length).replace(/\s+/g, ' ').trim() : null;

  const corteTabela = f.indexOf('\n|');
  const ementa = f.slice(0, Math.min(900, corteTabela >= 0 ? corteTabela : 900));
  const localF = fold(header.local);
  const fortesMateria = [...new Set([...municipiosFortes(localF), ...municipiosFortes(ementa)])];
  const fracosMateria = municipiosFracos(ementa);
  const tipoMateria = tipoDe(f, 'Expediente alterado', false);

  const vistos = new Set();
  const datas = [];
  const ehConsiderando = idx => /^\s*considerando/.test(f.slice(f.lastIndexOf('\n', idx) + 1, idx + 1));
  let achadas = extrairDatas(f, anoAto, dataPub);
  if (achadas.some(a => !ehConsiderando(a.idx))) achadas = achadas.filter(a => !ehConsiderando(a.idx));
  for (const { iso, idx } of achadas) {
    const li = f.lastIndexOf('\n', idx) + 1;
    let lf = f.indexOf('\n', idx); if (lf < 0) lf = f.length;
    const linhaF = f.slice(li, lf);
    // A data só vale se a própria linha (ou a anterior) falar de expediente/feriado.
    const ant = f.lastIndexOf('\n', li - 2) + 1;
    const deTabela = linhaF.startsWith('§t ');
    if (!deTabela && !RE_DATA_NA_LINHA.test(linhaF) && !RE_DATA_NA_LINHA.test(f.slice(ant, li))) continue;
    if (RE_ASSUNTO_ALHEIO.test(linhaF) && !RE_OPERATIVO.test(linhaF)) continue;
    if (!deTabela && RE_RETOMADA.test(linhaF) && !/suspen|fechamento|nao havera expediente|ponto facultativo|feriado/.test(linhaF)) continue;
    let municipios = municipiosDaLinha(linhaF, idx - li);
    let origem = 'linha';
    if (!municipios.length) municipios = municipiosFracos(linhaF);
    if (!municipios.length) { municipios = fortesMateria; origem = 'ementa'; }
    if (!municipios.length) { municipios = fracosMateria; origem = 'ementa'; }
    if (!municipios.length && atoEstadual) origem = 'geral';
    else if (!municipios.length && assin.cidade) { municipios = [assin.cidade]; origem = 'assinatura'; }
    else if (!municipios.length) origem = 'indefinido';
    if (origem === 'indefinido') continue;

    const chave = iso + '|' + municipios.join(',');
    if (vistos.has(chave)) continue;
    vistos.add(chave);

    const linhaBruta = trabalho.slice(li, lf).replace(/^§T /, '').replace(/\s+/g, ' ').trim();
    let trecho = linhaBruta;
    if (trecho.length > 280) {
      const pos = idx - li;
      trecho = (pos > 120 ? '… ' : '') + linhaBruta.slice(Math.max(0, pos - 120), pos + 160) + ' …';
    }
    // Numa linha com várias justificativas ("Carnaval (16 e 17/02…); Quarta de Cinzas (18/02…)"),
    // o tipo vem do trecho que cita o próprio dia.
    const [, mm, dd] = iso.split('-');
    const trechoDoDia = linhaF.split(/\s;\s|\.\s/).find(c =>
      new RegExp(`\\b0?${+dd}\\b[^;]{0,12}\\/0?${+mm}\\b`).test(c)) || linhaF;
    const tipo = tipoDe(trechoDoDia, deTabela ? 'Feriado' : tipoMateria);
    const prazosLinha = RE_PRAZOS_CORREM.test(linhaF) ? 'correm' : (RE_PRAZOS_SUSPENSOS.test(linhaF) ? 'suspensos' : null);
    const prazos = prazosLinha || prazosMateria;
    datas.push({ data: iso, municipios, origem, tipo, trecho, ...(prazos ? { prazos } : {}), ...(unidadeEspecifica ? { unidade: unidadeEspecifica } : {}) });
  }
  datas.sort((a, b) => a.data.localeCompare(b.data));
  return { ...base, relevante: datas.length > 0, tipo: tipoMateria, prazos: prazosMateria, municipiosMateria: fortesMateria, datas };
}

/** Datas (ISO, ordenadas) citadas num trecho, com as mesmas regras do analisador de feriados. */
export function datasEmTexto(texto, anoRef, dataPub = null) {
  const f = fold(texto);
  return [...new Set(extrairDatas(f, anoRef, dataPub).map(x => x.iso))].sort();
}

/** Qualquer município citado num trecho curto (inclui nomes ambíguos). */
export function municipiosEmTrecho(f) {
  const out = new Set();
  const re = new RegExp(`\\b(?:${NOMES_ALT})\\b`, 'g');
  let m;
  while ((m = re.exec(f))) out.add(MUNI_POR_F.get(m[0]));
  return [...out];
}
