// Camada de compatibilidade da versão web.
// Os dados ficam neste navegador e neste perfil; não são sincronizados entre servidores.
(() => {
  window.PRAZOS_WEB = true;
  const PREFIX = 'prazosTJCE:';
  const listeners = new Set();
  const read = key => {
    try { return JSON.parse(localStorage.getItem(PREFIX + key)); } catch { return undefined; }
  };
  const write = (key, value) => {
    const oldValue = read(key);
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    const changes = { [key]: { oldValue, newValue: value } };
    listeners.forEach(fn => { try { fn(changes, 'local'); } catch {} });
  };
  const storage = {
    async get(keys) {
      const out = {};
      if (keys == null) {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(PREFIX)) out[k.slice(PREFIX.length)] = read(k.slice(PREFIX.length));
        }
      } else {
        const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
        for (const k of list) {
          const val = read(k);
          if (val !== undefined) out[k] = val;
          else if (!Array.isArray(keys) && typeof keys === 'object' && keys[k] !== undefined) out[k] = keys[k];
        }
      }
      return out;
    },
    async set(obj) { for (const [k,v] of Object.entries(obj || {})) write(k,v); },
    async remove(keys) {
      for (const k of (Array.isArray(keys) ? keys : [keys])) {
        const oldValue = read(k);
        localStorage.removeItem(PREFIX + k);
        const changes = { [k]: { oldValue, newValue: undefined } };
        listeners.forEach(fn => { try { fn(changes, 'local'); } catch {} });
      }
    },
    async clear() {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(PREFIX)) keys.push(k.slice(PREFIX.length));
      }
      await this.remove(keys);
    }
  };
  // Encaminha apenas consultas aos domínios oficiais permitidos pelo proxy do site.
  // As chamadas locais (arquivos da aplicação) continuam usando o fetch nativo.
  const fetchNativo = window.fetch.bind(window);
  const hostsTJCE = new Set(['djea-con.tjce.jus.br', 'www.tjce.jus.br', 'tjce.jus.br']);
  window.fetch = async (input, init = {}) => {
    let original;
    try { original = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href); }
    catch { return fetchNativo(input, init); }
    if (original.origin === location.origin || original.protocol !== 'https:' || !hostsTJCE.has(original.hostname)) {
      return fetchNativo(input, init);
    }
    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
    const method = (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const options = { method, headers, credentials: 'same-origin', cache: 'no-store' };
    if (method !== 'GET' && method !== 'HEAD') {
      if (init.body !== undefined) options.body = init.body;
      else if (input instanceof Request) options.body = await input.clone().arrayBuffer();
    }
    const proxy = new URL('/api/proxy', location.origin);
    proxy.searchParams.set('url', original.href);
    return fetchNativo(proxy.href, options);
  };

  window.chrome = {
    storage: { local: storage, onChanged: { addListener(fn) { listeners.add(fn); } } },
    runtime: {
      getManifest: () => ({ version: '2.17.1-web' }),
      getURL: path => new URL(path, location.href).href,
      sendMessage: async msg => {
        if (msg?.cmd === 'reagendar') return { ok: true, web: true };
        if (msg?.cmd === 'coletarAgora') return { ok: false, web: true, message: 'A coleta web ainda precisa do proxy do TJCE.' };
        if (msg?.cmd === 'calendarioPorAba') return { ok: false, web: true, message: 'A leitura automática da aba do calendário é exclusiva da extensão.' };
        return null;
      }
    },
    tabs: { create: ({url}) => window.open(url, '_blank', 'noopener') }
  };
})();