// Roda no contexto da própria página do Calendário do TJCE (world: MAIN), inclusive em iframes do TJCE.
// Observa as respostas de rede da página: repassa as que trazem eventos e um resumo de todas (diagnóstico).
(() => {
  if (window.__feriadosTjceGancho) return;
  const noTopo = window.top === window;
  const pai = (location.ancestorOrigins && location.ancestorOrigins[0]) || '';
  const ativo = noTopo ? /calend/i.test(location.pathname) : /tjce\.jus\.br/.test(pai) || /calend/i.test(location.href);
  if (!ativo) return;
  window.__feriadosTjceGancho = true;
  const DATA = /\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4}/g;
  const pareceEventos = t => typeof t === 'string' && t.length < 8e6 &&
    (t.match(DATA) || []).length >= 2 && /start|title|titulo|feriado|facultativ|expediente|evento/i.test(t);
  const postar = msg => window.postMessage({ __feriadosTJCE: true, ...msg }, '*');
  const registrar = (url, metodo, corpo, tipoConteudo, status, texto) => {
    const t = typeof texto === 'string' ? texto : '';
    postar({ tipo: 'diag', url: String(url), metodo, status, tipoConteudo: tipoConteudo || '', tamanho: t.length,
      inicio: t.slice(0, 160).replace(/\s+/g, ' '), datas: (t.match(DATA) || []).length });
    if (pareceEventos(t)) postar({ tipo: 'resposta', url: String(url), metodo, corpo: typeof corpo === 'string' ? corpo : null, tipoConteudo, texto: t });
  };
  const fetchOriginal = window.fetch;
  window.fetch = async function (entrada, init = {}) {
    const resp = await fetchOriginal.apply(this, arguments);
    try {
      const url = new URL(typeof entrada === 'string' ? entrada : entrada.url, location.href).href;
      const metodo = (init.method || (entrada && entrada.method) || 'GET').toUpperCase();
      const corpo = init.body instanceof URLSearchParams ? init.body.toString() : init.body;
      const tipo = resp.headers.get('content-type');
      resp.clone().text().then(t => registrar(url, metodo, corpo, tipo, resp.status, t)).catch(() => {});
    } catch {}
    return resp;
  };
  const abrir = XMLHttpRequest.prototype.open, enviar = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (metodo, url) {
    try { this.__ft = { metodo: String(metodo).toUpperCase(), url: new URL(url, location.href).href }; } catch {}
    return abrir.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (corpo) {
    if (this.__ft) {
      this.__ft.corpo = corpo instanceof URLSearchParams ? corpo.toString() : corpo;
      this.addEventListener('load', () => {
        try {
          const txt = this.responseType === '' || this.responseType === 'text' ? this.responseText
            : this.responseType === 'json' ? JSON.stringify(this.response) : '';
          registrar(this.__ft.url, this.__ft.metodo, this.__ft.corpo, this.getResponseHeader('content-type'), this.status, txt);
        } catch {}
      });
    }
    return enviar.apply(this, arguments);
  };

  // ---------- FullCalendar (v3, com jQuery): pede os eventos ao próprio calendário ----------
  const fmt = m => !m ? null : (m.format ? (m.hasTime && m.hasTime() ? m.format() : m.format('YYYY-MM-DD')) : String(m));
  function serializar(ev) {
    const o = {};
    for (const [k, v] of Object.entries(ev)) {
      if (k === 'source' || k.startsWith('_')) continue;
      if (v && v._isAMomentObject) o[k] = fmt(v);
      else if (['string', 'number', 'boolean'].includes(typeof v)) o[k] = v;
      else if (Array.isArray(v)) o[k] = v.filter(x => typeof x === 'string').join(' ');
    }
    o.start = fmt(ev.start); o.end = fmt(ev.end); o.allDay = !!ev.allDay;
    o.className = [].concat(ev.className || [], (ev.source && ev.source.className) || []).join(' ');
    if (!o.color && ev.source && ev.source.color) o.color = ev.source.color;
    return o;
  }
  function calendarioFC() {
    const $ = window.jQuery;
    if (!$ || !$.fn || !$.fn.fullCalendar) return null;
    const el = $('.fc').first();
    return el.length ? el : null;
  }
  const eventosFC = el => { try { return el.fullCalendar('clientEvents').map(serializar); } catch (e) { return []; } };
  const espera = ms => new Promise(r => setTimeout(r, ms));
  const unir = (mapa, lista) => { for (const e of lista) mapa.set(`${e.id ?? ''}|${e.title}|${e.start}`, e); };
  function enviarEventos(lista, origem) {
    postar({ tipo: 'diag', url: `FullCalendar ${window.jQuery?.fullCalendar?.version || '?'} (${origem})`, metodo: 'FC', status: 200,
      tipoConteudo: 'clientEvents', tamanho: lista.length, inicio: JSON.stringify(lista[0] || {}).slice(0, 160), datas: lista.length });
    if (lista.length) postar({ tipo: 'resposta', url: location.href, metodo: 'FULLCALENDAR', corpo: null, tipoConteudo: 'application/json', texto: JSON.stringify(lista) });
  }
  // Amostra de elementos de evento no HTML (para o diagnóstico).
  function amostraHtml() {
    const els = [...document.querySelectorAll('[class*="eventos_"], [class*="evento"]')];
    postar({ tipo: 'diagHtml', total: els.length, amostras: els.slice(0, 4).map(e => e.outerHTML.slice(0, 700)) });
  }

  (async () => {
    let el = null;
    for (let i = 0; i < 60 && !(el = calendarioFC()); i++) await espera(500);
    amostraHtml();
    if (!el) { postar({ tipo: 'diag', url: 'FullCalendar não encontrado (jQuery.fn.fullCalendar ausente)', metodo: 'FC', status: 0, tamanho: 0, inicio: '', datas: 0 }); return; }
    const varrer = (location.hash.match(/feriados-tjce-varrer=(\d{4})/) || [])[1];
    const todos = new Map();
    if (varrer) {
      // Aba aberta pela extensão: percorre os meses do ano (e janeiro do seguinte) para carregar tudo.
      const atual = el.fullCalendar('getDate');
      // de=AAAA-MM: atualização (começa no mês da última atualização); sem "de": ano inteiro.
      const de = (location.hash.match(/de=(\d{4})-(\d{2})/) || []).slice(1).map(Number);
      let [a, m] = de.length ? de : [+varrer, 1];
      const fim = (+varrer + 1) * 12 + 1; // janeiro do ano seguinte
      while (a * 12 + m <= fim) {
        el.fullCalendar('gotoDate', `${a}-${String(m).padStart(2, '0')}-01`);
        await espera(600);
        unir(todos, eventosFC(el));
        if (++m > 12) { m = 1; a++; }
      }
      el.fullCalendar('gotoDate', atual);
      enviarEventos([...todos.values()], `varredura ${varrer}`);
      postar({ tipo: 'varreduraFim', total: todos.size });
      return;
    }
    // Aba aberta pelo usuário: envia o que estiver carregado e acompanha a navegação.
    let ultimo = -1;
    for (let i = 0; i < 400; i++) {
      unir(todos, eventosFC(el));
      if (todos.size !== ultimo) { ultimo = todos.size; enviarEventos([...todos.values()], 'página aberta'); }
      await espera(3000);
    }
  })();
})();
