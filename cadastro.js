// Cadastro de unidades e juízes informado pela equipe (base de conferência do DJEA).
// período: "Tempo indeterminado", "Até 28/02/2027", "14/09 a 03/10", "26/10 a 24/11/26" ou vazio.
import { fold } from './parser.js';

export const CADASTRO_INICIAL = {
  atualizadoEm: '2026-10-02',
  versaoBase: 2,
  unidades: [
    { comarca: 'Farias Brito', unidade: 'Vara Única', titular: '', periodo: 'Tempo indeterminado', responde: 'Herick Bezerra Tavares' },
    { comarca: 'Nova Olinda', unidade: 'Vara Única', titular: 'Herick Bezerra Tavares', periodo: '', responde: '' },
    { comarca: 'Araripe', unidade: 'Vara Única', titular: 'Sylvio Batista dos Santos Neto', periodo: '', responde: '' },
    { comarca: 'Mauriti', unidade: 'Vara Única', titular: 'Daniel Alves Mendes Filho', periodo: '', responde: '' },
    { comarca: 'Jardim', unidade: 'Vara Única', titular: '', periodo: 'Até 28/02/2027', responde: 'Leonardo Afonso Franco de Freitas' },
    { comarca: 'Aurora', unidade: 'Vara Única', titular: 'Hércules Antonio Jacot Filho', periodo: '', responde: '' },
    { comarca: 'Barro', unidade: 'Vara Única', titular: 'Klovis Caricio da Cruz Marques', periodo: '', responde: '' },
    { comarca: 'Caririaçu', unidade: 'Vara Única', titular: '', periodo: 'Tempo indeterminado', responde: 'Djalma Sobreira Dantas Júnior' },
    { comarca: 'Lavras da Mangabeira', unidade: 'Vara Única', titular: 'Luzinaldo Alves Alexandre da Silva', periodo: '', responde: '' },
    { comarca: 'Milagres', unidade: 'Vara Única', titular: '', periodo: 'Até 28/02/2027', responde: 'Daniel Alves Mendes Filho' },
    { comarca: 'Missão Velha', unidade: 'Vara Única', titular: 'Paulo Augusto Gadelha de Abrantes', periodo: '', responde: '' },
    { comarca: 'Brejo Santo', unidade: '1ª Vara Cível', titular: 'Otavio Oliveira de Morais', periodo: '', responde: '' },
    { comarca: 'Brejo Santo', unidade: '2ª Vara Cível', titular: 'Luiz Phelipe Fernandes de Freitas Morais', periodo: '', responde: '' },
    { comarca: 'Crato', unidade: '1ª Vara Cível', titular: 'José Batista de Andrade', periodo: '26/10 a 24/11/26', responde: 'Jose Flavio Bezerra Morais' },
    { comarca: 'Crato', unidade: '2ª Vara Cível', titular: 'Jose Flavio Bezerra Morais', periodo: '', responde: '' },
    { comarca: 'Crato', unidade: 'Vara de Família', titular: 'Leonardo Afonso Franco de Freitas', periodo: '', responde: '' },
    { comarca: 'Barbalha', unidade: '1ª Vara Cível', titular: 'Marcelino Emidio Maciel Filho', periodo: '', responde: '' },
    { comarca: 'Barbalha', unidade: '2ª Vara Cível', titular: 'Judson Pereira Spíndola Júnior', periodo: '', responde: '' },
    { comarca: 'Juazeiro do Norte', unidade: '1ª Vara Cível', titular: 'Fabricius Ferreira Silva', periodo: '', responde: '' },
    { comarca: 'Juazeiro do Norte', unidade: '2ª Vara Cível', titular: 'Francisco Jose Mazza Siqueira', periodo: 'Tempo indeterminado', responde: 'Péricles Victor Galvao de Oliveira' },
    { comarca: 'Juazeiro do Norte', unidade: '3ª Vara Cível', titular: 'Renato Esmeraldo Paes', periodo: 'Tempo indeterminado', responde: 'Matheus Pereira Junior' },
    { comarca: 'Juazeiro do Norte', unidade: '1ª Vara de Família', titular: 'Gustavo Henrique Cardoso Cavalcante', periodo: '', responde: '' },
    { comarca: 'Juazeiro do Norte', unidade: '2ª Vara de Família', titular: 'Alexsandra Lacerda Batista Brito', periodo: '14/09 a 03/10', responde: 'Gustavo Henrique Cardoso Cavalcante' },
    { comarca: 'Juazeiro do Norte', unidade: 'Vara da Infância e Juventude', titular: 'Péricles Victor Galvao de Oliveira', periodo: '', responde: '' },
    { comarca: 'Assaré', unidade: 'Vara Única', titular: '', periodo: '', responde: '' },
    { comarca: 'Campos Sales', unidade: 'Vara Única', titular: '', periodo: '', responde: '' },
    // Unidades criminais (versão-base 2). Titulares a preencher: a coluna DJEA sugere o nome lido nas portarias.
    { comarca: 'Crato', unidade: '1ª Vara Criminal', titular: '', periodo: '', responde: '' },
    { comarca: 'Crato', unidade: '2ª Vara Criminal', titular: '', periodo: '', responde: '' },
    { comarca: 'Crato', unidade: 'Juizado da Violência Doméstica e Familiar contra a Mulher', titular: '', periodo: '', responde: '' },
    { comarca: 'Crato', unidade: 'Juizado Especial Cível e Criminal', titular: '', periodo: '', responde: '' },
    { comarca: 'Barbalha', unidade: 'Vara Única Criminal', titular: '', periodo: '', responde: '' },
    { comarca: 'Brejo Santo', unidade: 'Vara Única Criminal', titular: '', periodo: '', responde: '' },
    { comarca: 'Juazeiro do Norte', unidade: '1ª Vara Criminal', titular: '', periodo: '', responde: '' },
    { comarca: 'Juazeiro do Norte', unidade: '2ª Vara Criminal', titular: '', periodo: '', responde: '' },
    { comarca: 'Juazeiro do Norte', unidade: '3ª Vara Criminal', titular: '', periodo: '', responde: '' },
    { comarca: 'Juazeiro do Norte', unidade: '4ª Vara Criminal', titular: '', periodo: '', responde: '' },
    { comarca: 'Juazeiro do Norte', unidade: 'Juizado da Violência Doméstica e Familiar contra a Mulher', titular: '', periodo: '', responde: '' },
    { comarca: 'Juazeiro do Norte', unidade: '1ª Unidade do Juizado Especial Cível e Criminal', titular: '', periodo: '', responde: '' },
    { comarca: 'Juazeiro do Norte', unidade: '2ª Unidade do Juizado Especial Cível e Criminal', titular: '', periodo: '', responde: '' },
    { comarca: 'Juazeiro do Norte', unidade: '1º Núcleo Regional de Custódia e das Garantias', titular: '', periodo: '', responde: '' }
  ]
};

const iso = (a, m, d) => `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Interpreta o texto do período. ref = 'AAAA-MM-DD' da última atualização do cadastro. */
export function lerPeriodo(texto, ref) {
  const t = fold((texto || '').trim());
  if (!t || t === 'x' || t === '-') return null;
  if (/indeterminad/.test(t)) return { inicio: null, fim: null, indeterminado: true };
  const anoRef = +String(ref || new Date().toISOString()).slice(0, 4);
  const ds = [...t.matchAll(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/g)]
    .map(m => ({ d: +m[1], m: +m[2], a: m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : null }));
  if (!ds.length) return null;
  if (ds.length === 1) {
    const x = ds[0], a = x.a || anoRef;
    if (/^ate\b/.test(t)) return { inicio: null, fim: iso(a, x.m, x.d) };
    if (/a partir|desde/.test(t)) return { inicio: iso(a, x.m, x.d), fim: null };
    return { inicio: iso(a, x.m, x.d), fim: iso(a, x.m, x.d) };
  }
  const [i, f] = [ds[0], ds[ds.length - 1]];
  const aFim = f.a || i.a || anoRef;
  const aIni = i.a || (i.m > f.m ? aFim - 1 : aFim);
  return { inicio: iso(aIni, i.m, i.d), fim: iso(aFim, f.m, f.d) };
}

/** Situação de uma unidade do cadastro numa data. */
export function situacaoUnidade(u, dia, ref) {
  const p = lerPeriodo(u.periodo, ref);
  const temSub = !!(u.responde || '').trim();
  const semTitular = !(u.titular || '').trim();
  if (!p && !temSub) return { estado: semTitular ? 'nao-cadastrado' : 'exercicio', periodo: null };
  if (!p) return { estado: semTitular ? 'vaga' : 'afastado', periodo: { indeterminado: true } };
  const ativo = p.indeterminado || ((!p.inicio || p.inicio <= dia) && (!p.fim || p.fim >= dia));
  if (ativo) return { estado: semTitular ? 'vaga' : 'afastado', periodo: p };
  if (p.inicio && p.inicio > dia) return { estado: 'previsto', periodo: p };
  return { estado: 'encerrado', periodo: p };
}

// ----- comparação com o DJEA -----
const PARTICULAS = new Set(['de', 'da', 'do', 'dos', 'das', 'e', 'junior', 'filho', 'neto', 'sobrinho']);
const tokens = n => fold(n || '').replace(/[^a-z ]/g, ' ').split(/\s+/).filter(t => t && !PARTICULAS.has(t));

/** Mesmo juiz? Compara primeiro e último sobrenome significativos, tolerando nomes abreviados. */
export function mesmoJuiz(a, b) {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.length || !tb.length) return false;
  if (ta[0] !== tb[0]) return false;
  if (ta[ta.length - 1] === tb[tb.length - 1]) return true;
  const [menor, maior] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return menor.every(t => maior.includes(t));
}

/** Chave da unidade: tipo + número ordinal ("civel-1", "criminal-2", "unica-0", "jvd-0"). */
export function chaveUnidade(texto) {
  const f = fold(texto || '').replace(/\s+da\s+comarca\s+d[eo].*$/, '');
  const ord = +((f.match(/(\d+)\s*[ªaº]?\s*(?:vara|juizado|unidade|nucleo)/) || f.match(/^(\d+)/) || [])[1] || 0);
  const tipo = /infancia|juventude/.test(f) ? 'infancia'
    : /violencia|maria da penha/.test(f) ? 'jvd'
    : /juizado auxiliar/.test(f) ? 'jaux'
    : /custodia|garantias/.test(f) ? 'custodia'
    : /juizado/.test(f) ? 'juizado'
    : /famil/.test(f) ? 'familia'
    : /civel|civil/.test(f) ? 'civel'
    : /criminal|penal|juri|execuc/.test(f) ? 'criminal'
    : /unica/.test(f) ? 'unica' : 'outra';
  return `${tipo}-${ord}`;
}

/** Área da unidade: 'criminal', 'civel' ou 'misto' (vara única e juizado especial cível e criminal). */
export function areaUnidade(texto) {
  const tipo = chaveUnidade(texto).split('-')[0];
  if (['criminal', 'jvd', 'custodia'].includes(tipo)) return 'criminal';
  if (['unica', 'juizado', 'jaux', 'outra'].includes(tipo)) return 'misto';
  return 'civel';
}

/**
 * Acrescenta ao cadastro salvo as unidades novas da versão-base (sem mexer no que o usuário editou).
 * @returns {{cadastro: object, adicionadas: number}}
 */
export function mesclarCadastroBase(salvo) {
  if (!salvo || !Array.isArray(salvo.unidades)) return { cadastro: structuredClone(CADASTRO_INICIAL), adicionadas: 0 };
  if ((salvo.versaoBase || 1) >= CADASTRO_INICIAL.versaoBase) return { cadastro: salvo, adicionadas: 0 };
  const existe = new Set(salvo.unidades.map(u => `${u.comarca}|${chaveUnidade(u.unidade)}`));
  const novas = CADASTRO_INICIAL.unidades.filter(u => !existe.has(`${u.comarca}|${chaveUnidade(u.unidade)}`));
  return { cadastro: { ...salvo, versaoBase: CADASTRO_INICIAL.versaoBase, unidades: [...salvo.unidades, ...structuredClone(novas)] }, adicionadas: novas.length };
}
