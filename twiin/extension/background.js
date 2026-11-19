// Twiin · service worker de l'extension. Seul endroit qui parle au serveur Twiin (http://localhost:3000, sur le Mac) :
// le panneau latéral et la bulle des pages passent par lui. Rien ne part ailleurs que vers ce serveur local.
const BASE_DEFAULT = 'http://localhost:3000';
const base = async () => (await chrome.storage.local.get('base')).base || BASE_DEFAULT;

// Jeton de connexion (comptes Supabase activés) : lu dans l'onglet Twiin par bridge.js, gardé en mémoire de session.
async function api(path, { method = 'GET', body } = {}) {
  const { token } = await chrome.storage.session.get('token');
  const headers = { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  let r;
  try {
    r = await fetch((await base()) + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    return { offline: true, error: 'Twiin n\'est pas lancé sur ce Mac.' };
  }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) return { login: true, error: j.error || 'Connecte-toi dans Twiin.' };
  if (!r.ok) return { error: j.error || `Erreur ${r.status}` };
  return j;
}

// --- État de l'enregistrement : remonté par l'onglet Twiin (bridge.js) ---
async function setRecording(rec) { // enregistrement lancé depuis la page Twiin elle-même
  await chrome.storage.session.set({ recPage: rec });
  paintBadge();
}
// État affiché : l'enregistrement de l'extension en priorité, sinon celui de la page Twiin
async function recState() {
  const { rec, recPage } = await chrome.storage.session.get(['rec', 'recPage']);
  return rec?.on || rec?.analyzing ? rec : recPage?.on ? recPage : rec || null;
}

// --- Onglet Twiin : le retrouver ou l'ouvrir ---
async function twiinTab(hash = '', { focus = true } = {}) {
  const b = await base();
  const tabs = await chrome.tabs.query({ url: [`${b}/*`, b.replace('localhost', '127.0.0.1') + '/*'] });
  // de préférence la page principale (celle qui enregistre), pas Mes vidéos / Mes automatisations
  let tab = tabs.find((t) => { const p = new URL(t.url).pathname; return p === '/' || p === '/index.html'; }) || null;
  if (!tab) tab = await chrome.tabs.create({ url: `${b}/${hash}`, active: focus });
  else if (focus) {
    await chrome.tabs.update(tab.id, { active: true, ...(hash ? { url: `${b}/${hash}` } : {}) });
    await chrome.windows.update(tab.windowId, { focused: true });
  }
  return tab;
}
async function openPage(page) {
  const b = await base();
  const tabs = await chrome.tabs.query({ url: `${b}/${page}*` });
  if (tabs[0]) { await chrome.tabs.update(tabs[0].id, { active: true }); await chrome.windows.update(tabs[0].windowId, { focused: true }); }
  else await chrome.tabs.create({ url: `${b}/${page}` });
}
// Message à l'onglet Twiin, une fois sa page chargée (bridge.js prêt)
async function tellTwiin(tab, msg) {
  for (let i = 0; i < 20; i++) {
    try { return await chrome.tabs.sendMessage(tab.id, msg); } catch { await new Promise((r) => setTimeout(r, 300)); }
  }
  return null;
}

// --- Enregistrer depuis l'extension : tout se passe dans le panneau latéral (sidepanel.html) ---
// Le panneau reste ouvert quand on change d'onglet ; il capture lui-même l'écran choisi, montre l'analyse, puis la tâche
// trouvée avec « Créer l'automatisation » et « Créer la vidéo de formation ». Le service worker ne fait que relayer.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
let panelPort = null;
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'panel') return;
  panelPort = port;
  port.onMessage.addListener(async (m) => { if (m.type === 'rec') onRecUpdate(m.rec); });
  port.onDisconnect.addListener(async () => {
    panelPort = null;
    const { rec } = await chrome.storage.session.get('rec');
    if (rec?.on || rec?.analyzing) onRecUpdate({ on: false, error: 'Le panneau Twiin a été fermé : l\'enregistrement est perdu.' });
    else { await chrome.storage.session.remove('rec'); paintBadge(); }
  });
  chrome.storage.session.get('pendingRecord').then(({ pendingRecord }) => { // demandé avant que le panneau soit ouvert
    if (pendingRecord) { chrome.storage.session.remove('pendingRecord'); port.postMessage({ type: 'record' }); }
  });
});
// Depuis la bulle, le clic droit ou ⌥⇧R : ouvrir le panneau (geste de l'employé requis) puis lancer l'enregistrement
function startRecording(windowId) {
  if (panelPort) { panelPort.postMessage({ type: 'record' }); return { ok: true }; }
  chrome.storage.session.set({ pendingRecord: true });
  const open = windowId != null ? chrome.sidePanel.open({ windowId }) : chrome.windows.getLastFocused().then((w) => chrome.sidePanel.open({ windowId: w.id }));
  return open.then(() => ({ ok: true }), (e) => { chrome.storage.session.remove('pendingRecord'); notify('rec', 'Twiin', 'Clique sur l\'icône Twiin pour ouvrir le panneau, puis sur « Enregistrer une tâche ».'); return { error: e.message }; });
}
async function stopRecording() {
  const { rec, recPage } = await chrome.storage.session.get(['rec', 'recPage']);
  if (rec?.on && panelPort) { panelPort.postMessage({ type: 'stop' }); return { ok: true }; }
  if (recPage?.on) { // enregistrement lancé depuis la page Twiin : on le termine là-bas
    const tab = await twiinTab('', { focus: false });
    return (await tellTwiin(tab, { type: 'record:stop' })) || { error: 'Onglet Twiin introuvable.' };
  }
  return { error: 'Aucun enregistrement en cours.' };
}
// Nouvelles du panneau : état de l'enregistrement et de l'analyse (badge, bulle) ; notification si le résultat arrive
async function onRecUpdate(rec) {
  const prev = (await chrome.storage.session.get('rec')).rec || {};
  await chrome.storage.session.set({ rec });
  paintBadge();
  if (rec.done && !prev.done) notify('rec', rec.done.n ? `Analyse terminée : « ${rec.done.name} »` : 'Analyse terminée : aucune tâche trouvée',
    rec.done.n ? 'Dans le panneau Twiin : créer l\'automatisation ou la vidéo de formation.' : 'Refais la tâche du début à la fin.');
  if (rec.error && rec.error !== prev.error) notify('rec', 'Enregistrement Twiin', rec.error);
}
function notify(id, title, message) {
  chrome.notifications.create(`${id}-${Date.now()}`, { type: 'basic', iconUrl: 'icons/128.png', title, message, priority: 1 });
}
chrome.notifications.onClicked.addListener((id) => {
  chrome.notifications.clear(id);
  chrome.windows.getLastFocused().then((w) => chrome.sidePanel.open({ windowId: w.id })).catch(() => {});
});

// --- Badge de l'icône : REC (enregistrement), ● (automatisation en cours), heure (prochain lancement) ---
let last = { etat: null, at: 0 };
async function etat(force = false) {
  if (!force && Date.now() - last.at < 2500 && last.etat) return last.etat;
  last = { etat: await api('/api/automations/etat'), at: Date.now() };
  paintBadge();
  return last.etat;
}
async function paintBadge() {
  const rec = await recState();
  const e = last.etat || {};
  let text = '', color = '#121418';
  if (rec?.on) { text = 'REC'; color = '#e05a5a'; }
  else if (rec?.analyzing) { text = '…'; color = '#7d9be3'; }
  else if (e.running) { text = '●'; color = e.sur_mac ? '#b7791f' : '#7d9be3'; }
  else if (e.prochain) {
    text = new Date(e.prochain.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
    color = '#6b7180';
  }
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setTitle({ title: rec?.on ? 'Twiin enregistre ta tâche' : rec?.analyzing ? 'Twiin analyse ta tâche' : e.running ? `Twiin : ${e.name}` : e.prochain ? `Twiin : ${e.prochain.name} programmée` : 'Twiin' });
}

// --- Menus, raccourcis, réveil périodique ---
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'record', title: 'Enregistrer une tâche avec Twiin', contexts: ['page', 'action'] });
    chrome.contextMenus.create({ id: 'autos', title: 'Mes automatisations Twiin', contexts: ['page'] });
  });
  chrome.alarms.create('etat', { periodInMinutes: 0.5 });
});
chrome.runtime.onStartup.addListener(() => chrome.alarms.create('etat', { periodInMinutes: 0.5 }));
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'etat') etat(true); });
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'record') startRecording(tab?.windowId);
  if (info.menuItemId === 'autos') openPage('automatisations.html');
});
chrome.commands.onCommand.addListener((cmd, tab) => {
  if (cmd === 'toggle-record') { // l'état est lu dans la session, le panneau s'ouvre dans le geste de l'employé
    if (!panelPort) return startRecording(tab?.windowId);
    chrome.storage.session.get('rec').then(({ rec }) => (rec?.on ? stopRecording() : startRecording()));
  }
  if (cmd === 'stop-all') api('/api/automations/stop', { method: 'POST' }).then(() => etat(true));
});

// --- Messages de la fenêtre et des pages ---
const HANDLERS = {
  etat: () => etat(),
  state: async () => ({ etat: await etat(), rec: await recState(),
                         prefs: await chrome.storage.local.get(['bubble', 'hidden']) }),
  api: (m) => api(m.path, m),
  'record:start': (m, sender) => startRecording(sender?.tab?.windowId),
  'record:stop': () => stopRecording(),
  'recorder:config': async () => ({ base: await base(), token: (await chrome.storage.session.get('token')).token || null }),
  'record:state': (m) => setRecording(m.rec),
  token: async (m) => { await chrome.storage.session.set({ token: m.token || null }); return { ok: true }; },
  open: (m) => (m.page ? openPage(m.page) : twiinTab(m.hash || '')),
  stop: async () => { const r = await api('/api/automations/stop', { method: 'POST' }); etat(true); return r; },
  run: async (m) => { const r = await api(`/api/automations/${encodeURIComponent(m.id)}/run`, { method: 'POST' }); etat(true); return r; },
};
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  const h = HANDLERS[m?.type];
  if (!h) return false;
  Promise.resolve(h(m, sender)).then((r) => reply(r ?? { ok: true }), (e) => reply({ error: e.message }));
  return true; // réponse asynchrone
});
