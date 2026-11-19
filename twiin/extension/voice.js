// Twiin · capture vocale pour l'app Mac (et, plus tard, l'extension). Module à part : capture.js l'appelle seulement s'il est chargé.
// Le micro est enregistré en même temps que l'écran, envoyé au serveur Twiin du Mac (POST /api/audio), transcrit là par Whisper
// local à l'analyse : la voix ne quitte pas le Mac. Désactivée par défaut ; ne bloque jamais l'enregistrement ni l'analyse.
const Voice = (() => {
  const KEY = 'twiin.voice';
  let v = null, ui = null;

  const store = { get() { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } }, set(x) { try { localStorage.setItem(KEY, x ? '1' : '0'); } catch { /* rien */ } } };
  const S = { on: store.get(), ready: false, reason: '', warning: '', recording: false };
  async function cfg() { // adresse + jeton du serveur Twiin (même source que le reste de l'app)
    try { const c = await chrome.runtime.sendMessage({ type: 'recorder:config' }); if (c?.base) return c; } catch { /* repli */ }
    return { base: globalThis.location?.origin || 'http://localhost:3000', token: null };
  }
  const auth = (c) => (c.token ? { Authorization: `Bearer ${c.token}` } : {});

  function paint() {
    if (!ui) return;
    ui.input.checked = S.on && S.ready;
    ui.input.disabled = !S.ready || S.recording;
    const text = S.warning || (!S.ready && S.reason ? `Voix indisponible : ${S.reason}.` : S.on && S.ready ? 'Ta voix est transcrite sur ton Mac : elle n\'en sort pas.' : '');
    ui.note.textContent = text; ui.note.hidden = !text;
  }
  async function refresh() { // la voix locale est-elle prête ? (installée, modèle présent)
    try {
      const c = await cfg();
      const r = await fetch(`${c.base}/api/audio/status`, { headers: auth(c) });
      const st = await r.json();
      S.ready = !!st.ready; S.reason = st.ready ? '' : (st.reason || (r.ok ? 'non disponible sur cet ordinateur' : 'état de la voix inconnu (connecte-toi à Twiin)'));
    } catch { if (!S.ready) S.reason = 'Twiin ne répond pas'; }
    paint();
  }
  function mount(slot) {
    if (!slot || ui) return;
    slot.innerHTML = '<label class="vswitch"><input type="checkbox" id="voiceSwitch"><span class="vtrack"></span><span>Capture vocale</span></label><span class="vnote" id="voiceNote" hidden></span>';
    ui = { input: slot.querySelector('input'), note: slot.querySelector('.vnote') };
    S.on = store.get();
    ui.input.addEventListener('change', () => { S.on = ui.input.checked; store.set(S.on); S.warning = ''; paint(); });
    refresh();
    setInterval(() => { if (!S.recording && !S.ready) refresh(); }, 5000); // l'installation automatique peut finir pendant que la fenêtre est ouverte
    paint();
  }

  // Avant l'enregistrement : autorisation + micro. Renvoie le flux, ou null (avec un avertissement) : l'enregistrement continue sans voix.
  async function open() {
    S.warning = '';
    if (!S.on) return null;
    if (!S.ready) { await refresh(); if (!S.ready) { S.warning = `Voix indisponible : ${S.reason || 'non prête'} : enregistrement sans la voix.`; paint(); return null; } }
    try {
      if (globalThis.twiinDesktop?.askMic && !(await twiinDesktop.askMic())) throw new Error('micro refusé dans les Réglages macOS');
      return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      S.warning = `Micro non disponible (${e.name || e.message}) : enregistrement sans la voix.`; paint(); return null;
    }
  }
  function start(stream) {
    if (!stream) return;
    try {
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const x = { rec, stream, chunks: [], startedAt: 0, stopped: null };
      rec.addEventListener('dataavailable', (e) => { if (e.data.size) x.chunks.push(e.data); });
      rec.addEventListener('start', () => { x.startedAt = Date.now(); }); // heure réelle du 1er échantillon, même horloge que les images
      x.stopped = new Promise((res) => rec.addEventListener('stop', res));
      rec.start(1000);
      v = x; S.recording = true; paint();
    } catch (e) { stream.getTracks().forEach((t) => t.stop()); S.warning = `Micro non disponible (${e.name || e.message}) : enregistrement sans la voix.`; paint(); }
  }
  function release() { S.recording = false; paint(); }
  // Fin : arrête le micro et envoie l'audio. Ne bloque jamais l'analyse ; renvoie true si l'audio est parti.
  async function stop(session) {
    const x = v; v = null;
    if (!x) { release(); return false; }
    try {
      if (x.rec.state !== 'inactive') x.rec.stop();
      await x.stopped;
      x.stream.getTracks().forEach((t) => t.stop());
      if (!session || !x.chunks.length || !x.startedAt) { S.warning = 'La voix n\'a pas pu être enregistrée (enregistrement trop court ?) : analyse sans elle.'; return false; }
      const blob = new Blob(x.chunks, { type: x.rec.mimeType || 'audio/webm' });
      const c = await cfg();
      const r = await fetch(`${c.base}/api/audio?session=${encodeURIComponent(session)}&startedAt=${x.startedAt}`, { method: 'POST', headers: { 'Content-Type': blob.type, ...auth(c) }, body: blob });
      if (!r.ok) S.warning = 'La voix n\'a pas pu être envoyée : analyse sans elle.';
      return r.ok;
    } catch { S.warning = 'La voix n\'a pas pu être envoyée : analyse sans elle.'; return false; }
    finally { release(); }
  }
  async function cancel() { // annulation : micro coupé, rien n'est envoyé
    const x = v; v = null;
    if (x) { try { if (x.rec.state !== 'inactive') x.rec.stop(); } catch { /* rien */ } x.stream.getTracks().forEach((t) => t.stop()); }
    release();
  }
  function report(m) { // ce que le serveur dit de la transcription (après l'analyse)
    if (m?.status === 'failed') S.warning = `La voix n'a pas pu être transcrite (${m.reason || 'erreur de transcription'}) : l'analyse s'est faite sans elle.`;
    else if (m?.status === 'empty') S.warning = 'Aucune parole détectée dans l\'enregistrement : l\'analyse s\'est faite sans la voix.';
    paint();
  }
  return { state: S, mount, open, start, stop, cancel, report, refresh };
})();
if (typeof document !== 'undefined') Voice.mount(document.getElementById('voiceSlot'));
if (typeof module !== 'undefined') module.exports = Voice;
