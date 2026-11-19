// Twiin · adaptation du panneau de l'extension (panel.js, capture.js) pour l'app Mac (Electron).
// Dans l'app, la page est servie par le serveur Twiin local (même origine) : les appels partent directement, sans
// service worker. Ce fichier remplace les quelques fonctions de Chrome que le panneau utilise.
(() => {
  const D = window.twiinDesktop; // fourni par desktop/preload.js
  const BASE = location.origin;
  const token = () => {
    try {
      const k = Object.keys(localStorage).find((x) => x === 'twiin-auth' || /^sb-.*-auth-token$/.test(x));
      return k ? JSON.parse(localStorage.getItem(k))?.access_token || null : null;
    } catch { return null; }
  };
  async function api(path, { method = 'GET', body } = {}) {
    const t = token();
    let r;
    try {
      r = await fetch(BASE + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) },
        body: body ? JSON.stringify(body) : undefined });
    } catch { return { offline: true, error: 'Twiin n\'est pas lancé sur ce Mac.' }; }
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) return { login: true, error: j.error || 'Connecte-toi dans Twiin.' };
    if (!r.ok) return { error: j.error || `Erreur ${r.status}` };
    return j;
  }
  const store = {
    get: async (keys) => Object.fromEntries([].concat(keys).map((k) => { try { return [k, JSON.parse(localStorage.getItem(`twiin-app-${k}`))]; } catch { return [k, undefined]; } })
      .filter(([, v]) => v != null)),
    set: async (o) => { for (const [k, v] of Object.entries(o)) localStorage.setItem(`twiin-app-${k}`, JSON.stringify(v)); },
    remove: async () => {},
  };
  const openUrl = (u) => (D ? D.openExternal(u) : window.open(u, '_blank'));
  const HANDLERS = {
    state: async () => ({ etat: await api('/api/automations/etat'), rec: null, prefs: await store.get(['bubble', 'hidden']) }),
    api: (m) => api(m.path, m),
    open: (m) => (String(m.page || '').startsWith('login.html')
      ? location.assign(`${BASE}/login.html?next=${encodeURIComponent('/ext/desktop.html')}`) // dans l'app, pas dans Chrome
      : openUrl(`${BASE}/${m.page || m.hash || ''}`)),
    stop: () => api('/api/automations/stop', { method: 'POST' }),
    run: (m) => api(`/api/automations/${encodeURIComponent(m.id)}/run`, { method: 'POST' }),
    'recorder:config': async () => ({ base: BASE, token: token() }),
  };
  const listeners = [];
  if (D) D.onCommand((m) => listeners.forEach((fn) => fn(m)));
  const shim = {
    runtime: {
      sendMessage: async (m) => (HANDLERS[m?.type] ? HANDLERS[m.type](m) : { ok: true }),
      connect: () => ({ postMessage: (m) => { if (m?.type === 'rec' && D) D.rec(m.rec); }, onMessage: { addListener: (fn) => listeners.push(fn) } }),
      getURL: (p) => `${BASE}/ext/${p}`,
    },
    storage: { local: store, session: store, onChanged: { addListener() {} } },
    tabs: { query: async () => [], onActivated: { addListener() {} }, create: ({ url }) => openUrl(url) },
  };
  Object.defineProperty(window, 'chrome', { value: shim, configurable: true, writable: true });
})();
