// Documento invisível onde a busca automática roda (precisa de DOMParser).
import { coletar, datasDasComarcas } from './coleta.js';
import { obterCalendario } from './calendario-tjce.js';

let rodando = false;
const enviar = msg => chrome.runtime.sendMessage({ alvo: 'background', ...msg }).catch(() => {});

chrome.runtime.onMessage.addListener((msg, _r, responder) => {
  if (msg?.alvo !== 'offscreen' || msg.cmd !== 'coletar') return;
  if (!rodando) { rodando = true; executar(msg).finally(() => { rodando = false; }); }
  responder({ ok: true });
});

async function executar({ cfg, conhecidos, falhas, calFonte, modo, desde }) {
  let buffer = {}, bufferMag = {}, contador = 0;
  const descarregar = async () => {
    if (!Object.keys(buffer).length) return;
    const registros = buffer, magistrados = bufferMag;
    buffer = {}; bufferMag = {};
    await enviar({ tipo: 'lote', registros, magistrados });
  };
  // Mantém o service worker acordado e grava aos poucos.
  const pulso = setInterval(() => { descarregar(); enviar({ tipo: 'pulso' }); }, 15000);
  const log = [];
  try {
    const r = await coletar(cfg, {
      conhecidos: new Set(conhecidos), falhasAnteriores: falhas, modo: modo || 'completo', desde,
      log: m => log.push(`[${new Date().toLocaleTimeString('pt-BR')}] ${m}`),
      aoRegistrar: (id, valor, mag) => { buffer[id] = valor; bufferMag[id] = mag; if (++contador % 20 === 0) descarregar(); }
    });
    await descarregar();
    try {
      const cal = await obterCalendario(cfg.ano, calFonte, m => log.push(m));
      if (cal) await enviar({ tipo: 'calendario', datas: cal.datas, fonte: cal.fonte });
    } catch (e) { log.push(`Calendário do TJCE: ${e.message}`); }
    await enviar({ tipo: 'fim', resumo: {
      novas: r.novas.length, falhas: r.falhas, maiorId: r.maiorId, pesquisasComFalha: r.pesquisasComFalha || 0,
      novasDatas: datasDasComarcas(r.novas),
      novasDesignacoes: r.novasMag.flatMap(m => m.eventos.map(e => ({ comarca: e.comarca, substituto: e.substituto, ausente: e.ausente, inicio: e.inicio, fim: e.fim, motivo: e.motivo }))),
      log: log.slice(-80)
    } });
  } catch (e) {
    await descarregar();
    await enviar({ tipo: 'fim', resumo: { erro: e.message, novas: 0, falhas, novasDatas: [], log: log.slice(-80) } });
  } finally {
    clearInterval(pulso);
  }
}

enviar({ tipo: 'pronto' });
