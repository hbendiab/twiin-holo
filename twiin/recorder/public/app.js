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

startBtn.addEventListener('click', startRecording);
addBtn.addEventListener('click', () => addScreen().catch((e) => (statusEl.textContent = `Écran non ajouté : ${e.message}`)));
stopBtn.addEventListener('click', stopRecording);
reBtn.addEventListener('click', () => analyzeRequest('/api/reanalyze', null, 'Relance de l\'analyse du dernier enregistrement…'));

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
      li.innerHTML = `<span>${t}</span> ${escapeHtml(text)}`;
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

  if (!frames.length) {
    statusEl.textContent = 'Aucune image gardée.';
    return;
  }

  statusEl.textContent = `Arrêté. ${frames.length} image(s) gardée(s) sur ${nScreens} écran(s). Lecture du texte (OCR local) puis analyse par le modèle…`;

  if (sessionId) {
    statusEl.textContent = `Arrêté. Envoi des dernières images… puis analyse.`;
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
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderWorkflows(data.workflows || []);
    const m = data._meta || {};
    statusEl.textContent = `Terminé. ${data.workflows?.length ?? 0} workflow(s) trouvé(s).` +
      (m.model ? ` Modèle ${m.model} · ${m.screens ?? nScreens ?? '?'} écran(s) · ` +
        (m.text_only ? 'texte OCR seul' : `${m.images_sent} image(s) envoyée(s)`) + ` · ${m.ocr_lines} lignes OCR · ` +
        `${m.usage?.prompt_tokens ?? '?'} tokens en entrée, ${m.usage?.completion_tokens ?? '?'} en sortie` +
        (m.cost_usd != null ? ` · ≈ ${m.cost_usd.toFixed(4)} $` : '') : '');
  } catch (err) {
    statusEl.textContent = `Erreur : ${err.message}`;
  } finally {
    reBtn.disabled = false;
  }
}

// --- Workflow modifiable → « ✨ Améliorer » → « ▶ Rejouer sur mon Mac » (suivi en direct) ---------------------
function renderWorkflows(workflows) {
  resultsEl.innerHTML = '';
  workflows.forEach((wf) => resultsEl.appendChild(workflowCard(wf)));
}

function workflowCard(wf) {
  const card = document.createElement('div');
  card.className = 'workflow';
  let original = { name: wf.name, summary: wf.summary, steps: [...(wf.steps || [])] };
  card.innerHTML = `
    <input class="wf-name" value="${escapeHtml(wf.name || 'Workflow')}" title="Nom du workflow (modifiable)">
    <p class="wf-summary">${escapeHtml(wf.summary || '')}</p>
    ${wf.why_daily ? `<p><strong>Pourquoi l'automatiser :</strong> ${escapeHtml(wf.why_daily)}</p>` : ''}
    <ol class="steps"></ol>
    <button class="icon-btn add-step">+ Ajouter une étape</button>
    <div class="wf-actions">
      <button class="btn-advice">💡 Améliorer mon process</button>
      <button class="btn-verdict">🧭 Accélérer ou automatiser ?</button>
      <button class="btn-improve" title="Rend les étapes plus précises pour Holo, sans changer la tâche">⚙️ Préparer pour Holo</button>
      <button class="btn-ghost btn-original" hidden>↺ Revenir à l'original</button>
      <button class="btn-replay">▶ Rejouer sur mon Mac</button>
    </div>
    <div class="advice" hidden></div>
    <div class="verdict" hidden></div>
    <div class="changes" hidden></div>
    <div class="replay" hidden></div>`;
  const stepsEl = card.querySelector('.steps');
  const setSteps = (steps) => {
    stepsEl.innerHTML = '';
    steps.forEach((st) => addStep(st));
  };
  const addStep = (text = '') => {
    const li = document.createElement('li');
    const ta = document.createElement('textarea');
    ta.value = text;
    const mark = () => ta.classList.toggle('todo', /à compléter/i.test(ta.value));
    ta.addEventListener('input', mark);
    setTimeout(mark);
    ta.rows = Math.min(6, Math.max(2, Math.ceil(text.length / 95)));
    const del = document.createElement('button');
    del.className = 'icon-btn';
    del.textContent = '×';
    del.title = 'Supprimer cette étape';
    del.onclick = () => li.remove();
    li.append(ta, del);
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
    improveBtn.textContent = '⚙️ Préparation en cours…';
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
      improveBtn.textContent = '⚙️ Préparer pour Holo';
    }
  };
  // 💡 Améliorer mon process : bilan chiffré + recommandations pour l'employé (les étapes ne sont pas modifiées)
  const adviceBtn = card.querySelector('.btn-advice');
  const adviceEl = card.querySelector('.advice');
  adviceBtn.onclick = async () => {
    adviceBtn.disabled = true;
    adviceBtn.textContent = '💡 Analyse de ton process…';
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
      const apps = st ? Object.entries(st.time_per_app_s).map(([a, v]) => `${escapeHtml(a)} ${fmt(v)}`).join(' · ') : '';
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
    } catch (e) {
      adviceEl.innerHTML = `<h4>Analyse impossible</h4><p>${escapeHtml(e.message)}</p>`;
      adviceEl.hidden = false;
    } finally {
      adviceBtn.disabled = false;
      adviceBtn.textContent = '💡 Améliorer mon process';
    }
  };

  // 🧭 Verdict : Twiin recommande « accélérer » (tuto vidéo) ou « automatiser » (n8n + Holo) ; l'employé valide
  const verdictBtn = card.querySelector('.btn-verdict');
  const verdictEl = card.querySelector('.verdict');
  verdictBtn.onclick = async () => {
    verdictBtn.disabled = true;
    verdictBtn.textContent = '🧭 Analyse…';
    try {
      const r = await fetch('/api/verdict', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                              body: JSON.stringify({ workflow: current() }) });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      const auto = /automat/i.test(d.verdict || '');
      const tools = (d.tools || []).map((t) => `<span class="chip ${t.api ? 'api' : 'noapi'}">${escapeHtml(t.name)} · ${t.api ? 'API → n8n' : 'sans API → Holo'}</span>`).join('');
      const plan = (d.plan || []).map((p) => `<li><b>${escapeHtml(p.tool || '')}</b> <span class="how">${escapeHtml(p.how || '')}</span> — ${escapeHtml(p.what || '')}</li>`).join('');
      verdictEl.innerHTML = `
        <h4>🧭 Recommandation de Twiin : <span class="v ${auto ? 'auto' : 'acc'}">${auto ? '⚡ automatiser' : '🎬 accélérer'}</span>
          <small>confiance ${escapeHtml(d.confidence || '?')}${d.cost_usd != null ? ` · ≈ ${d.cost_usd.toFixed(4)} $` : ''}</small></h4>
        <ul class="reasons">${(d.reasons || []).map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>
        <p class="hint">Fréquence : ${escapeHtml(d.frequency_hint || '?')} · Gain : ${escapeHtml(d.time_saved || '?')}</p>
        <div class="chips">${tools}</div>
        ${plan ? `<ol class="plan">${plan}</ol>` : ''}
        <p class="hint">C'est toi qui valides : choisis la voie.</p>
        <div class="wf-actions">
          <button class="btn-tuto ${auto ? 'btn-ghost' : 'btn-replay'}">🎬 Créer le tuto vidéo${auto ? '' : ' (recommandé)'}</button>
          <button class="btn-n8n ${auto ? 'btn-replay' : 'btn-ghost'}">⚡ Créer l'automatisation n8n${auto ? ' (recommandé)' : ''}</button>
        </div>
        <div class="branch" hidden></div>`;
      verdictEl.hidden = false;
      const branch = verdictEl.querySelector('.branch');
      verdictEl.querySelector('.btn-tuto').onclick = () => { branch.hidden = false; branch.textContent = '🎬 Tuto vidéo : en cours de construction (étape suivante).'; };
      verdictEl.querySelector('.btn-n8n').onclick = () => createN8n(current(), d, branch);
    } catch (e) {
      verdictEl.innerHTML = `<h4>Analyse impossible</h4><p>${escapeHtml(e.message)}</p>`;
      verdictEl.hidden = false;
    } finally {
      verdictBtn.disabled = false;
      verdictBtn.textContent = '🧭 Accélérer ou automatiser ?';
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
      `• Pour l'arrêter : double Échap, ou le bouton « Arrêter » de cette page.\n\nLancer le rejeu ?`);
    if (!ok) return;
    replayBtn.disabled = true;
    improveBtn.disabled = true;
    replayEl.hidden = false;
    replayEl.innerHTML = `<h4>Rejeu par Holo</h4><div class="rstatus">Démarrage…</div><ol></ol><div class="meta"></div>` +
      `<div class="wf-actions"><button class="btn-stop">■ Arrêter le rejeu</button></div>`;
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
          li.innerHTML = `<b>⏳</b> ${escapeHtml(e.step.slice(0, 160))}${e.step.length > 160 ? '…' : ''}`;
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
  el.innerHTML = `<div class="n8n"><h4>⚡ Automatisation n8n</h4><div class="nstatus">Génération du plan…</div>
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
            li.innerHTML = `<span class="ico">⏳</span> <b>${escapeHtml(b.name)}</b> <span class="kind">${BLOCK_ICON[b.type] || b.type}</span><span class="out"></span>`;
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

// Au chargement : afficher le dernier workflow analysé (pour l'améliorer ou le rejouer sans réenregistrer)
fetch('/api/candidates').then((r) => r.json()).then((d) => {
  if (d.workflows?.length && !resultsEl.children.length) {
    renderWorkflows(d.workflows);
    if (!statusEl.textContent) statusEl.textContent = 'Dernier workflow analysé (tu peux l\'améliorer ou le rejouer) :';
  }
}).catch(() => {});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
