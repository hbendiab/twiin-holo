// Twiin · panneau latéral : tout au même endroit. Enregistrer → analyse → tâche trouvée → créer l'automatisation ou la
// vidéo de formation, avec l'avancement en direct ; et les automatisations (lancer, programmer) et les tutos.
// Le panneau reste ouvert quand on change d'onglet. Il capture lui-même l'écran (capture.js).
const ask = (m) => chrome.runtime.sendMessage(m);
const api = (path, opts = {}) => ask({ type: 'api', path, ...opts });
const $ = (s) => document.querySelector(s);
const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dur = (s) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : s >= 60 ? `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')}` : `${Math.round(s)} s`);
const clock = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function quand(iso) {
  const d = new Date(iso), now = new Date(), demain = new Date(); demain.setDate(now.getDate() + 1);
  const h = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', ' h ');
  return d.toDateString() === now.toDateString() ? `aujourd'hui à ${h}` : d.toDateString() === demain.toDateString() ? `demain à ${h}`
    : `${d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric' })} à ${h}`;
}
const CRENEAUX = [['12:30', 'Pause déj. 12 h 30'], ['18:30', 'Fin de journée 18 h 30'], ['08:30', 'Demain 8 h 30', true]];
function prochaine(hhmm, demain = false) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(); d.setHours(h, m, 0, 0);
  if (demain || d <= new Date()) d.setDate(d.getDate() + 1);
  return d;
}

// Site de l'onglet actif : sert seulement, ici, à mettre en tête les automatisations de ce site. Jamais envoyé.
let site = '';
const SITE_TOOLS = [[/linkedin\.com$/, ['linkedin']], [/docs\.google\.com$/, ['sheets', 'google']], [/mail\.google\.com$/, ['gmail']],
  [/(office|live|microsoft|sharepoint)\.com$/, ['onenote', 'excel', 'word', 'outlook', 'teams']], [/notion\.(so|site)$/, ['notion']]];
const surCeSite = (a) => {
  if (!site) return false;
  const kw = (SITE_TOOLS.find(([re]) => re.test(site))?.[1] || []).concat(site.split('.').slice(-2, -1));
  const txt = (a.name + ' ' + a.blocks.map((b) => b.name).join(' ')).toLowerCase();
  return kw.some((k) => k && txt.includes(k));
};
async function readSite() {
  try { const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); site = t?.url?.startsWith('http') ? new URL(t.url).hostname.replace(/^www\./, '') : ''; } catch { site = ''; }
}

let BASE = 'http://localhost:3000';
let S = { etat: null, rec: null, prefs: {} }, autos = null, last = null, tutos = null, tutoJob = null;
let tab = 'autos', openId = null, msg = {}, sel = 0, autoJob = null, lastHtml = '', tutoMine = false; // tutoMine : vidéo lancée depuis ce panneau
const C = Capture.state;

// --- Lien avec le service worker : état pour le badge et la bulle ; ordres venus de ⌥⇧R, de la bulle, du clic droit ---
const port = chrome.runtime.connect({ name: 'panel' });
const report = () => port.postMessage({ type: 'rec', rec: {
  on: C.recording, analyzing: C.analyzing, since: C.startedAt || null, frames: C.frames, screens: C.screens.length,
  ...(C.result && !C.analyzing ? { done: { n: C.result.workflows.length, name: C.result.workflows[0]?.name || null } } : {}),
  ...(C.error ? { error: C.error } : {}) } });
port.onMessage.addListener((m) => {
  if (m.type === 'record') record(false);
  if (m.type === 'stop' && C.recording) Capture.stop();
});
let wasAnalyzing = false;
Capture.config({ onUpdate: () => {
  report();
  if (wasAnalyzing && !C.analyzing && C.result) { sel = 0; autoJob = null; tutoMine = false; tutoJob = null; loadData(); } // nouvelle tâche : on recharge tout
  wasAnalyzing = C.analyzing;
  render();
} });

async function record(fromClick) {
  try { await Capture.start({ fromClick }); }
  catch (e) {
    if (e.name === 'NotAllowedError' || /annulé/.test(e.message)) return render(); // l'employé a fermé le sélecteur
    C.error = fromClick ? `Capture impossible : ${e.message}` : 'Clique sur « Enregistrer une tâche » pour choisir l\'écran.';
    render();
  }
}

// --- Données ---
async function load() {
  S = await ask({ type: 'state' });
  const e = S.etat || {};
  const conn = $('#conn');
  conn.className = `chip ${e.offline ? 'off' : e.login ? '' : 'ok'}`;
  conn.textContent = e.offline ? 'Twiin arrêté' : e.login ? 'Non connecté' : 'Connecté';
  $('#bubbleToggle').checked = S.prefs.bubble !== false;
  const hidden = S.prefs.hidden || [];
  $('#resetHidden').hidden = !hidden.length;
  $('#resetHidden').textContent = `Remontrer la bulle sur ${hidden.length} site${hidden.length > 1 ? 's' : ''} masqué${hidden.length > 1 ? 's' : ''}`;
}
async function loadData() {
  const [a, c, t, j] = await Promise.all([api('/api/automations'), api('/api/candidates'), api('/api/tutos'), api('/api/tuto/status')]);
  autos = a; last = c?.workflows?.[0] || null; tutos = t?.tutos || []; tutoJob = j?.phase && j.phase !== 'idle' && (j.running || tutoMine) ? j : null;
  render();
}
const task = () => (C.result?.workflows?.length ? C.result.workflows[sel] || C.result.workflows[0] : last);

// --- Affichage (redessiné seulement si quelque chose a changé : la vidéo et les champs ouverts ne sont pas effacés) ---
const PHASES = [['upload', 'Envoi des dernières images'], ['ocr', 'Lecture du texte de l\'écran, sur ton Mac'], ['model', 'Analyse des étapes'], ['parse', 'Mise en forme de la tâche']];
function render() {
  const e = S.etat || {};
  let h = '';
  if (e.offline) {
    h = `<div class="card"><h3>Twiin n'est pas lancé sur ce Mac</h3>
      <p class="sub">Appuie sur <kbd>⌥⌘T</kbd> (raccourci Twiin) : il démarre Twiin. Sinon, dans un terminal :</p>
      <code>cd twiin/recorder && node server.js</code></div>`;
  } else if (e.login) {
    h = `<div class="card"><h3>Connecte-toi à Twiin</h3><p class="sub">Le panneau utilise ta session Twiin.</p>
      <button class="b dark" data-act="page" data-page="login.html" type="button">Se connecter</button></div>`;
  } else {
    h += liveAutomation(e) + captureBlock() + taskBlock();
    if (!C.recording && !C.analyzing) {
      h += `<div class="tabs" role="tablist"><button role="tab" data-tab="autos" aria-selected="${tab === 'autos'}" type="button">Automatisations</button>
        <button role="tab" data-tab="tutos" aria-selected="${tab === 'tutos'}" type="button">Vidéos de formation</button></div>`;
      h += tab === 'autos' ? renderAutos() : renderTutos();
    }
  }
  if (h !== lastHtml) { $('#app').innerHTML = h; lastHtml = h; }
  tickClock();
}
function tickClock() { const t = document.getElementById('recTime'); if (t && C.recording) t.textContent = clock((Date.now() - C.startedAt) / 1000); }

function liveAutomation(e) {
  let h = '';
  if (e.running) {
    const reste = e.estimate_s ? e.estimate_s - (e.elapsed_s || 0) : null;
    const pct = e.estimate_s ? Math.min(100, Math.round((100 * (e.elapsed_s || 0)) / e.estimate_s)) : null;
    h += `<div class="card"><div class="live ${e.sur_mac ? 'mac' : ''}"><span class="dot"></span><span class="t">
      <b>${e.sur_mac ? 'Twiin utilise ton Mac' : 'Twiin travaille en arrière-plan'}</b><span>${esc(e.name)}${reste != null ? ` · ${reste > 0 ? `encore ~${dur(reste)}` : 'presque fini'}` : ''}</span>
      ${pct != null ? `<div class="bar"><span style="width:${pct}%"></span></div>` : ''}</span>
      <button class="b red" data-act="stop" type="button">Arrêter</button></div>
      ${e.sur_mac ? '<p class="sub" style="margin:8px 0 0">Ne touche ni la souris ni le clavier jusqu\'à la fin.</p>' : ''}</div>`;
  } else if (e.prochain) {
    h += `<div class="card"><div class="live plan"><span class="dot"></span><span class="t"><b>Programmée ${esc(quand(e.prochain.at))}</b>
      <span>${esc(e.prochain.name)}</span></span><button class="b" data-act="unplan" data-id="${esc(e.prochain.id)}" type="button">Annuler</button></div></div>`;
  }
  return h;
}

function captureBlock() {
  if (C.recording) {
    return `<div class="card"><div class="live rec"><span class="dot"></span><span class="t"><b>Enregistrement en cours</b>
        <span>${C.screens.length} écran${C.screens.length > 1 ? 's' : ''} · ${C.frames} image${C.frames > 1 ? 's' : ''} gardée${C.frames > 1 ? 's' : ''}</span></span></div>
      <p class="timer" id="recTime">00:00</p>
      <div class="thumbs">${C.thumbs.length ? C.thumbs.map((src) => `<img src="${src}" alt="">`).join('') : '<span class="empty">Les images apparaissent ici dès que l\'écran change.</span>'}</div>
      <p class="sub">Fais ta tâche normalement, dans n'importe quel onglet ou appli. Ce panneau reste ouvert : reviens ici pour finir.</p>
      <button class="b dark big" data-act="recstop" type="button">Terminer et analyser</button>
      <div class="row" style="margin-top:8px;justify-content:space-between"><button class="b" data-act="recadd" type="button">+ Ajouter un écran</button>
        <button class="link" data-act="reccancel" type="button">Annuler sans analyser</button></div></div>`;
  }
  if (C.analyzing) {
    const k = Math.max(0, PHASES.findIndex(([p]) => p === C.phase));
    return `<div class="card"><h3>Twiin analyse ta tâche</h3><p class="sub">${C.frames} images · environ une minute.</p>
      <ul class="checks">${PHASES.map(([, l], i) => `<li class="${i < k ? 'done' : i === k ? 'now' : ''}"><span class="c">${i < k ? '✓' : ''}</span>${l}</li>`).join('')}</ul></div>`;
  }
  let h = '';
  if (S.rec?.on) { // enregistrement lancé depuis la page Twiin
    h += `<div class="card"><div class="live rec"><span class="dot"></span><span class="t"><b>Enregistrement en cours dans la page Twiin</b></span></div>
      <button class="b dark big" style="margin-top:10px" data-act="recstoppage" type="button">Terminer et analyser</button></div>`;
    return h;
  }
  if (C.error) h += `<div class="card"><div class="live plan"><span class="t"><b>Enregistrement interrompu</b><span>${esc(C.error)}</span></span>
    <button class="link" data-act="recclear" type="button">OK</button></div></div>`;
  h += `<button class="b dark big" data-act="rec" type="button"><span class="recdot"></span>Enregistrer une tâche</button>`;
  return h;
}

function taskBlock() {
  if (C.recording || C.analyzing) return '';
  if (C.result && !C.result.workflows.length) {
    return `<div class="label">Résultat</div><div class="card"><h3>Aucune tâche trouvée</h3>
      <p class="sub">Refais ta tâche du début à la fin, sans t'arrêter, puis termine.</p></div>`;
  }
  const t = task();
  if (!t) return '';
  const fresh = !!C.result;
  const steps = t.steps || [];
  const busy = !!S.etat?.running || autoJob?.running;
  let h = `<div class="label">${fresh ? 'Tâche trouvée' : 'Dernière tâche analysée'}</div><div class="card task">`;
  if (fresh && C.result.workflows.length > 1) {
    h += `<p class="sub">${C.result.workflows.length} tâches trouvées :</p><div class="others">${C.result.workflows.map((w, i) =>
      `<button class="b" data-act="sel" data-i="${i}" aria-pressed="${i === sel}" type="button">${esc(w.name)}</button>`).join('')}</div>`;
  }
  h += `<h2>${esc(t.name)}</h2><p class="sub">${esc(t.summary || '')}</p>
    <ol class="steps">${steps.slice(0, 5).map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
    ${steps.length > 5 ? `<details class="more"><summary>Voir les ${steps.length - 5} autres étapes</summary><ol class="steps" start="6">${steps.slice(5).map((x) => `<li>${esc(x)}</li>`).join('')}</ol></details>` : ''}
    <div class="actions">
      <button class="b dark" data-act="mkauto" type="button" ${busy ? 'disabled' : ''}>Créer l'automatisation</button>
      <button class="b" data-act="mktuto" type="button" ${tutoJob?.running ? 'disabled' : ''}>Créer la vidéo de formation</button>
      <button class="link" data-act="twiin" data-hash="#enregistrer" type="button">Corriger les étapes dans Twiin</button>
    </div>${autoBlock()}${tutoBlock()}</div>`;
  return h;
}

function autoBlock() {
  if (!autoJob) return '';
  const ICO = { wait: '⏳', ok: '✅', bad: '❌' };
  return `<div class="job"><h4>Automatisation</h4><p class="st">${esc(autoJob.status)}</p>
    ${autoJob.blocks.length ? `<ol>${autoJob.blocks.map((b) => `<li><span>${ICO[b.state]}</span><span><b>${esc(b.name)}</b> <span class="o">${esc(b.out || '')}</span></span></li>`).join('')}</ol>` : ''}
    ${autoJob.holo ? `<p class="st" style="margin-top:6px">${esc(autoJob.holo)}</p>` : ''}
    ${autoJob.ok ? `<div class="row"><button class="b dark" data-act="run" data-id="${esc(autoJob.id)}" type="button">Lancer maintenant</button>
      <button class="b" data-act="goplan" data-id="${esc(autoJob.id)}" type="button">Programmer</button></div>` : ''}
    ${autoJob.n8n ? `<div class="row"><button class="link" data-act="url" data-url="${esc(autoJob.n8n)}" type="button">Voir dans n8n (avancé)</button></div>` : ''}</div>`;
}
function tutoBlock() {
  const j = tutoJob;
  if (!j) return '';
  const PH = { images: 'Images de chaque étape', voice: 'Voix off', render: 'Montage de la vidéo' };
  if (j.running) {
    const pct = j.phase === 'render' ? 40 + Math.round((j.percent || 0) * 0.6) : j.phase === 'voice' ? 25 : 10;
    return `<div class="job"><h4>Vidéo de formation</h4><p class="st">${esc(PH[j.phase] || 'Préparation')}… quelques minutes</p>
      <div class="bar"><span style="width:${pct}%"></span></div></div>`;
  }
  if (j.error) return `<div class="job"><h4>Vidéo de formation</h4><p class="st" style="color:var(--coral)">La vidéo n'a pas pu être fabriquée.</p>
    <p class="st">${esc(j.error.length > 160 ? j.error.slice(0, 160) + '…' : j.error)}</p>
    <div class="row"><button class="b dark" data-act="mktuto" type="button">Réessayer</button></div></div>`;
  if (j.url) {
    return `<div class="job"><h4>Vidéo de formation prête</h4><video src="${esc(BASE + j.url)}" controls preload="metadata"></video>
      <div class="row"><a class="b" href="${esc(BASE + j.url)}" download>Télécharger</a>
      <button class="link" data-act="page" data-page="videos.html" type="button">Toutes mes vidéos</button></div></div>`;
  }
  return '';
}

function renderAutos() {
  if (autos == null) return '<p class="muted">Chargement…</p>';
  if (autos.error) return `<p class="muted">${esc(autos.error)}</p>`;
  if (!autos.up) return `<div class="card"><h3>n8n est arrêté</h3><p class="sub">Il fait tourner tes automatisations.</p>
    <button class="b dark" data-act="n8n" type="button">Démarrer n8n</button></div>`;
  if (!autos.automations.length) return '<p class="muted">Pas encore d\'automatisation. Enregistre une tâche, puis « Créer l\'automatisation ».</p>';
  const list = [...autos.automations].sort((a, b) => surCeSite(b) - surCeSite(a));
  return list.map((a) => {
    const mac = a.blocks.some((b) => b.kind === 'holo' && b.env !== 'cloud');
    const isOpen = openId === a.id;
    return `<div class="auto"><div class="h"><span class="n" data-act="more" data-id="${esc(a.id)}" title="Options">${esc(a.name)}</span>
        <button class="b dark" data-act="run" data-id="${esc(a.id)}" type="button" ${S.etat?.running ? 'disabled' : ''}>${a.running ? 'En cours' : 'Lancer'}</button></div>
      <div class="m">${surCeSite(a) ? `<span class="site">Sur ${esc(site)}</span> · ` : ''}${esc(a.freq_label)}${a.plan ? ` · programmée ${esc(quand(a.plan))}` : ''}
        ${mac ? ' · <span class="pill mac">utilise ton Mac</span>' : ''} · <button class="link" data-act="more" data-id="${esc(a.id)}" type="button">${isOpen ? 'fermer' : 'programmer'}</button></div>
      ${isOpen ? `<div class="more">
        <div class="row">${CRENEAUX.map(([hh, l, dm]) => `<button class="b" data-act="plan" data-id="${esc(a.id)}" data-h="${hh}" data-demain="${dm ? 1 : ''}" type="button">${l}</button>`).join('')}</div>
        <div class="row"><input type="time" id="t-${esc(a.id)}" value="17:00" aria-label="Autre heure"><button class="b" data-act="plan" data-id="${esc(a.id)}" data-other="1" type="button">Programmer</button>
          ${a.plan ? `<button class="link" data-act="unplan" data-id="${esc(a.id)}" type="button">Annuler la programmation</button>` : ''}</div>
        <div class="row"><select id="f-${esc(a.id)}" aria-label="Fréquence">${[['manual', 'Manuelle (en pause)'], ['daily', 'Chaque jour'], ['weekly', 'Chaque lundi'], ['monthly', 'Le 1er du mois']]
          .map(([k, l]) => `<option value="${k}" ${a.freq === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <select id="h-${esc(a.id)}" aria-label="Heure">${['08:30', '09:00', '12:30', '18:30'].map((x) => `<option ${(a.heure || (mac ? '12:30' : '09:00')) === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
          <button class="b" data-act="freq" data-id="${esc(a.id)}" type="button">Régler</button></div>
        <div class="row">${a.sheet ? `<button class="link" data-act="url" data-url="${esc(a.sheet.url)}" type="button">Ouvrir le résultat</button>` : ''}
          <button class="link" data-act="page" data-page="automatisations.html#${encodeURIComponent(a.id)}" type="button">Historique</button></div>
      </div>` : ''}
      ${msg[a.id] ? `<p class="msg ${msg[a.id + 'Err'] ? 'err' : ''}">${esc(msg[a.id])}</p>` : ''}</div>`;
  }).join('');
}
function renderTutos() {
  if (tutos == null) return '<p class="muted">Chargement…</p>';
  if (!tutos.length) return '<p class="muted">Pas encore de vidéo. Après une analyse : « Créer la vidéo de formation ».</p>';
  return tutos.slice(0, 6).map((t) => `<div class="tuto" data-act="page" data-page="videos.html#${encodeURIComponent(t.name)}" role="button" tabindex="0">
    ${t.thumb ? `<img src="${esc(BASE + t.thumb)}" alt="">` : ''}<span><b>${esc(t.title)}</b><span>${t.seconds ? dur(t.seconds) : ''} · ${t.steps.length} étapes</span></span></div>`).join('')
    + '<button class="link" data-act="page" data-page="videos.html" type="button">Toutes mes vidéos</button>';
}

// --- Créer l'automatisation : même suivi que la page Reco, ici ---
async function createAutomation() {
  const wf = task();
  autoJob = { running: true, status: 'Twiin prépare le plan de l\'automatisation…', blocks: [], next: 0 };
  render();
  const r = await api('/api/n8n/create', { method: 'POST', body: { workflow: wf } });
  if (r.error) { Object.assign(autoJob, { running: false, status: `Erreur : ${r.error}` }); return render(); }
  autoJob.status = `Plan prêt : ${r.plan.blocks.length} blocs. Construction dans n8n, puis test…`;
  autoJob.blocks = r.plan.blocks.map((b) => ({ name: b.name, state: 'wait' }));
  render();
  const timer = setInterval(async () => {
    const d = await api(`/api/n8n/events?since=${autoJob.next}`);
    if (d.error) return;
    autoJob.next = d.next;
    for (const ev of d.events || []) {
      if (ev.type === 'imported') { autoJob.status = 'Créée dans n8n. Test en cours…'; autoJob.n8n = ev.url; autoJob.id = ev.id || autoJob.id; }
      if (ev.type === 'node') {
        const b = autoJob.blocks.find((x) => x.name === ev.name);
        if (b) { b.state = ev.status === 'success' ? 'ok' : 'bad'; b.out = [ev.ms != null ? `${Math.round(ev.ms / 100) / 10} s` : '', ev.error ? `Erreur : ${ev.error}` : ''].filter(Boolean).join(' · '); }
      }
      if (ev.type === 'done') {
        autoJob.ok = !!ev.ok; autoJob.id = ev.id || autoJob.id; autoJob.running = false;
        autoJob.status = ev.ok ? 'Automatisation créée et testée. Elle est en pause : lance-la ou programme-la.'
          : `Le test a échoué (${ev.status}). Ouvre-la dans n8n pour voir le bloc en erreur.`;
      }
    }
    const lastH = (d.holo || []).at(-1);
    autoJob.holo = d.holoRunning && lastH ? `${d.holoEnv === 'cloud' ? 'Holo travaille dans le cloud' : 'Holo travaille sur ton Mac, ne touche à rien'} : ${(lastH.step || lastH.answer || '').slice(0, 120)}…` : '';
    if (!d.running && !autoJob.running) { clearInterval(timer); loadData(); }
    if (!d.running && d.next > 0 && autoJob.running) { autoJob.running = false; clearInterval(timer); }
    render();
  }, 1500);
}
// --- Créer la vidéo de formation : avancement, puis la vidéo dans le panneau ---
async function createTuto() {
  const r = await api('/api/tuto/create', { method: 'POST', body: { workflow: task() } });
  if (r.error) { tutoJob = { error: r.error }; return render(); }
  tutoJob = { running: true, phase: 'images' }; tutoMine = true;
  render();
  const timer = setInterval(async () => {
    const j = await api('/api/tuto/status');
    if (j.error) return;
    tutoJob = j;
    if (!j.running) { clearInterval(timer); loadData(); }
    render();
  }, 2000);
}

// --- Clics ---
document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-act], [data-tab]');
  if (!el) return;
  if (el.dataset.tab) { tab = el.dataset.tab; return render(); }
  const { act, id } = el.dataset;
  const say = (k, text, err = false) => { msg[k] = text; msg[k + 'Err'] = err; render(); };
  if (act === 'rec') return record(true); // le clic autorise le partage d'écran
  if (act === 'recadd') { try { await Capture.addScreen({ fromClick: true }); } catch { /* sélecteur fermé */ } return; }
  if (act === 'recstop') return Capture.stop();
  if (act === 'reccancel') return Capture.cancel();
  if (act === 'recclear') return Capture.clear();
  if (act === 'recstoppage') { ask({ type: 'record:stop' }); return; }
  if (act === 'sel') { sel = Number(el.dataset.i); autoJob = null; tutoMine = false; tutoJob = null; return render(); }
  if (act === 'mkauto') return createAutomation();
  if (act === 'mktuto') return createTuto();
  if (act === 'stop') { el.textContent = 'Arrêt…'; await ask({ type: 'stop' }); }
  if (act === 'twiin') { ask({ type: 'open', hash: el.dataset.hash || '' }); return; }
  if (act === 'page') { ask({ type: 'open', page: el.dataset.page }); return; }
  if (act === 'url') { chrome.tabs.create({ url: el.dataset.url }); return; }
  if (act === 'more') { openId = openId === id ? null : id; return render(); }
  if (act === 'goplan') { tab = 'autos'; openId = id; await loadData(); document.querySelector('.tabs')?.scrollIntoView({ behavior: 'smooth' }); return; }
  if (act === 'n8n') { el.textContent = 'Démarrage…'; await api('/api/n8n/start', { method: 'POST' }); }
  if (act === 'run') {
    const r = await ask({ type: 'run', id });
    say(id, r.error || 'Lancée. Suis-la en haut du panneau ; tu seras prévenu à la fin.', !!r.error);
  }
  if (act === 'plan') {
    const name = autos.automations.find((a) => a.id === id)?.name;
    const at = el.dataset.other ? prochaine($(`#t-${CSS.escape(id)}`).value || '17:00') : prochaine(el.dataset.h, !!el.dataset.demain);
    const r = await api(`/api/automations/${encodeURIComponent(id)}/plan`, { method: 'POST', body: { at: at.toISOString(), name } });
    say(id, r.error || `Programmée ${quand(at.toISOString())}. Tu seras prévenu 2 min avant.`, !!r.error);
  }
  if (act === 'unplan') await api(`/api/automations/${encodeURIComponent(id)}/plan`, { method: 'DELETE' });
  if (act === 'freq') {
    el.textContent = '…';
    const r = await api(`/api/automations/${encodeURIComponent(id)}/schedule`, { method: 'POST',
      body: { freq: $(`#f-${CSS.escape(id)}`).value, heure: $(`#h-${CSS.escape(id)}`).value } });
    say(id, r.error || `Réglée : ${r.freq_label}.`, !!r.error);
  }
  await load();
  loadData();
});

$('#openTwiin').onclick = () => ask({ type: 'open' });
$('#bubbleToggle').onchange = (e) => chrome.storage.local.set({ bubble: e.target.checked });
$('#resetHidden').onclick = async () => { await chrome.storage.local.set({ hidden: [] }); await load(); render(); };
chrome.tabs.onActivated.addListener(() => readSite().then(render));

(async () => {
  const cfg = await ask({ type: 'recorder:config' }).catch(() => ({}));
  if (cfg?.base) BASE = cfg.base;
  Capture.config({ base: BASE, token: cfg?.token || null });
  await readSite();
  await load();
  render();
  if (!S.etat?.offline && !S.etat?.login) loadData();
  setInterval(tickClock, 1000);
  setInterval(async () => { // état en direct (automatisation en cours, programmée, enregistrement depuis la page)
    const before = JSON.stringify([S.etat?.running, S.etat?.prochain?.at, S.rec?.on, S.etat?.offline]);
    await load();
    if (JSON.stringify([S.etat?.running, S.etat?.prochain?.at, S.rec?.on, S.etat?.offline]) !== before) loadData();
    else render();
  }, 3000);
})();
