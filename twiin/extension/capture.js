// Twiin · capture d'écran dans le panneau latéral. Même logique que la page Twiin (public/app.js) : chaque écran partagé
// est observé chaque seconde, une image n'est gardée que si l'écran a changé puis s'est stabilisé, elle part aussitôt
// au serveur Twiin du Mac ; le journal des clics tourne sur le Mac ; au Stop, l'analyse est lancée.
// Rien n'est envoyé ailleurs que vers le serveur Twiin du Mac.
const Capture = (() => {
  const MIN_GAP_MS = 1500, SETTLE_MAX_MS = 3000, HEARTBEAT_MS = 60000;
  const CHANGE_THRESHOLD = 3, STABLE_THRESHOLD = 1.5, MODEL_MAX_DIMENSION = 1024, OCR_MAX_DIMENSION = 1600;
  const S = { recording: false, analyzing: false, phase: null, startedAt: 0, frames: 0, screens: [], thumbs: [], error: null, result: null };
  let base = 'http://localhost:3000', token = null, onUpdate = () => {};
  let shared = [], nextScreen = 1, sessionId = null, journalNext = 0, uploads = [], uploadErrors = 0, busy = false, stopping = false;

  const hdr = (json = true) => ({ ...(json ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) });
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: hdr(), body: JSON.stringify(body || {}) });
  const emit = () => onUpdate(S);

  // Écran choisi : depuis un clic (sélecteur standard de Chrome) ou sans clic (sélecteur de l'extension)
  async function ask({ fromClick }) {
    // Clic dans le panneau, ou app Mac (Electron choisit l'écran entier sans sélecteur) : capture standard
    if (fromClick || !globalThis.chrome?.desktopCapture) return navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    const id = await new Promise((res, rej) => {
      try { chrome.desktopCapture.chooseDesktopMedia(['screen', 'window'], (x) => res(x || null)); } catch (e) { rej(e); }
    });
    if (!id) throw new Error('Choix de l\'écran annulé.');
    return navigator.mediaDevices.getUserMedia({ audio: false,
      video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: id, maxWidth: 3840, maxHeight: 2160 } } });
  }
  function addStream(stream) {
    const track = stream.getVideoTracks()[0];
    const scr = { n: nextScreen++, label: track.label || 'écran', stream, cap: new ImageCapture(track), keptThumb: null, prevThumb: null, keptAt: 0, changeSince: 0 };
    S.screens.push(scr);
    shared.push({ n: scr.n, label: scr.label });
    track.addEventListener('ended', () => { // partage arrêté depuis la barre de Chrome
      S.screens = S.screens.filter((s) => s !== scr);
      if (S.recording && !S.screens.length) stop(); else emit();
    });
    emit();
  }

  async function start(opts) {
    if (S.recording) return addScreen(opts);
    const stream = await ask(opts); // avant tout le reste : le clic de l'employé n'est valable qu'un instant
    const mic = await globalThis.Voice?.open(); // voix : seulement si voice.js est chargé et l'interrupteur activé
    Object.assign(S, { recording: true, analyzing: false, phase: null, startedAt: Date.now(), frames: 0, screens: [], thumbs: [], error: null, result: null });
    shared = []; nextScreen = 1; uploads = []; uploadErrors = 0; journalNext = 0;
    addStream(stream);
    try { sessionId = (await (await post('/api/actions/start', { startedAt: S.startedAt })).json()).session || null; } catch { sessionId = null; }
    if (!sessionId) { S.error = 'Twiin ne répond pas sur ce Mac : enregistrement impossible.'; await stop({ cancel: true }); }
    if (sessionId) globalThis.Voice?.start(mic); else mic?.getTracks().forEach((t) => t.stop()); // micro seulement si l'enregistrement a démarré
    emit();
  }
  async function addScreen(opts) { addStream(await ask(opts)); }

  // Cadence : un worker, pour ne pas être ralenti si le panneau passe en arrière-plan
  new Worker('ticker.js').onmessage = async () => {
    if (!S.recording || busy || stopping) return;
    busy = true;
    try { const now = Date.now(); await Promise.all(S.screens.map((s) => observe(s, now))); await pollJournal(); } finally { busy = false; }
  };
  async function pollJournal() {
    try {
      const { events, next } = await (await fetch(`${base}/api/actions?since=${journalNext}`, { headers: hdr(false) })).json();
      journalNext = next;
      for (const e of events) forceCaptureAfter(e);
    } catch { /* serveur occupé : on réessaie */ }
  }
  function forceCaptureAfter(e) { // une saisie ou un clic change parfois peu de pixels : image forcée juste après
    if (!S.recording || !['typing', 'shortcut', 'click', 'key'].includes(e.type)) return;
    const sh = shared.find((x) => new RegExp(`^screen:${e.display}:`).test(x.label));
    for (const scr of sh ? S.screens.filter((s) => s.n === sh.n) : S.screens) {
      clearTimeout(scr.forceTimer);
      scr.forceTimer = setTimeout(async () => {
        if (!S.recording || Date.now() - scr.keptAt < 700) return;
        const bmp = await grab(scr); if (bmp) keep(scr, bmp, thumbnail(bmp), Date.now());
      }, e.type === 'click' ? 700 : 400);
    }
  }

  const grab = (scr) => scr.cap.grabFrame().catch(() => null);
  function snapshot(bmp, maxDim, quality) {
    const c = document.createElement('canvas');
    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality);
  }
  function thumbnail(bmp) {
    const c = document.createElement('canvas'); c.width = 64; c.height = 40;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, 64, 40);
    const px = ctx.getImageData(0, 0, 64, 40).data, g = new Float32Array(64 * 40);
    for (let i = 0; i < g.length; i++) g[i] = 0.299 * px[4 * i] + 0.587 * px[4 * i + 1] + 0.114 * px[4 * i + 2];
    return g;
  }
  const diff = (a, b) => { if (!a || !b) return 255; let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
  async function observe(scr, now) {
    const bmp = await grab(scr);
    if (!bmp) return;
    const t = thumbnail(bmp);
    const changed = diff(t, scr.keptThumb) > CHANGE_THRESHOLD, stable = diff(t, scr.prevThumb) < STABLE_THRESHOLD;
    scr.prevThumb = t;
    if (changed && !scr.changeSince) scr.changeSince = now;
    const settled = changed && (stable || now - scr.changeSince > SETTLE_MAX_MS);
    if ((scr.keptThumb === null || settled || now - scr.keptAt > HEARTBEAT_MS) && now - scr.keptAt >= MIN_GAP_MS) keep(scr, bmp, t, now);
    else bmp.close();
  }
  function keep(scr, bmp, thumb, now) {
    scr.keptThumb = thumb; scr.keptAt = now; scr.changeSince = 0;
    const frame = { index: S.frames++, timestamp: new Date(now).toISOString(), seconds: Math.round((now - S.startedAt) / 1000),
      screen: scr.n, screen_label: scr.label, dataUrl: snapshot(bmp, MODEL_MAX_DIMENSION, 0.7), ocrUrl: snapshot(bmp, OCR_MAX_DIMENSION, 0.85) };
    S.thumbs = [...S.thumbs, snapshot(bmp, 200, 0.6)].slice(-6); // aperçu dans le panneau
    bmp.close();
    if (sessionId) uploads.push(post('/api/frames', { session: sessionId, frame }).then((r) => { if (!r.ok) uploadErrors++; }).catch(() => { uploadErrors++; }));
    emit();
  }

  async function stop({ cancel = false } = {}) {
    if (!S.recording || stopping) return;
    stopping = true;
    if (!cancel) { S.analyzing = true; S.phase = 'upload'; } // l'écran d'analyse s'affiche tout de suite
    S.recording = false;
    emit();
    if (!cancel) await pollJournal();
    await post('/api/actions/stop').catch(() => {});
    if (!cancel) {
      await new Promise((r) => setTimeout(r, 600));
      for (const s of S.screens) { const bmp = await grab(s); if (bmp) keep(s, bmp, thumbnail(bmp), Date.now()); } // état final
    }
    for (const s of S.screens) s.stream.getTracks().forEach((t) => t.stop());
    S.screens = [];
    stopping = false;
    const voiceSent = cancel ? globalThis.Voice?.cancel() : globalThis.Voice?.stop(sessionId); // l'audio part pendant l'envoi des images
    if (cancel) { S.analyzing = false; return emit(); }
    if (!S.frames) { Object.assign(S, { analyzing: false, error: 'Aucune image gardée.' }); return emit(); }

    await Promise.allSettled([...uploads, voiceSent]);
    const poll = setInterval(async () => {
      try { const p = await (await fetch(`${base}/api/analysis/progress`, { headers: hdr(false) })).json(); if (p.phase !== 'idle') { S.phase = p.phase; emit(); } } catch { /* rien */ }
    }, 1000);
    try {
      const data = await (await post('/api/generate-workflows', { session: sessionId, startedAt: S.startedAt, screens: shared })).json();
      if (data.error) throw new Error(data.error);
      S.result = { workflows: data.workflows || [], uploadErrors };
      globalThis.Voice?.report(data._meta?.voice);
    } catch (e) {
      S.error = `L'analyse n'a pas abouti : ${e.message}`;
    } finally {
      clearInterval(poll);
      S.analyzing = false; S.phase = null;
      emit();
    }
  }

  return {
    state: S,
    config(o) { if (o.base) base = o.base; if ('token' in o) token = o.token; if (o.onUpdate) onUpdate = o.onUpdate; },
    start, addScreen, stop, cancel: () => stop({ cancel: true }),
    clear() { S.error = null; S.result = null; emit(); },
  };
})();
