const startBtn = document.getElementById('startBtn');
const addBtn = document.getElementById('addBtn');
const stopBtn = document.getElementById('stopBtn');
const reBtn = document.getElementById('reBtn');
const statusEl = document.getElementById('status');
const screensEl = document.getElementById('screens');
const framesEl = document.getElementById('frames');
const resultsEl = document.getElementById('results');
const journalEl = document.getElementById('journal');

// Capture « quand l'écran change », sur UN OU PLUSIEURS écrans :
// chaque écran partagé est observé chaque seconde (en local, rien n'est envoyé), et on ne GARDE une image
// d'un écran que s'il diffère de la dernière image gardée de CET écran, une fois stabilisé.
const TICK_MS = 1_000;            // fréquence d'observation
const MIN_GAP_MS = 1_500;         // par écran : pas plus d'une image gardée toutes les 1,5 s
const SETTLE_MAX_MS = 3_000;      // si l'écran bouge sans arrêt (vidéo, défilement), on garde quand même après 3 s
const HEARTBEAT_MS = 60_000;      // une image par minute et par écran même si rien ne bouge (repère de temps)
const CHANGE_THRESHOLD = 3;       // écart moyen (0-255) sur une miniature 64×40 : au-dessus = l'écran a changé
const STABLE_THRESHOLD = 1.5;     // écart entre deux secondes consécutives : en dessous = écran stabilisé
const MODEL_MAX_DIMENSION = 1024; // image envoyée au modèle (coût)
const OCR_MAX_DIMENSION = 1600;   // image lue par l'OCR local (netteté des petits textes)

let screens = [];   // { n, label, stream, video, keptThumb, prevThumb, keptAt, changeSince, kept }
let nextScreen = 1;
let intervalId = null;
let frames = [];
let ticks = 0;
let startedAt = 0;
let recording = false;
let sessionId = null;        // dossier de l'enregistrement côté serveur (images + journal d'actions)
let sharedScreens = [];      // { n, label } de tous les écrans partagés pendant l'enregistrement
let journalNext = 0, journalTimer = null;
let uploads = [];            // envois d'images en cours (chaque image part au serveur dès qu'elle est prise)
let uploadErrors = 0;

// --- Un seul bouton plein à l'écran : la prochaine action (cahier UX, règle « une seule couleur d'action ») ----------
function setPrimary(btn) {
  document.querySelectorAll('button.primary').forEach((b) => b.classList.remove('primary'));
  btn?.classList.add('primary');
}

// --- Logos des outils (icons/icons.json, créé par scripts/fetch_icons.py) -----------------------------------------------
// On reconnaît un outil dans un texte par ses alias (« Microsoft Excel », « Excel », « com.microsoft.Excel »).
let ICONS = [];
const iconsReady = fetch('icons/icons.json').then((r) => r.json())
  .then((d) => {
    ICONS = (d.icons || []).map((e) => ({ ...e, res: e.aliases.map((a) =>
      new RegExp(`(^|[^\\p{L}\\p{N}])${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`, 'u')) }));
  })
  .catch(() => { ICONS = []; }); // pas de logos : la page marche quand même, en texte seul

// Outils cités dans un texte, dans l'ordre où ils apparaissent (au plus `max`).
function findIcons(text, max = 3) {
  if (!text || !ICONS.length) return [];
  const hits = [];
  for (const e of ICONS) {
    let pos = -1;
    for (const re of e.res) { const m = re.exec(text); if (m && (pos < 0 || m.index < pos)) pos = m.index; }
    if (pos >= 0 && !hits.some((h) => h.e.key === e.key)) hits.push({ e, pos });
  }
  return hits.sort((a, b) => a.pos - b.pos).slice(0, max).map((h) => h.e);
}
const iconImg = (e, cls = 'ticon') => `<img class="${cls}" src="icons/${e.file}" alt="" title="${escapeHtml(e.label)}">`;
const iconsHtml = (text, max) => findIcons(text, max).map((e) => iconImg(e)).join('');
// Bandeau « outils utilisés » : logo + nom, pour une liste d'étapes
function appsStrip(texts) {
  const seen = new Map();
  for (const t of texts) for (const e of findIcons(t, 5)) if (!seen.has(e.key)) seen.set(e.key, e);
  return [...seen.values()].map((e) => `<span class="app-pill">${iconImg(e)}${escapeHtml(e.label)}</span>`).join('');
}

// --- Thème : clair par défaut, sombre au choix (mémorisé sur ce navigateur) -----------------------------------------
const themeBtn = document.getElementById('themeBtn');
function applyThemeLabel() {
  themeBtn.textContent = document.documentElement.dataset.theme === 'dark' ? 'Thème clair' : 'Thème sombre';
}
themeBtn.addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme !== 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  try { localStorage.setItem('twiin-theme', dark ? 'dark' : 'light'); } catch { /* stockage bloqué : tant pis */ }
  applyThemeLabel();
});
applyThemeLabel();

// --- Les deux cellules de Twiin (une cellule qui se divise en deux, comme de vrais jumeaux) ------------------------
// Filtre SVG « gooey » (flou puis seuil) : deux cercles proches fusionnent en une seule forme.
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let cellsCount = 0;
function makeCells(container) {
  const id = `goo${++cellsCount}`;
  container.innerHTML = `
    <svg viewBox="40 40 400 220" role="img" aria-label="Deux cellules Twiin">
      <defs>
        <filter id="${id}" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="14" result="b"/>
          <feColorMatrix in="b" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 26 -11" result="g"/>
          <feComposite in="SourceGraphic" in2="g" operator="atop"/>
        </filter>
      </defs>
      <g filter="url(#${id})">
        <circle data-c="a" cx="240" cy="150" r="70" style="fill:var(--cell-a)"/>
        <circle data-c="b" cx="240" cy="150" r="70" style="fill:var(--cell-b)"/>
        <circle data-c="m" cx="240" cy="150" r="30" style="fill:var(--cell-a)"/>
      </g>
      <circle data-c="na" cx="240" cy="150" r="9" style="fill:var(--nucleus)" opacity="0.7"/>
      <circle data-c="nb" cx="240" cy="150" r="9" style="fill:var(--nucleus)" opacity="0.7"/>
    </svg>`;
  const q = (k) => container.querySelector(`[data-c="${k}"]`);
  const [a, b, m, na, nb] = ['a', 'b', 'm', 'na', 'nb'].map(q);
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  return (p) => { // p : 0 = une cellule, 1 = deux cellules séparées
    const d = 110 * ease(Math.min(1, Math.max(0, p)));
    const r = 70 - 8.4 * Math.sin(Math.PI * Math.min(p * 1.1, 1));
    a.setAttribute('cx', 240 - d); b.setAttribute('cx', 240 + d);
    a.setAttribute('r', r); b.setAttribute('r', r);
    m.setAttribute('r', Math.max(0, 34 * (1 - p * 1.6)));
    const nd = Math.min(d + 4 * p, 110);
    na.setAttribute('cx', 240 - nd); nb.setAttribute('cx', 240 + nd);
    nb.setAttribute('opacity', (0.7 * Math.min(1, p * 4)).toFixed(2));
  };
}
const drawLogo = makeCells(document.getElementById('logoCells'));
const drawAnalysis = makeCells(document.getElementById('analysisCells'));
let analysisMotion = { mode: 'idle', since: 0 }; // working : la cellule s'étire ; done : elle se divise
function animateCells(now) {
  drawLogo(0.42 + 0.1 * Math.sin(now / 1400));   // le logo « respire » : deux lobes collés
  const t = (now - analysisMotion.since) / 1000;
  if (analysisMotion.mode === 'working') drawAnalysis(0.28 + 0.24 * Math.sin(t * 1.8 - Math.PI / 2));
  else if (analysisMotion.mode === 'done') drawAnalysis(Math.min(1, 0.4 + t / 1.6));
  else if (analysisMotion.mode === 'fail') drawAnalysis(0);
  requestAnimationFrame(animateCells);
}
if (REDUCED_MOTION) { drawLogo(0.45); drawAnalysis(0.3); } else requestAnimationFrame(animateCells);

// --- Attente de l'analyse : étapes réelles, cochées au fil de l'eau (le serveur dit où il en est) -------------------
const analysisEl = document.getElementById('analysis');
const phasesEl = document.getElementById('phases');
const PHASES = [
  ['upload', 'Envoi des dernières images'],
  ['ocr', 'Lecture du texte de l\'écran, sur ton Mac'],
  ['model', 'Découpage en étapes par le modèle'],
  ['parse', 'Mise en forme du résultat'],
];
let phaseTimer = null, phaseStart = 0, phaseCurrent = null;
function showPhase(phase) {
  if (phase !== phaseCurrent) { phaseCurrent = phase; phaseStart = Date.now(); }
  const k = PHASES.findIndex(([p]) => p === phase);
  phasesEl.innerHTML = PHASES.map(([p, label], i) => {
    const cls = i < k ? 'done' : i === k ? 'active' : '';
    const sec = i === k ? `<span class="sec">${Math.round((Date.now() - phaseStart) / 1000)} s</span>` : '';
    return `<li class="${cls}"><i>${i < k ? '✓' : ''}</i>${label}${sec}</li>`;
  }).join('');
}
function startAnalysisPanel(firstPhase) {
  document.getElementById('example').hidden = true;
  analysisEl.hidden = false;
  document.getElementById('analysisTitle').textContent = 'Twiin analyse ta tâche';
  document.getElementById('phaseNote').textContent = 'Compte 1 à 2 minutes. Tu peux laisser la page ouverte.';
  analysisMotion = { mode: 'working', since: performance.now() };
  showPhase(firstPhase);
  clearInterval(phaseTimer);
  phaseTimer = setInterval(async () => {
    try {
      const { phase } = await (await fetch('/api/analysis/progress')).json();
      const known = PHASES.findIndex(([p]) => p === phase);
      const cur = PHASES.findIndex(([p]) => p === phaseCurrent);
      showPhase(known > cur ? phase : phaseCurrent); // on n'avance jamais à reculons
    } catch { showPhase(phaseCurrent); }
  }, 1000);
}
function endAnalysisPanel(ok, message) {
  clearInterval(phaseTimer);
  if (ok) {
    phasesEl.innerHTML = PHASES.map(([, label]) => `<li class="done"><i>✓</i>${label}</li>`).join('');
    document.getElementById('analysisTitle').textContent = 'Ton jumeau est prêt';
    document.getElementById('phaseNote').textContent = message || '';
    analysisMotion = { mode: 'done', since: performance.now() };
    if (REDUCED_MOTION) drawAnalysis(1);
    setTimeout(() => { analysisEl.hidden = true; }, 4000);
  } else {
    const k = Math.max(0, PHASES.findIndex(([p]) => p === phaseCurrent));
    phasesEl.innerHTML = PHASES.map(([, label], i) =>
      `<li class="${i < k ? 'done' : i === k ? 'fail' : ''}"><i>${i < k ? '✓' : i === k ? '!' : ''}</i>${label}</li>`).join('');
    document.getElementById('analysisTitle').textContent = 'L\'analyse s\'est arrêtée';
    document.getElementById('phaseNote').textContent = message || '';
    analysisMotion = { mode: 'fail', since: performance.now() };
  }
}

startBtn.addEventListener('click', startRecording);
addBtn.addEventListener('click', () => addScreen().catch((e) => (statusEl.textContent = `Écran non ajouté : ${e.message}`)));
stopBtn.addEventListener('click', stopRecording);
reBtn.addEventListener('click', () => analyzeRequest('/api/reanalyze', null, 'Nouvelle analyse du dernier enregistrement…'));

async function addScreen() {
  statusEl.textContent = `Choisis l'écran n°${nextScreen} à partager…`;
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  const video = document.createElement('video');
  video.muted = true;
  video.srcObject = stream;
  await video.play();
  const track = stream.getVideoTracks()[0];
  const scr = { n: nextScreen++, label: track.label || 'écran', stream, video,
                keptThumb: null, prevThumb: null, keptAt: 0, changeSince: 0, kept: 0 };
  screens.push(scr);
  sharedScreens.push({ n: scr.n, label: scr.label });
  // si l'utilisateur arrête le partage de cet écran depuis l'interface du navigateur
  track.addEventListener('ended', () => {
    screens = screens.filter((s) => s !== scr);
    renderScreens();
    if (recording && !screens.length) stopRecording();
  });
  renderScreens();
  if (recording) observe(scr, Date.now()); // première image de ce nouvel écran tout de suite
  return scr;
}

function renderScreens() {
  screensEl.innerHTML = screens
    .map((s) => `<span class="scr"><b>Écran ${s.n}</b> · ${escapeHtml(s.label)} · ${s.kept} image(s)</span>`)
    .join('');
}

async function startRecording() {
  frames = [];
  framesEl.innerHTML = '';
  resultsEl.innerHTML = '';
  screens = [];
  sharedScreens = [];
  nextScreen = 1;
  try {
    await addScreen();
  } catch (e) {
    statusEl.textContent = `Partage annulé : ${e.message}`;
    return;
  }
  recording = true;
  setStep(1);
  document.getElementById('example').hidden = true;
  analysisEl.hidden = true;
  setPrimary(stopBtn);
  ticks = 0;
  startedAt = Date.now();
  uploads = []; uploadErrors = 0;
  await startJournal(); // crée le dossier de l'enregistrement côté serveur avant la première image
  startBtn.disabled = true;
  addBtn.disabled = false;
  stopBtn.disabled = false;

  tick(); // premières images tout de suite
  intervalId = setInterval(tick, TICK_MS);
}

// --- Journal d'actions : démarré avec l'enregistrement, affiché en direct ---------------------------------------
async function startJournal() {
  journalEl.innerHTML = '<h4>Journal de tes actions</h4><ol></ol>';
  journalNext = 0;
  try {
    const r = await fetch('/api/actions/start', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                                 body: JSON.stringify({ startedAt }) });
    sessionId = (await r.json()).session || null;
  } catch { sessionId = null; }
  journalTimer = setInterval(pollJournal, 1000);
}

function sharedNumber(displayId) {
  const s = sharedScreens.find((x) => new RegExp(`^screen:${displayId}:`).test(x.label));
  return s ? `É${s.n}` : (displayId != null ? `écran macOS ${displayId}` : '');
}

async function pollJournal() {
  try {
    const r = await fetch(`/api/actions?since=${journalNext}`);
    const { events, next } = await r.json();
    journalNext = next;
    const ol = journalEl.querySelector('ol');
    for (const e of events) {
      forceCaptureAfter(e);
      let text = null;
      const t = `${Math.max(0, e.ts - startedAt / 1000).toFixed(1)} s`;
      const where = [sharedNumber(e.display), e.app].filter(Boolean).join(' · ');
      if (e.type === 'start') text = e.clicks_and_keys ? 'Journal démarré (clics, saisies, raccourcis, apps).'
        : '⚠️ Clics et clavier non autorisés (Réglages Système → Surveillance de l\'entrée) : seuls les changements d\'app sont notés.';
      else if (e.type === 'app') text = `${where} au premier plan${e.window ? ` — ${e.window}` : ''}`;
      else if (e.type === 'click') text = `${where} · clic sur ${e.element || 'un élément'}`;
      else if (e.type === 'typing') text = `${where} · saisie (${e.keys ?? '?'} frappes) dans ${e.element || 'le champ actif'}`;
      else if (e.type === 'shortcut') text = `${where} · raccourci ${e.keys}`;
      else if (e.type === 'key') text = `${where} · touche ${e.keys}${e.element ? ` dans ${e.element}` : ''}`;
      if (!text) continue;
      const li = document.createElement('li');
      const ico = findIcons(`${e.app || ''} ${e.window || ''}`, 1)[0];
      li.innerHTML = `<span>${t}</span> ${ico ? iconImg(ico) : ''}${escapeHtml(text)}`;
      ol.appendChild(li);
      ol.scrollTop = ol.scrollHeight;
    }
  } catch { /* le serveur peut être occupé : on réessaie à la seconde suivante */ }
}

// Une saisie (terminée), un collage, un raccourci ou un clic change parfois trop peu de pixels pour déclencher une image
// (quelques caractères dans une cellule). On force donc une image DE L'ÉCRAN CONCERNÉ juste après ces actions :
// la valeur tapée ou collée est alors toujours visible pour l'OCR.
function forceCaptureAfter(e) {
  if (!recording || !['typing', 'shortcut', 'click', 'key'].includes(e.type)) return;
  const shared = sharedScreens.find((x) => new RegExp(`^screen:${e.display}:`).test(x.label));
  const targets = shared ? screens.filter((s) => s.n === shared.n) : screens; // écran inconnu : tous les écrans
  const delay = e.type === 'click' ? 700 : 400; // laisse l'interface se mettre à jour
  for (const scr of targets) {
    clearTimeout(scr.forceTimer);
    scr.forceTimer = setTimeout(() => {
      if (!recording || !scr.video?.videoWidth) return;
      const now = Date.now();
      if (now - scr.keptAt < 700) return; // une image vient d'être prise sur cet écran
      keepFrame(scr, thumbnail(scr.video), now);
    }, delay);
  }
}

async function stopJournal() {
  clearInterval(journalTimer);
  await pollJournal();
  try { await fetch('/api/actions/stop', { method: 'POST' }); } catch { /* rien */ }
}

function snapshot(video, maxDim, quality) {
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, maxDim / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

function thumbnail(video) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 40;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, 64, 40);
  const px = ctx.getImageData(0, 0, 64, 40).data;
  const gray = new Float32Array(64 * 40);
  for (let i = 0; i < gray.length; i++) gray[i] = 0.299 * px[4 * i] + 0.587 * px[4 * i + 1] + 0.114 * px[4 * i + 2];
  return gray;
}

function diff(a, b) {
  if (!a || !b) return 255;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

function observe(scr, now) {
  if (!scr.video?.videoWidth) return;
  const t = thumbnail(scr.video);
  const changed = diff(t, scr.keptThumb) > CHANGE_THRESHOLD;
  const stable = diff(t, scr.prevThumb) < STABLE_THRESHOLD;
  scr.prevThumb = t;

  if (changed && !scr.changeSince) scr.changeSince = now;
  const settled = changed && (stable || now - scr.changeSince > SETTLE_MAX_MS);
  const heartbeat = now - scr.keptAt > HEARTBEAT_MS;
  if ((scr.keptThumb === null || settled || heartbeat) && now - scr.keptAt >= MIN_GAP_MS) {
    keepFrame(scr, t, now);
  }
}

function tick() {
  if (!screens.length) return;
  ticks++;
  const now = Date.now();
  for (const scr of screens) observe(scr, now);
  statusEl.textContent = `Enregistrement… ${screens.length} écran(s) · ${frames.length} image(s) gardée(s) · ${ticks} s observées.`;
}

function keepFrame(scr, thumb, now) {
  scr.keptThumb = thumb; scr.keptAt = now; scr.changeSince = 0; scr.kept++;
  const frame = {
    index: frames.length,
    timestamp: new Date(now).toISOString(),
    seconds: Math.round((now - startedAt) / 1000),
    screen: scr.n,
    screen_label: scr.label,
    dataUrl: snapshot(scr.video, MODEL_MAX_DIMENSION, 0.7),
    ocrUrl: snapshot(scr.video, OCR_MAX_DIMENSION, 0.85),
  };
  if (sessionId) {
    // l'image part tout de suite sur le disque du serveur ; la page ne garde qu'une petite vignette
    uploads.push(fetch('/api/frames', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ session: sessionId, frame }) })
      .then((r) => { if (!r.ok) uploadErrors++; })
      .catch(() => { uploadErrors++; }));
    frames.push({ index: frame.index, screen: frame.screen });
  } else {
    frames.push(frame); // secours : pas de dossier serveur, on garde tout pour l'envoyer au Stop
  }

  const wrap = document.createElement('div');
  wrap.className = 'thumb';
  const img = document.createElement('img');
  img.src = snapshot(scr.video, 192, 0.6);
  const tag = document.createElement('span');
  tag.textContent = `É${scr.n}`;
  wrap.append(img, tag);
  framesEl.appendChild(wrap);
  renderScreens();
}

let stopping = false;
async function stopRecording() {
  if (!recording || stopping) return;
  stopping = true;
  stopBtn.disabled = true;
  addBtn.disabled = true;
  statusEl.textContent = 'Arrêt : dernières actions et dernières images…';
  await stopJournal();               // lit les dernières actions (et force les dernières images)
  await new Promise((r) => setTimeout(r, 900));
  for (const scr of screens) if (scr.video?.videoWidth) keepFrame(scr, thumbnail(scr.video), Date.now()); // état final
  recording = false;
  stopping = false;
  clearInterval(intervalId);
  for (const s of screens) s.stream.getTracks().forEach((t) => t.stop());
  const nScreens = new Set(frames.map((f) => f.screen)).size;
  screens = [];
  startBtn.disabled = false;
  addBtn.disabled = true;
  stopBtn.disabled = true;

  setPrimary(startBtn);
  if (!frames.length) {
    statusEl.textContent = 'Aucune image gardée.';
    return;
  }

  statusEl.textContent = `Enregistrement terminé : ${frames.length} image(s) gardée(s) sur ${nScreens} écran(s).`;
  startAnalysisPanel('upload');

  if (sessionId) {
    await Promise.allSettled(uploads);
    if (uploadErrors) statusEl.textContent = `⚠️ ${uploadErrors} image(s) non enregistrée(s) côté serveur. Analyse quand même…`;
    await analyzeRequest('/api/generate-workflows', { session: sessionId, startedAt, screens: sharedScreens }, null, nScreens);
  } else {
    await analyzeRequest('/api/generate-workflows', { frames, startedAt, screens: sharedScreens }, null, nScreens);
  }
}

async function analyzeRequest(url, body, message, nScreens) {
  if (message) statusEl.textContent = message;
  reBtn.disabled = true;
  if (analysisEl.hidden || phaseCurrent === null) startAnalysisPanel(url.includes('reanalyze') ? 'ocr' : 'upload');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    if (data._discovery) {
      // Les étapes et conseils restent cachés tant que l'employé n'a pas confirmé que Twiin a bien compris.
      window.__pendingWorkflows = data.workflows || [];
      resultsEl.innerHTML = '';
      endAnalysisPanel(true, 'Twiin étudie ta tâche en détail pour bien la comprendre (quelques minutes). Il te posera une question juste après.');
      statusEl.textContent = 'Twiin étudie ta tâche…';
      return;
    }
    renderWorkflows(data.workflows || []);
    const m = data._meta || {};
    const n = data.workflows?.length ?? 0;
    endAnalysisPanel(true, `${n} tâche${n > 1 ? 's' : ''} trouvée${n > 1 ? 's' : ''}. Relis les étapes ci-dessous.`);
    statusEl.textContent = `Terminé. ${n} workflow(s) trouvé(s).` +
      (m.model ? ` Modèle ${m.model} · ${m.screens ?? nScreens ?? '?'} écran(s) · ` +
        (m.text_only ? 'texte OCR seul' : `${m.images_sent} image(s) envoyée(s)`) + ` · ${m.ocr_lines} lignes OCR · ` +
        `${m.usage?.prompt_tokens ?? '?'} tokens en entrée, ${m.usage?.completion_tokens ?? '?'} en sortie` +
        (m.cost_usd != null ? ` · ≈ ${m.cost_usd.toFixed(4)} $` : '') : '');
  } catch (err) {
    statusEl.textContent = `Erreur : ${err.message}`;
    endAnalysisPanel(false, `${err.message} Tu peux cliquer sur « Réanalyser le dernier enregistrement ».`);
  } finally {
    reBtn.disabled = false;
    phaseCurrent = null;
  }
}

// --- Workflow modifiable → « ✨ Améliorer » → « ▶ Rejouer sur mon Mac » (suivi en direct) ---------------------
// Barre du parcours : étapes faites (vert) et étape en cours (bleu)
function setStep(n) {
  document.querySelectorAll('#stepper li').forEach((li) => {
    const k = Number(li.dataset.step);
    li.classList.toggle('done', k < n);
    li.classList.toggle('active', k === n);
  });
}
setStep(1);

// Appelé par discovery.js quand l'employé confirme « Oui, c'est bien ça ».
window.twiinShowResults = async () => {
  let wfs = window.__pendingWorkflows;
  if (!wfs) { try { wfs = (await (await fetch('/api/candidates')).json()).workflows || []; } catch { wfs = []; } }
  window.__pendingWorkflows = null;
  renderWorkflows(wfs);
  statusEl.textContent = 'Voici les étapes comprises par Twiin.';
};

function renderWorkflows(workflows, { example = false } = {}) {
  if (workflows.length) setStep(2);
  resultsEl.innerHTML = '';
  document.getElementById('example').hidden = true;
  workflows.forEach((wf) => resultsEl.appendChild(workflowCard(wf, example)));
  setPrimary(resultsEl.querySelector('.btn-advice')); // prochaine action : voir où gagner du temps
}

function workflowCard(wf, example = false) {
  const card = document.createElement('div');
  card.className = 'workflow';
  let original = { name: wf.name, summary: wf.summary, steps: [...(wf.steps || [])] };
  const nSteps = (wf.steps || []).length;
  card.innerHTML = `
    ${example ? '<p><span class="chip-example">Exemple</span>enregistrement réel du 17/11 (veille L\'Oréal), pour la démonstration</p>' : ''}
    <input class="wf-name" value="${escapeHtml(wf.name || 'Workflow')}" title="Nom du workflow (modifiable)">
    <div class="apps-strip"></div>
    <p class="wf-summary">${escapeHtml(wf.summary || '')}</p>
    ${wf.why_daily ? `<p><strong>Pourquoi l'automatiser :</strong> ${escapeHtml(wf.why_daily)}</p>` : ''}
    <div class="card-step"><span class="num-inline">2</span> Relis et corrige les ${nSteps} étapes</div>
    <ol class="steps"></ol>
    <button class="icon-btn add-step">+ Ajouter une étape</button>
    <div class="card-step"><span class="num-inline">3</span> Vois où gagner du temps</div>
    <div class="wf-actions"><button class="btn-advice">Voir où gagner du temps</button></div>
    <div class="advice" hidden></div>
    <div class="card-step"><span class="num-inline">4</span> Choisis : accélérer ou automatiser</div>
    <div class="wf-actions"><button class="btn-verdict">Obtenir la recommandation de Twiin</button></div>
    <div class="verdict" hidden></div>
    <div class="optional">
      <div class="card-step">Facultatif · vérifier que Twiin a bien compris, avec Holo</div>
      <div class="wf-actions">
        <button class="btn-improve" title="Rend les étapes plus précises pour Holo, sans changer la tâche">Préciser les étapes pour Holo</button>
        <button class="btn-original" hidden>Revenir aux étapes d'origine</button>
        <button class="btn-replay" title="Holo refait la tâche sur ton Mac pour vérifier que Twiin l'a bien comprise">Faire refaire la tâche par Holo</button>
      </div>
      <div class="changes" hidden></div>
      <div class="replay" hidden></div>
    </div>`;
  const stepsEl = card.querySelector('.steps');
  const stripEl = card.querySelector('.apps-strip');
  // Logo de l'outil de chaque étape. Une étape qui ne cite aucun outil reprend celui de l'étape d'avant (logo pâle).
  const refreshIcons = () => {
    let last = null;
    const texts = [];
    stepsEl.querySelectorAll('li').forEach((li) => {
      const text = li.querySelector('textarea').value;
      texts.push(text);
      const found = findIcons(text, 2);
      const slot = li.querySelector('.step-ico');
      if (found.length) { slot.innerHTML = found.map((e) => iconImg(e)).join(''); slot.classList.remove('inherited'); last = found.at(-1); }
      else if (last) { slot.innerHTML = iconImg(last); slot.classList.add('inherited'); }
      else slot.innerHTML = '';
    });
    stripEl.innerHTML = appsStrip(texts);
  };
  const setSteps = (steps) => {
    stepsEl.innerHTML = '';
    steps.forEach((st) => addStep(st));
    refreshIcons();
  };
  const addStep = (text = '') => {
    const li = document.createElement('li');
    const slot = document.createElement('span');
    slot.className = 'step-ico';
    const ta = document.createElement('textarea');
    ta.value = text;
    const mark = () => ta.classList.toggle('todo', /à compléter/i.test(ta.value));
    ta.addEventListener('input', mark);
    ta.addEventListener('change', refreshIcons);
    setTimeout(mark);
    ta.rows = Math.min(6, Math.max(2, Math.ceil(text.length / 95)));
    const del = document.createElement('button');
    del.className = 'icon-btn';
    del.textContent = '×';
    del.title = 'Supprimer cette étape';
    del.onclick = () => { li.remove(); refreshIcons(); };
    li.append(slot, ta, del);
    stepsEl.appendChild(li);
    return ta;
  };
  const current = () => ({
    name: card.querySelector('.wf-name').value.trim() || 'Workflow',
    summary: card.querySelector('.wf-summary').textContent,
    steps: [...stepsEl.querySelectorAll('textarea')].map((t) => t.value.trim()).filter(Boolean),
  });
  setSteps(original.steps);
  card.querySelector('.add-step').onclick = () => addStep('').focus();

  // ✨ Améliorer : fiabilité pour Holo + process optimisé, avec la liste des changements
  const improveBtn = card.querySelector('.btn-improve');
  const origBtn = card.querySelector('.btn-original');
  const changesEl = card.querySelector('.changes');
  improveBtn.onclick = async () => {
    improveBtn.disabled = true;
    improveBtn.textContent = 'Précision des étapes…';
    try {
      const before = current();
      const r = await fetch('/api/improve', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                              body: JSON.stringify({ workflow: before }) });
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      original = before;
      card.querySelector('.wf-name').value = data.workflow.name || before.name;
      card.querySelector('.wf-summary').textContent = data.workflow.summary || before.summary;
      setSteps(data.workflow.steps);
      const items = (data.changes || []).map((c) => {
        const k = /process/i.test(c.kind || '') ? 'process' : 'fiabilite';
        return `<li><span class="tag ${k}">${k === 'process' ? 'process' : 'fiabilité'}</span>${escapeHtml(c.what || '')}</li>`;
      }).join('');
      const todo = data.workflow.steps.filter((x) => /à compléter/i.test(x)).length;
      changesEl.innerHTML = `<h4>Préparé pour Holo (${before.steps.length} → ${data.workflow.steps.length} étapes` +
        (data.cost_usd != null ? ` · ≈ ${data.cost_usd.toFixed(4)} $` : '') + `)</h4><ul>${items || '<li>Aucun changement proposé.</li>'}</ul>` +
        (todo ? `<p class="todo-msg">⚠️ ${todo} étape(s) contiennent une valeur « À compléter » (surlignée) : complète-la avant de rejouer.</p>` : '') +
        `<p style="font-size:12px;margin-top:8px">Tu peux encore modifier les étapes ci-dessus avant de rejouer.</p>`;
      changesEl.hidden = false;
      origBtn.hidden = false;
    } catch (e) {
      changesEl.innerHTML = `<h4>Préparation impossible</h4><ul><li>${escapeHtml(e.message)}</li></ul>`;
      changesEl.hidden = false;
    } finally {
      improveBtn.disabled = false;
      improveBtn.textContent = 'Préciser les étapes pour Holo';
    }
  };
  // 💡 Améliorer mon process : bilan chiffré + recommandations pour l'employé (les étapes ne sont pas modifiées)
  const adviceBtn = card.querySelector('.btn-advice');
  const adviceEl = card.querySelector('.advice');
  adviceBtn.onclick = async () => {
    adviceBtn.disabled = true;
    adviceBtn.textContent = 'Analyse de ton process…';
    try {
      const r = await fetch('/api/process-advice', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                                     body: JSON.stringify({ workflow: current() }) });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      const st = d.stats;
      const fmt = (x) => (x >= 60 ? `${Math.floor(x / 60)} min ${x % 60} s` : `${x} s`);
      const tiles = st ? [
        ['Durée', fmt(st.duration_s)], ['Changements d\'appli', st.app_switches], ['Clics', st.clicks],
        ['Copier / coller', `${st.copies} / ${st.pastes}`], ['Saisie au clavier', `${fmt(st.typing_s)} · ${st.keystrokes} frappes`],
      ].map(([k, v]) => `<div class="tile"><span>${k}</span><b>${v}</b></div>`).join('') : '';
      const apps = st ? Object.entries(st.time_per_app_s).map(([a, v]) => `${iconsHtml(a, 1)}${escapeHtml(a)} ${fmt(v)}`).join(' · ') : '';
      const recos = (d.recommendations || []).map((x) => `
        <li><div class="reco-head"><b>${escapeHtml(x.title || '')}</b><span class="gain">${escapeHtml(x.gain || '')}</span></div>
          <div class="kind">${escapeHtml(x.kind || '')}</div>
          <div><span class="lbl">Constaté :</span> ${escapeHtml(x.observed || '')}</div>
          <div><span class="lbl">À essayer :</span> ${escapeHtml(x.suggestion || '')}</div></li>`).join('');
      adviceEl.innerHTML = `<h4>💡 Ton process, vu par le journal${d.cost_usd != null ? ` <small>(≈ ${d.cost_usd.toFixed(4)} $)</small>` : ''}</h4>
        ${tiles ? `<div class="tiles">${tiles}</div><p class="apps">Temps par appli : ${apps}</p>` : '<p class="apps">Pas de journal d\'actions pour cet enregistrement : conseils basés sur les étapes seulement.</p>'}
        ${d.headline ? `<p class="headline">${escapeHtml(d.headline)}</p>` : ''}
        <ol class="recos">${recos}</ol>
        ${d.automation_potential ? `<p class="auto">🤖 ${escapeHtml(d.automation_potential)}</p>` : ''}`;
      adviceEl.hidden = false;
      setStep(4);
      setPrimary(verdictBtn); // prochaine action : la recommandation
    } catch (e) {
      adviceEl.innerHTML = `<h4>Analyse impossible</h4><p>${escapeHtml(e.message)}</p>`;
      adviceEl.hidden = false;
    } finally {
      adviceBtn.disabled = false;
      adviceBtn.textContent = 'Voir où gagner du temps';
    }
  };

  // 🧭 Verdict : Twiin recommande « accélérer » (tuto vidéo) ou « automatiser » (n8n + Holo) ; l'employé valide
  const verdictBtn = card.querySelector('.btn-verdict');
  const verdictEl = card.querySelector('.verdict');
  verdictBtn.onclick = async () => {
    verdictBtn.disabled = true;
    verdictBtn.textContent = 'Twiin réfléchit…';
    try {
      const r = await fetch('/api/verdict', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                              body: JSON.stringify({ workflow: current() }) });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      const auto = /automat/i.test(d.verdict || '');
      const tools = (d.tools || []).map((t) => `<span class="chip ${t.api ? 'api' : 'noapi'}">${iconsHtml(t.name, 1)}${escapeHtml(t.name)} · ${t.api ? 'API → n8n' : 'sans API → Holo'}</span>`).join('');
      const plan = (d.plan || []).map((p) => `<li>${iconsHtml(p.tool, 1)}<b>${escapeHtml(p.tool || '')}</b> <span class="how">${iconsHtml(p.how, 1)}${escapeHtml(p.how || '')}</span> — ${escapeHtml(p.what || '')}</li>`).join('');
      verdictEl.innerHTML = `
        <h4>🧭 Recommandation de Twiin : <span class="v ${auto ? 'auto' : 'acc'}">${auto ? '⚡ automatiser' : '🎬 accélérer'}</span>
          <small>confiance ${escapeHtml(d.confidence || '?')}${d.cost_usd != null ? ` · ≈ ${d.cost_usd.toFixed(4)} $` : ''}</small></h4>
        <ul class="reasons">${(d.reasons || []).map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>
        <p class="hint">Fréquence : ${escapeHtml(d.frequency_hint || '?')} · Gain : ${escapeHtml(d.time_saved || '?')}</p>
        <div class="chips">${tools}</div>
        ${plan ? `<ol class="plan">${plan}</ol>` : ''}
        <div class="card-step"><span class="num-inline">5</span> Crée ce que tu as choisi (c'est toi qui valides)</div>
        <div class="wf-actions">
          <button class="btn-tuto">Créer le tuto vidéo${auto ? '' : ' (recommandé)'}</button>
          <button class="btn-n8n">Créer l'automatisation n8n${auto ? ' (recommandé)' : ''}</button>
        </div>
        <div class="branch" hidden></div>`;
      verdictEl.hidden = false;
      setStep(5);
      setPrimary(verdictEl.querySelector(auto ? '.btn-n8n' : '.btn-tuto')); // l'option recommandée
      const branch = verdictEl.querySelector('.branch');
      verdictEl.querySelector('.btn-tuto').onclick = () => { branch.hidden = false; branch.textContent = '🎬 Tuto vidéo : en cours de construction (étape suivante).'; };
      verdictEl.querySelector('.btn-n8n').onclick = () => createN8n(current(), d, branch);
    } catch (e) {
      verdictEl.innerHTML = `<h4>Analyse impossible</h4><p>${escapeHtml(e.message)}</p>`;
      verdictEl.hidden = false;
    } finally {
      verdictBtn.disabled = false;
      verdictBtn.textContent = 'Obtenir la recommandation de Twiin';
    }
  };

  origBtn.onclick = () => {
    card.querySelector('.wf-name').value = original.name;
    card.querySelector('.wf-summary').textContent = original.summary || '';
    setSteps(original.steps);
    changesEl.hidden = true;
    origBtn.hidden = true;
  };

  // ▶ Rejouer sur mon Mac
  const replayBtn = card.querySelector('.btn-replay');
  const replayEl = card.querySelector('.replay');
  replayBtn.onclick = async () => {
    const wfNow = current();
    if (!wfNow.steps.length) return alert('Aucune étape à rejouer.');
    const todo = wfNow.steps.map((x, i) => (/à compléter/i.test(x) ? i + 1 : null)).filter(Boolean);
    if (todo.length) return alert(`Complète d'abord les étapes ${todo.join(', ')} : elles contiennent une valeur « ⚠️ À compléter ». ` +
      `Sinon Holo inventerait la valeur.`);
    const ok = confirm(`Holo va refaire « ${wfNow.name} » (${wfNow.steps.length} étape(s)) sur ton Mac.\n\n` +
      `• Il prend la souris et le clavier : ne touche à rien pendant le rejeu.\n` +
      `• VS Code sera masqué ; ferme ce qui est privé.\n` +
      `• Holo écrit exactement là où les étapes l'indiquent (cellules, pages) : vérifie que ce ne sont pas tes données d'origine.\n` +
      `• Pour l'arrêter : double Échap, ou le bouton « Arrêter Holo » de cette page.\n\nLancer le rejeu ?`);
    if (!ok) return;
    replayBtn.disabled = true;
    improveBtn.disabled = true;
    replayEl.hidden = false;
    replayEl.innerHTML = `<h4>Rejeu par Holo</h4><div class="rstatus">Démarrage…</div><ol></ol><div class="meta"></div>` +
      `<div class="wf-actions"><button class="btn-stop">Arrêter Holo</button></div>`;
    replayEl.querySelector('.btn-stop').onclick = () => fetch('/api/replay/stop', { method: 'POST' });
    try {
      const r = await fetch('/api/replay', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                             body: JSON.stringify({ workflow: wfNow }) });
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      followReplay(replayEl, () => { replayBtn.disabled = false; improveBtn.disabled = false; });
    } catch (e) {
      replayEl.querySelector('.rstatus').textContent = `Erreur : ${e.message}`;
      replayBtn.disabled = false;
      improveBtn.disabled = false;
    }
  };
  return card;
}

function followReplay(el, done) {
  let next = 0;
  const t0 = Date.now();
  const status = el.querySelector('.rstatus');
  const ol = el.querySelector('ol');
  const meta = el.querySelector('.meta');
  let screens = 0, restarts = 0;
  const timer = setInterval(async () => {
    try {
      const r = await fetch(`/api/replay/events?since=${next}`);
      const { events, next: n, running } = await r.json();
      next = n;
      for (const e of events) {
        if (e.type === 'start') status.textContent = `En cours sur ${e.mode} · ${e.steps.length} étape(s)…`;
        else if (e.type === 'session' && e.url) meta.innerHTML = `<a href="${e.url}" target="_blank">Voir la session chez H</a>`;
        else if (e.type === 'screen') screens++;
        else if (e.type === 'step_start') {
          const li = document.createElement('li');
          li.className = 'running';
          li.dataset.index = e.index;
          li.innerHTML = `<b>⏳</b> ${iconsHtml(e.step, 2)}${escapeHtml(e.step.slice(0, 160))}${e.step.length > 160 ? '…' : ''}`;
          ol.appendChild(li);
        } else if (e.type === 'step_end') {
          const li = [...ol.querySelectorAll('li')].reverse().find((x) => x.dataset.index == e.index);
          if (li) {
            li.className = e.ok ? 'ok' : 'ko';
            li.querySelector('b').textContent = `${e.ok ? '✅' : '❌'} ${e.seconds} s`;
            const ans = document.createElement('span');
            ans.className = 'answer';
            ans.textContent = `Holo : ${(e.answer || '(pas de réponse)').slice(0, 600)}`;
            li.appendChild(ans);
          }
        } else if (e.type === 'stalled') status.textContent = `⚠️ Holo ne répond plus sur l'étape ${e.index}…`;
        else if (e.type === 'restart') { restarts = e.count; status.textContent = `↻ Reprise n°${e.count} de l'étape ${e.index}`; }
        else if (e.type === 'end') {
          const tok = Object.entries(e.usage || {}).map(([m, u]) => `${m} : ${u.input_tokens} tokens entrée / ${u.output_tokens} sortie`).join(' · ');
          status.textContent = `${e.ok ? '✅ Terminé' : `■ ${e.status}`} en ${Math.floor(e.seconds / 60)} min ${e.seconds % 60} s` +
            (e.restarts ? ` · ${e.restarts} reprise(s)` : '') + (e.blocked?.length ? ` · 🛑 ${e.blocked.length} action(s) refusée(s)` : '');
          meta.innerHTML = (meta.innerHTML ? meta.innerHTML + ' · ' : '') + `${screens} changement(s) d'écran · ${escapeHtml(tok)}` +
            `<br>Holo dit avoir réussi : vérifie le résultat à l'écran.`;
        }
      }
      if (!running && Date.now() - t0 > 3000) {
        clearInterval(timer);
        el.querySelector('.btn-stop')?.remove();
        done();
      }
    } catch { /* serveur occupé : on réessaie */ }
  }, 1000);
}

// --- ⚡ Créer l'automatisation n8n + écran de suivi (plan → import → test nœud par nœud) ------------------------
const BLOCK_ICON = { holo: '🤖 Holo', row: '🧮 Code', verify: '✅ Vérification', sheets_append: '📊 Google Sheets', http: '🌐 API' };

async function createN8n(wf, verdict, el) {
  const ok = confirm(`Twiin va créer l'automatisation n8n de « ${wf.name} », l'importer dans ton n8n local et la TESTER une fois.\n\n` +
    `Si elle contient des blocs Holo, Holo prendra la souris et le clavier de ton Mac pendant le test : ne touche à rien ` +
    `(double Échap pour l'arrêter). L'automatisation restera INACTIVE : c'est toi qui l'actives dans n8n.\n\nContinuer ?`);
  if (!ok) return;
  el.hidden = false;
  el.innerHTML = `<div class="n8n"><h4>${iconsHtml('n8n', 1)}Automatisation n8n</h4><div class="nstatus">Génération du plan…</div>
    <ol class="nplan"></ol><div class="nholo"></div><div class="nlinks"></div></div>`;
  const st = el.querySelector('.nstatus'), plan = el.querySelector('.nplan'), holo = el.querySelector('.nholo'), links = el.querySelector('.nlinks');
  try {
    const r = await fetch('/api/n8n/create', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                               body: JSON.stringify({ workflow: wf, verdict }) });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    st.textContent = `Plan prêt : ${d.plan.blocks.length} blocs. Compilation et import dans n8n…`;
  } catch (e) {
    st.textContent = `Erreur : ${e.message}`;
    return;
  }
  let next = 0;
  const rows = new Map();
  const timer = setInterval(async () => {
    try {
      const r = await fetch(`/api/n8n/events?since=${next}`);
      const { events, next: n, running, holo: hs, holoRunning } = await r.json();
      next = n;
      for (const e of events) {
        if (e.type === 'plan') {
          plan.innerHTML = '';
          for (const b of e.plan.blocks) {
            const li = document.createElement('li');
            const logo = { holo: 'Holo', sheets_append: 'Google Sheets' }[b.type] || `${b.name} ${b.url || ''}`;
            li.innerHTML = `<span class="ico">⏳</span> ${iconsHtml(logo, 1)}<b>${escapeHtml(b.name)}</b> <span class="kind">${BLOCK_ICON[b.type] || b.type}</span><span class="out"></span>`;
            plan.appendChild(li);
            rows.set(b.name, li);
          }
        } else if (e.type === 'imported') {
          st.textContent = 'Importé dans n8n. Test en cours…';
          links.innerHTML = `<a href="${e.url}" target="_blank">Ouvrir le workflow dans n8n</a>`;
        } else if (e.type === 'executing') {
          links.innerHTML += ` · <a href="${e.url}" target="_blank">Voir l'exécution n° ${e.execution} dans n8n</a>`;
        } else if (e.type === 'node') {
          const li = rows.get(e.name);
          if (li) {
            li.querySelector('.ico').textContent = e.status === 'success' ? '✅' : '❌';
            const sec = e.ms != null ? `${Math.round(e.ms / 100) / 10} s` : '';
            let out = e.error ? `Erreur : ${e.error}` : '';
            if (!out && e.output) {
              try {
                const o = JSON.parse(e.output);
                out = o['Vérification'] ? `Vérification : ${o['Vérification']}` : o.data ? `Lu : ${JSON.stringify(o.data)}` : '';
              } catch { out = ''; }
            }
            li.querySelector('.out').textContent = ` ${sec}${out ? ' · ' + out : ''}`;
          }
        } else if (e.type === 'done') {
          if (e.ok) setStep(6);
          st.textContent = e.ok ? '✅ Automatisation créée et testée avec succès. Elle est INACTIVE : active-la dans n8n quand tu veux.'
                                : `❌ Le test a échoué (${e.status}). Ouvre l'exécution dans n8n pour voir le nœud en erreur.`;
        }
      }
      const last = (hs || []).at(-1);
      holo.textContent = holoRunning && last ? `🤖 Holo travaille sur ton Mac : ${(last.step || last.answer || '').slice(0, 160)}…` : '';
      if (!running && next > 0 && /terminé|succès|échoué|Erreur/.test(st.textContent)) clearInterval(timer);
    } catch { /* on réessaie */ }
  }, 1500);
}

// --- Accueil : un exemple déjà rempli (filet de sécurité pour la démo) + reprise de la dernière tâche ---------------
// Enregistrement réel du 17/11 (veille L'Oréal, LinkedIn → Excel → OneNote), copié de workflows/candidates.json.
const EXAMPLE_WORKFLOW = {
  "name": "Veille concurrence L'Oréal",
  "general_intent": "Collecter les informations de la page LinkedIn de L'Oréal et les consigner dans le classeur Excel « veille_entreprises » et dans OneNote « Veille concurrence »",
  "summary": "L'utilisateur a recherché L'Oréal sur LinkedIn, copié-collé le nom, le secteur, la taille et le nombre d'abonnés dans le classeur Excel « veille_entreprises », puis a noté des informations dans OneNote sous la page « Veille concurrence » après consultation des articles de la page Posts.",
  "why_daily": "Cette veille concurrentielle répétée (recherche LinkedIn → saisie Excel → notes OneNote) est une tâche manuelle quotidienne qui peut être automatisée.",
  "steps": [
    "Dans Google Chrome, cliquer sur la barre de recherche LinkedIn et taper « l'oreal » pour trouver la page entreprise L'Oréal",
    "Cliquer sur l'onglet « À propos » de la page L'Oréal sur LinkedIn",
    "Sélectionner le texte « Fabrication de parfums et de produits pour la toilette » (champ Secteur) et le copier (⌘C)",
    "Dans Microsoft Excel (classeur « veille_entreprises »), double-cliquer sur la cellule B2 et coller (⌘V) le secteur",
    "Sur la page LinkedIn L'Oréal, sélectionner le titre « L'Oréal » et le copier (⌘C)",
    "Dans Excel, double-cliquer sur la cellule A2 et coller (⌘V) le nom « L'Oréal »",
    "Sur la page LinkedIn L'Oréal (À propos), sélectionner « 10 001 employés et plus » (champ Taille de l'entreprise) et le copier (⌘C)",
    "Dans Excel, double-cliquer sur la cellule D2 et coller (⌘V) la taille",
    "Sur la page LinkedIn L'Oréal (Présentation), sélectionner « 7 M d'abonnés » et le copier (⌘C)",
    "Dans Excel, double-cliquer sur la cellule E2 et coller (⌘V) le nombre d'abonnés",
    "Dans Excel, double-cliquer sur la cellule F2 et taper une date (7 caractères)",
    "Basculer vers Microsoft OneNote, ouvrir la page « Veille concurrence » (section Groupe, mardi 17 novembre 2026)",
    "Copier (⌘C) le texte du descriptif de L'Oréal sur la page LinkedIn et le coller (⌘V) dans la page OneNote « Veille concurrence »",
    "Sur LinkedIn, cliquer sur l'onglet « Posts » de la page L'Oréal, puis cliquer sur le filtre « Articles »",
    "Basculer vers OneNote et taper 43 caractères de notes dans la page « Veille concurrence »"
  ]
};
let lastWorkflows = null;
function showExample() {
  const ex = EXAMPLE_WORKFLOW;
  document.getElementById('exName').textContent = ex.name;
  document.getElementById('exMeta').innerHTML = `<span class="apps-strip">${appsStrip(ex.steps)}</span><span>${ex.steps.length} étapes</span>`;
  document.getElementById('exSteps').innerHTML = ex.steps.slice(0, 4).map((s) => `<li>${iconsHtml(s, 2)}${escapeHtml(s)}</li>`).join('') +
    `<li style="list-style:none;margin-left:-22px">… et ${ex.steps.length - 4} autres étapes</li>`;
  document.getElementById('example').hidden = false;
}
document.getElementById('exOpenBtn').addEventListener('click', () => {
  renderWorkflows([EXAMPLE_WORKFLOW], { example: true });
  statusEl.textContent = 'Exemple ouvert : tu peux suivre les étapes 2 à 5 comme pour une vraie tâche.';
});
document.getElementById('lastBtn').addEventListener('click', () => {
  if (!lastWorkflows) return;
  renderWorkflows(lastWorkflows);
  statusEl.textContent = 'Dernière tâche analysée : reprends à l\'étape 2.';
});
iconsReady.then(() => {
  showExample();
  // http://localhost:3000/#exemple ouvre directement l'exemple (pratique en démo si l'enregistrement en direct coince)
  if (location.hash === '#exemple') document.getElementById('exOpenBtn').click();
});
// Le dernier résultat n'est proposé qu'une fois la compréhension confirmée par l'employé.
Promise.all([fetch('/api/candidates').then((r) => r.json()), fetch('/api/discovery').then((r) => r.json()).catch(() => ({ phase: 'idle' }))])
  .then(([d, disc]) => {
    const pending = ['upload', 'twin', 'dev_test', 'awaiting_confirmation'].includes(disc.phase);
    if (pending) statusEl.textContent = 'Twiin étudie ta tâche… une question va bientôt apparaître.';
    if (d.workflows?.length && !pending) { lastWorkflows = d.workflows; document.getElementById('lastBtn').hidden = false; }
  }).catch(() => {});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
