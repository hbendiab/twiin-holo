// Twiin · app Mac : pastille pendant l'enregistrement, bouton masquer. Le reste est le panneau de l'extension (panel.js).
(() => {
  const D = window.twiinDesktop;
  const clock = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const C = Capture.state;
  document.getElementById('hideWin').onclick = () => D?.hide();
  document.getElementById('pillStop').onclick = () => Capture.stop();
  document.getElementById('pillOpen').onclick = () => D?.setCompact(false);
  D?.onCompact((on) => document.body.classList.toggle('compact', on));
  setInterval(() => {
    if (!C.recording) return;
    document.getElementById('pillTime').textContent = clock((Date.now() - C.startedAt) / 1000);
    document.getElementById('pillInfo').textContent = `${C.frames} image${C.frames > 1 ? 's' : ''}`;
  }, 1000);
})();
