// Camada de compatibilidade da versão web.
// Os dados ficam neste navegador e neste perfil; não são sincronizados entre servidores.
(() => {
  window.PRAZOS_WEB = true;
  const PREFIX = 'prazosTJCE:';
  const listeners = new Set();
  // IndexedDB suporta registros maiores que o limite típico do localStorage.
  const DB_NAME = 'prazos-tjce-web';
  const STORE = 'dados';
  const dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Não foi possível abrir o armazenamento local.'));
  });
  async function dbRequest(mode, action) {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      let req;
      try { req = action(store); } catch (e) { reject(e); return; }
      if (req) {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || tx.error);
      } else {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }
    });
  }
  const storage = {
    async get(keys) {
      const all = await dbRequest('readonly', store => store.getAllKeys());
      const wanted = keys == null ? all : (typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys));
      const out = {};
      for (const key of wanted) {
        const val = await dbRequest('readonly', store => store.get(String(key)));
        if (val !== undefined) out[key] = val;
        else if (keys && !Array.isArray(keys) && typeof keys === 'object' && keys[key] !== undefined) out[key] = keys[key];
      }
      return out;
    },
    async set(obj) {
      for (const [key, value] of Object.entries(obj || {})) {
        const oldValue = await dbRequest('readonly', store => store.get(key));
        await dbRequest('readwrite', store => store.put(value, key));
        const changes = { [key]: { oldValue, newValue: value } };
        listeners.forEach(fn => { try { fn(changes, 'local'); } catch {} });
      }
    },
    async remove(keys) {
      for (const key of (Array.isArray(keys) ? keys : [keys])) {
        const oldValue = await dbRequest('readonly', store => store.get(String(key)));
        await dbRequest('readwrite', store => store.delete(String(key)));
        const changes = { [key]: { oldValue, newValue: undefined } };
        listeners.forEach(fn => { try { fn(changes, 'local'); } catch {} });
      }
    },
    async clear() {
      const keys = await dbRequest('readonly', store => store.getAllKeys());
      await this.remove(keys);
    }
  };
  // Migração única: aproveita dados existentes no localStorage da versão anterior.
  dbPromise.then(async () => {
    const marker = await dbRequest('readonly', store => store.get('__migradoLocalStorage'));
    if (marker) return;
    const migrar = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) {
        try { migrar[k.slice(PREFIX.length)] = JSON.parse(localStorage.getItem(k)); } catch {}
      }
    }
    for (const [k, v] of Object.entries(migrar)) {
      const atual = await dbRequest('readonly', store => store.get(k));
      if (atual === undefined) await dbRequest('readwrite', store => store.put(v, k));
    }
    await dbRequest('readwrite', store => store.put(true, '__migradoLocalStorage'));
  }).catch(err => console.error('Migração do armazenamento local falhou:', err));
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
      getManifest: () => ({ version: '2.17.2-web' }),
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
