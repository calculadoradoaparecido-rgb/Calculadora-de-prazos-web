// Calendário-base e cálculo de prazos pelo CPC/2015.
// Datas sempre como 'AAAA-MM-DD' (sem fuso).

const isoUTC = d => d.toISOString().slice(0, 10);
export const somarDias = (iso, n) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return isoUTC(d);
};
export const diaSemana = iso => new Date(iso + 'T00:00:00Z').getUTCDay();
export const br = iso => iso.split('-').reverse().join('/');

export function pascoa(ano) {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return isoUTC(new Date(Date.UTC(ano, mes - 1, dia)));
}

/**
 * Datas sem expediente (ou com expediente reduzido) que valem em todo o Estado,
 * pelas leis federais/estaduais e pelo padrão das portarias anuais do TJCE.
 * efeito: 'fechado' (sem expediente) | 'reduzido' (expediente começa depois ou termina antes)
 *         | 'suspende' (expediente normal, prazos suspensos) | 'informativo' (não afeta a contagem).
 */
export function calendarioBase(ano) {
  const p = pascoa(ano);
  const tipoDe = (motivo, fonte, efeito) => efeito === 'reduzido' ? 'Expediente alterado'
    : /recesso/i.test(motivo) ? 'Recesso' : /facultativo|RI TJCE/i.test(fonte) ? 'Ponto facultativo' : 'Feriado';
  const fixo = (md, motivo, fonte, efeito = 'fechado') => ({ data: `${ano}-${md}`, motivo, fonte, efeito, escopo: 'base', tipo: tipoDe(motivo, fonte, efeito) });
  const movel = (n, motivo, fonte, efeito = 'fechado') => ({ data: somarDias(p, n), motivo, fonte, efeito, escopo: 'base', tipo: tipoDe(motivo, fonte, efeito) });
  const lista = [
    fixo('01-01', 'Confraternização Universal', 'Lei 662/1949'),
    movel(-48, 'Carnaval', 'Portaria anual de feriados do TJCE (ponto facultativo)'),
    movel(-47, 'Carnaval', 'Portaria anual de feriados do TJCE (ponto facultativo)'),
    movel(-46, 'Quarta-feira de Cinzas (expediente a partir das 14h)', 'Portaria anual de feriados do TJCE', 'reduzido'),
    movel(-3, 'Quinta-feira Santa', 'RI TJCE, art. 117, § 2º'),
    movel(-2, 'Sexta-feira da Paixão', 'RI TJCE, art. 117, § 2º'),
    fixo('03-19', 'Dia de São José, padroeiro do Ceará', 'Portaria anual de feriados do TJCE (ponto facultativo; em 2026, Portaria 2924/2025)'),
    fixo('03-25', 'Data Magna do Ceará', 'Constituição Estadual (EC 73/2011)'),
    fixo('04-21', 'Tiradentes', 'Lei 662/1949'),
    fixo('05-01', 'Dia do Trabalho', 'Lei 662/1949'),
    movel(60, 'Corpus Christi', 'Portaria anual de feriados do TJCE (ponto facultativo)'),
    fixo('09-07', 'Independência do Brasil', 'Lei 662/1949'),
    fixo('10-12', 'Nossa Senhora Aparecida', 'Lei 6.802/1980'),
    fixo('10-28', 'Dia do Servidor Público Estadual', 'Portaria anual de feriados do TJCE'),
    fixo('11-02', 'Finados', 'Lei 662/1949'),
    fixo('11-15', 'Proclamação da República', 'Lei 662/1949'),
    fixo('11-20', 'Dia Nacional de Zumbi e da Consciência Negra', 'Lei 14.759/2023'),
    fixo('12-08', 'Dia da Justiça', 'Portaria anual de feriados do TJCE'),
    fixo('12-25', 'Natal', 'Lei 662/1949')
  ];
  for (let d = 20; d <= 31; d++) lista.push(fixo(`12-${d}`, 'Recesso forense', 'Res. CNJ 244/2016'));
  for (let d = 1; d <= 6; d++) lista.push(fixo(`01-0${d}`, 'Recesso forense', 'Res. CNJ 244/2016'));
  return lista;
}

/** Mapa data -> lista de ocorrências, juntando a base de cada ano com os extras (DJEA, manuais). */
export function montarMapa(anos, extras = []) {
  const mapa = new Map();
  const add = e => { if (!mapa.has(e.data)) mapa.set(e.data, []); mapa.get(e.data).push(e); };
  for (const a of anos) calendarioBase(a).forEach(add);
  extras.forEach(add);
  return mapa;
}

// Prazos processuais suspensos de 20/12 a 20/01 (CPC, art. 220).
export const suspensoArt220 = iso => { const md = iso.slice(5); return md >= '12-20' || md <= '01-20'; };

export function situacao(iso, mapa) {
  const dow = diaSemana(iso);
  const fds = dow === 0 || dow === 6;
  const itens = mapa.get(iso) || [];
  const fechado = fds || itens.some(i => i.efeito === 'fechado');
  const reduzido = !fechado && itens.some(i => i.efeito === 'reduzido');
  const motivos = [];
  if (fds) motivos.push(dow === 0 ? 'Domingo' : 'Sábado');
  const vistos = new Set();
  for (const i of itens) if (!vistos.has(i.motivo)) { vistos.add(i.motivo); motivos.push(i.motivo); }
  const suspensoRecesso = suspensoArt220(iso);          // 20/12 a 20/01 (CPC, art. 220; CPP, art. 798-A)
  const suspensoAto = itens.some(i => i.efeito === 'suspende'); // ato que suspende os prazos
  const suspenso = suspensoRecesso || suspensoAto;
  return { iso, fds, fechado, reduzido, suspenso, suspensoRecesso, suspensoAto, itens, motivos };
}

const LIMITE = 800;
function proximo(iso, mapa, cond) {
  let d = iso;
  for (let i = 0; i < LIMITE; i++) { d = somarDias(d, 1); if (cond(situacao(d, mapa))) return d; }
  throw new Error('Não foi possível encontrar a data dentro do limite de busca.');
}
const temExpediente = s => !s.fechado;
const plenamenteUtil = s => !s.fechado && !s.reduzido;

/**
 * @param {object} o
 * @param {number} o.prazo  dias
 * @param {'uteis'|'corridos'} o.unidade
 * @param {'djen'|'portal'|'ciencia'} o.evento
 * @param {string} o.data   'AAAA-MM-DD'
 * @param {boolean} o.dobro
 * @param {Map} o.mapa
 */
export function calcularPrazo({ prazo, unidade, evento, data, dobro, mapa }) {
  const passos = [];
  const dias = [];
  const N = prazo * (dobro ? 2 : 1);
  if (dobro) passos.push({ texto: `Prazo em dobro: ${prazo} × 2 = ${N} dias.`, base: 'CPC, arts. 180, 183 e 186' });

  let marco;
  if (evento === 'djen') {
    marco = proximo(data, mapa, temExpediente);
    passos.push({ texto: `Disponibilizada em ${br(data)}; considera-se publicada no primeiro dia útil seguinte, ${br(marco)}.`,
      base: 'CPC, art. 224, § 2º; Lei 11.419/2006, art. 4º, § 3º' });
    dias.push({ data, papel: 'disponibilizacao' });
  } else if (evento === 'portal') {
    const tacita = somarDias(data, 10);
    marco = situacao(tacita, mapa).fechado ? proximo(tacita, mapa, temExpediente) : tacita;
    passos.push({ texto: `Intimação enviada em ${br(data)}. Sem consulta antes, a ciência é tácita 10 dias corridos depois (${br(tacita)})` +
      (marco !== tacita ? `, que não é dia útil; fica para ${br(marco)}.` : '.'),
      base: 'Lei 11.419/2006, art. 5º, §§ 2º e 3º' });
    dias.push({ data, papel: 'envio' });
  } else {
    marco = data;
    passos.push({ texto: `Ciência (ou juntada) em ${br(data)}: é o dia do começo, que não entra na contagem.`, base: 'CPC, arts. 224 e 231' });
  }

  const sMarco = situacao(marco, mapa);
  if (!plenamenteUtil(sMarco)) {
    const novo = proximo(marco, mapa, plenamenteUtil);
    passos.push({ texto: `${br(marco)} teve ${sMarco.fechado ? 'expediente fechado' : 'expediente reduzido'} (${sMarco.motivos.join('; ')}); o dia do começo passa para ${br(novo)}.`,
      base: 'CPC, art. 224, § 1º' });
    dias.push({ data: marco, papel: 'pulado', motivos: sMarco.motivos });
    marco = novo;
  }
  dias.push({ data: marco, papel: 'marco' });

  let cursor = marco, n = 0, inicio = null, pulados = 0;
  for (let i = 0; n < N; i++) {
    if (i > LIMITE * 2) throw new Error('Prazo longo demais para o cálculo.');
    cursor = somarDias(cursor, 1);
    const s = situacao(cursor, mapa);
    if (unidade === 'uteis') {
      if (s.fechado) { dias.push({ data: cursor, papel: 'pulado', motivos: s.motivos }); pulados++; continue; }
      if (s.suspenso) {
        const porAto = s.itens.filter(i => i.efeito === 'suspende').map(i => i.motivo);
        dias.push({ data: cursor, papel: 'pulado', motivos: porAto.length ? porAto : ['Prazos suspensos (CPC, art. 220)'] });
        pulados++; continue;
      }
    }
    n++;
    if (!inicio) inicio = cursor;
    dias.push({ data: cursor, papel: 'contado', n, motivos: s.reduzido ? s.motivos : [] });
  }
  passos.push({ texto: unidade === 'uteis'
    ? `Contagem em dias úteis a partir de ${br(inicio)}: ${N} dias contados, ${pulados} dia(s) sem expediente ou com prazo suspenso pulados.`
    : `Contagem em dias corridos a partir de ${br(inicio)}.`,
    base: unidade === 'uteis' ? 'CPC, arts. 219, 220 e 224, § 3º' : 'CPC, art. 224, caput' });

  let vencimento = cursor;
  const sFim = situacao(vencimento, mapa);
  const fimOk = unidade === 'uteis' ? (plenamenteUtil(sFim) && !sFim.suspenso) : plenamenteUtil(sFim);
  if (!fimOk) {
    const cond = unidade === 'uteis' ? (s => plenamenteUtil(s) && !s.suspenso) : plenamenteUtil;
    const novo = proximo(vencimento, mapa, cond);
    const porque = sFim.fechado ? 'não teve expediente' : sFim.reduzido ? 'teve expediente reduzido' : 'estava com prazos suspensos';
    passos.push({ texto: `O último dia, ${br(vencimento)}, ${porque} (${sFim.motivos.join('; ') || 'art. 220'}); o vencimento passa para ${br(novo)}.`,
      base: 'CPC, art. 224, § 1º' });
    for (let d = somarDias(vencimento, 1); d < novo; d = somarDias(d, 1)) dias.push({ data: d, papel: 'pulado', motivos: situacao(d, mapa).motivos });
    vencimento = novo;
  }
  dias.push({ data: vencimento, papel: 'vencimento' });

  return { marco, inicio, vencimento, total: N, passos, dias };
}

/**
 * Prazo penal (CPP).
 * - Prazos contínuos: fins de semana, feriados e pontos facultativos no meio do prazo CONTAM (art. 798, caput).
 * - Não se computa o dia do começo; inclui-se o do vencimento (art. 798, § 1º).
 * - A contagem começa no primeiro dia útil após a intimação (Súmula 310 do STF); intimação em dia
 *   sem expediente considera-se feita no primeiro dia útil seguinte.
 * - Vencimento em dia sem expediente (ou com expediente encerrado antes) prorroga-se para o dia útil
 *   seguinte (art. 798, § 3º; CPC, art. 224, § 1º, por analogia — CPP, art. 3º).
 * - Suspensão de 20/12 a 20/01 (art. 798-A), salvo réu preso, Lei Maria da Penha ou medida urgente.
 * - Corre da intimação, e não da juntada do mandado (Súmula 710 do STF).
 * @param {object} o
 * @param {number} o.prazo
 * @param {'djen'|'portal'|'intimacao'} o.evento
 * @param {string} o.data
 * @param {boolean} o.dobro       Defensoria Pública (LC 80/1994, arts. 44, I, 89, I e 128, I)
 * @param {boolean} o.excecaoRecesso  réu preso, Maria da Penha ou urgente: corre no recesso
 * @param {Map} o.mapa
 */
export function calcularPrazoPenal({ prazo, evento, data, dobro, excecaoRecesso, mapa }) {
  const passos = [], dias = [];
  const N = prazo * (dobro ? 2 : 1);
  const suspensoPenal = s => s.suspensoAto || (s.suspensoRecesso && !excecaoRecesso);
  const util = s => plenamenteUtil(s) && !suspensoPenal(s);
  const motivosSusp = s => {
    const m = s.itens.filter(i => i.efeito === 'suspende').map(i => i.motivo);
    if (s.suspensoRecesso && !excecaoRecesso) m.push('Prazos suspensos de 20/12 a 20/01 (CPP, art. 798-A)');
    return m;
  };
  if (dobro) passos.push({ texto: `Prazo em dobro da Defensoria Pública: ${prazo} × 2 = ${N} dias.`, base: 'LC 80/1994, arts. 44, I, 89, I e 128, I' });

  let marco;
  if (evento === 'djen') {
    marco = proximo(data, mapa, temExpediente);
    passos.push({ texto: `Disponibilizada em ${br(data)}; considera-se publicada (intimação) no primeiro dia útil seguinte, ${br(marco)}.`,
      base: 'Lei 11.419/2006, art. 4º, §§ 3º e 4º' });
    dias.push({ data, papel: 'disponibilizacao' });
  } else if (evento === 'portal') {
    const tacita = somarDias(data, 10);
    marco = situacao(tacita, mapa).fechado ? proximo(tacita, mapa, temExpediente) : tacita;
    passos.push({ texto: `Intimação enviada em ${br(data)}. Sem consulta antes, a intimação se considera feita 10 dias corridos depois (${br(tacita)})` +
      (marco !== tacita ? `, que não é dia útil; fica para ${br(marco)}.` : '.'), base: 'Lei 11.419/2006, art. 5º, §§ 2º e 3º' });
    dias.push({ data, papel: 'envio' });
  } else {
    marco = data;
    passos.push({ texto: `Intimação em ${br(data)} (pessoal, em audiência ou ciência inequívoca). Conta-se da intimação, não da juntada do mandado; o dia da intimação não entra.`,
      base: 'CPP, art. 798, §§ 1º e 5º; Súmula 710 do STF' });
  }

  const sMarco = situacao(marco, mapa);
  if (!plenamenteUtil(sMarco)) {
    const novo = proximo(marco, mapa, plenamenteUtil);
    passos.push({ texto: `${br(marco)} ${sMarco.fechado ? 'não teve expediente' : 'teve expediente reduzido'} (${sMarco.motivos.join('; ')}); a intimação se considera feita em ${br(novo)}.`,
      base: 'Jurisprudência do STJ; CPC, art. 224, § 1º, c/c CPP, art. 3º' });
    dias.push({ data: marco, papel: 'pulado', motivos: sMarco.motivos });
    marco = novo;
  }
  dias.push({ data: marco, papel: 'marco' });

  // 1º dia: primeiro dia útil após a intimação (Súmula 310) e fora de suspensão.
  let cursor = marco, guarda = 0;
  for (;;) {
    cursor = somarDias(cursor, 1);
    if (++guarda > LIMITE) throw new Error('Não foi possível encontrar o início do prazo.');
    const s = situacao(cursor, mapa);
    if (util(s)) break;
    dias.push({ data: cursor, papel: 'pulado', motivos: suspensoPenal(s) ? motivosSusp(s) : s.motivos });
  }
  const inicio = cursor;
  if (inicio !== somarDias(marco, 1)) {
    passos.push({ texto: `O prazo começa no primeiro dia útil após a intimação: ${br(inicio)}.`, base: 'CPP, art. 798, § 1º; Súmula 310 do STF' });
  }

  // Contagem contínua: só não contam os dias de prazo suspenso.
  let n = 0, suspensos = 0, naoUteisContados = 0;
  for (let i = 0; n < N; i++) {
    if (i > 0) cursor = somarDias(cursor, 1);
    if (i > LIMITE * 2) throw new Error('Prazo longo demais para o cálculo.');
    const s = situacao(cursor, mapa);
    if (suspensoPenal(s)) { dias.push({ data: cursor, papel: 'pulado', motivos: motivosSusp(s) }); suspensos++; continue; }
    n++;
    if (s.fechado) naoUteisContados++;
    dias.push({ data: cursor, papel: 'contado', n, motivos: s.fechado || s.reduzido ? s.motivos : [] });
  }
  passos.push({ texto: `Contagem contínua a partir de ${br(inicio)}: ${N} dias corridos` +
    (naoUteisContados ? `, incluindo ${naoUteisContados} dia(s) sem expediente no meio do prazo` : '') +
    (suspensos ? `; ${suspensos} dia(s) de prazo suspenso não contados` : '') + '.',
    base: suspensos ? 'CPP, arts. 798, caput, e 798-A' : 'CPP, art. 798, caput' });
  if (excecaoRecesso && dias.some(d => d.papel === 'contado' && suspensoArt220(d.data))) {
    passos.push({ texto: 'Réu preso, Lei Maria da Penha ou medida urgente: o prazo corre normalmente entre 20/12 e 20/01.', base: 'CPP, art. 798-A, I a III' });
  }

  let vencimento = cursor;
  const sFim = situacao(vencimento, mapa);
  if (!util(sFim)) {
    const novo = proximo(vencimento, mapa, util);
    const porque = sFim.fechado ? 'não teve expediente' : sFim.reduzido ? 'teve expediente encerrado antes da hora normal' : 'estava com prazos suspensos';
    passos.push({ texto: `O último dia, ${br(vencimento)}, ${porque} (${sFim.motivos.join('; ') || 'suspensão'}); o vencimento passa para ${br(novo)}.`,
      base: sFim.reduzido && !sFim.fechado ? 'CPP, art. 798, § 3º; CPC, art. 224, § 1º, c/c CPP, art. 3º' : 'CPP, art. 798, § 3º' });
    for (let d = somarDias(vencimento, 1); d < novo; d = somarDias(d, 1)) dias.push({ data: d, papel: 'pulado', motivos: situacao(d, mapa).motivos });
    vencimento = novo;
  }
  dias.push({ data: vencimento, papel: 'vencimento' });
  return { marco, inicio, vencimento, total: N, passos, dias };
}
