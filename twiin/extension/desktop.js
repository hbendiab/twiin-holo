// Twiin · app Mac : pastille pendant l'enregistrement, bouton masquer. Le reste est le panneau de l'extension (panel.js).
(() => {
  const D = window.twiinDesktop;
  const clock = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const C = Capture.state;
  document.getElementById('hideWin').onclick = () => (D?.minimize ? D.minimize() : D?.hide()); // réduire : dans le Dock
  document.getElementById('pillStop').onclick = () => Capture.stop();
  // barre d'enregistrement : pause / reprise, et arrêt sans analyse (avec confirmation)
  document.getElementById('pillPause').onclick = () => Capture.pause();
  document.getElementById('pillCancel').onclick = () => { if (confirm('Arrêter l\'enregistrement sans l\'analyser ? Rien ne sera gardé.')) Capture.cancel(); };
  D?.onCompact((on) => document.body.classList.toggle('compact', on));
  setInterval(() => {
    document.body.classList.toggle('recording', !!C.recording);
    if (!C.recording) return;
    document.getElementById('pillTime').textContent = clock((Date.now() - C.startedAt) / 1000);
    document.getElementById('pillInfo').textContent = C.paused ? 'En pause' : `${C.frames} image${C.frames > 1 ? 's' : ''}`;
    const pb = document.getElementById('pillPause');
    pb.classList.toggle('on', !!C.paused); pb.title = pb.ariaLabel = C.paused ? 'Reprendre' : 'Pause';
    pb.innerHTML = C.paused ? '<svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M9 6v12M15 6v12"/></svg>';
    document.body.classList.toggle('rec-pause', !!C.paused);
  }, 1000);

})();
