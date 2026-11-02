// Ponte entre a página do Calendário e a extensão. Também lê os eventos já desenhados na tela
// (células com data-date), o que funciona qualquer que seja o formato em que os dados chegam.
(() => {
  const noTopo = window.top === window;
  const pai = (location.ancestorOrigins && location.ancestorOrigins[0]) || '';
  if (!(noTopo ? /calend/i.test(location.pathname) : /tjce\.jus\.br/.test(pai) || /calend/i.test(location.href))) return;
  const mandar = m => chrome.runtime.sendMessage({ alvo: 'background', ...m }).catch(() => {});

  window.addEventListener('message', ev => {
    const d = ev.data;
    if (!d || !d.__feriadosTJCE) return;
    if (d.tipo === 'resposta') mandar({ tipo: 'calendarioCapturado', url: d.url, metodo: d.metodo, corpo: d.corpo, tipoConteudo: d.tipoConteudo, texto: d.texto });
    else if (d.tipo === 'diagHtml') mandar({ tipo: 'calendarioHtml', total: d.total, amostras: d.amostras });
    else if (d.tipo === 'varreduraFim') mandar({ tipo: 'calendarioVarreduraFim', total: d.total });
    else if (d.tipo === 'diag') mandar({ tipo: 'calendarioDiag', item: { url: d.url, metodo: d.metodo, status: d.status, tipoConteudo: d.tipoConteudo, tamanho: d.tamanho, inicio: d.inicio, datas: d.datas, pagina: location.href } });
  });

  const DATA_ISO = /^\d{4}-\d{2}-\d{2}/;
  const textoLimpo = el => (el.getAttribute('title') || el.textContent || '').replace(/\s+/g, ' ').trim();
  function lerTela() {
    const itens = [];
    // Células de dia com data-date (FullCalendar e similares) e os eventos dentro delas.
    for (const cel of document.querySelectorAll('[data-date]')) {
      const data = (cel.getAttribute('data-date') || '').slice(0, 10);
      if (!DATA_ISO.test(data)) continue;
      const SEL = '[class*="event"], [class*="evento"], a[title], .fc-event, [class*="feriado"], [class*="facultativo"]';
      // Só o elemento mais externo de cada evento (as classes dele costumam dizer o tipo).
      const evs = [...cel.querySelectorAll(SEL)].filter(ev => !ev.parentElement.closest(SEL) || !cel.contains(ev.parentElement.closest(SEL)));
      for (const ev of evs) {
        const texto = textoLimpo(ev);
        const cor = ev.style?.backgroundColor || ev.style?.borderColor || getComputedStyle(ev).backgroundColor || '';
        if (texto && texto.length > 2) itens.push({ data, texto: texto.slice(0, 300), classes: String(ev.className || '').slice(0, 200), cor });
      }
    }
    // Listas de eventos (visão "lista"): linha com data + título.
    for (const linha of document.querySelectorAll('[class*="list"] [data-date], tr[data-date]')) {
      const data = (linha.getAttribute('data-date') || '').slice(0, 10);
      if (DATA_ISO.test(data)) { const texto = textoLimpo(linha); if (texto) itens.push({ data, texto: texto.slice(0, 300), classes: String(linha.className || ''), cor: '' }); }
    }
    return itens;
  }
  let temporizador = null, ultimo = '';
  const observar = () => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => {
      const itens = lerTela();
      const assinatura = JSON.stringify(itens);
      if (itens.length && assinatura !== ultimo) { ultimo = assinatura; mandar({ tipo: 'calendarioTela', itens, pagina: location.href }); }
      // Resumo da página para o diagnóstico.
      mandar({ tipo: 'calendarioPagina', resumo: {
        pagina: location.href, emIframe: !noTopo,
        celulasComData: document.querySelectorAll('[data-date]').length, eventosNaTela: itens.length,
        iframes: [...document.querySelectorAll('iframe')].map(f => f.src).slice(0, 5),
        classesExemplo: [...new Set([...document.querySelectorAll('[class*="event"], [class*="fc-"]')].slice(0, 40).map(e => String(e.className).split(' ')[0]))].slice(0, 15),
        bibliotecas: ['FullCalendar', 'jQuery', 'moment', 'dayjs'].filter(n => document.documentElement.innerHTML.includes(n) || document.querySelector(`script[src*="${n.toLowerCase()}"]`))
      } });
    }, 800);
  };
  new MutationObserver(observar).observe(document.documentElement, { childList: true, subtree: true, attributes: false });
  if (document.readyState !== 'loading') observar(); else document.addEventListener('DOMContentLoaded', observar);
})();
