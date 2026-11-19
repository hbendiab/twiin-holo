// Bandeau commun à toutes les pages Twiin : ce qui tourne (temps restant, Arrêter) ou le prochain lancement programmé.
// L'employé sait toujours si Twiin utilise son Mac, pour combien de temps, et peut tout arrêter d'un clic.
(() => {
  const css = document.createElement('style');
  css.textContent = `
    .tw-banner { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(16px + env(safe-area-inset-bottom, 0px)); z-index: 1000;
      display: flex; align-items: center; gap: 12px; max-width: calc(100vw - 32px); padding: 10px 12px 10px 16px; border-radius: 16px;
      background: var(--panel, #fff); color: var(--text, #1b1f27); border: 1px solid var(--panel-border, #e2e5eb);
      box-shadow: 0 8px 28px rgba(20, 30, 50, .18); font: 13.5px var(--font, -apple-system, sans-serif); }
    .tw-banner[hidden] { display: none !important; }
    .tw-banner.mac { border-color: var(--warn, #8a5a00); }
    .tw-banner .tw-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--accent, #0b57d0); flex: none; animation: twPulse 1.2s ease-in-out infinite; }
    .tw-banner.mac .tw-dot { background: var(--warn, #8a5a00); }
    .tw-banner.plan .tw-dot { animation: none; background: var(--text-dim, #5f6673); }
    .tw-banner .tw-txt { min-width: 0; }
    .tw-banner .tw-txt b { font-weight: 600; }
    .tw-banner .tw-sub { display: block; font-size: 12px; color: var(--text-dim, #5f6673); }
    .tw-banner .tw-bar { height: 4px; border-radius: 99px; background: var(--panel-2, #f3f5f8); margin-top: 6px; overflow: hidden; width: 220px; max-width: 100%; }
    .tw-banner .tw-bar span { display: block; height: 100%; background: var(--accent, #0b57d0); width: 0; transition: width 1s linear; }
    .tw-banner.mac .tw-bar span { background: var(--warn, #8a5a00); }
    .tw-banner button, .tw-banner a.tw-btn { font: 600 13px var(--font, sans-serif); padding: 8px 14px; border-radius: 999px; cursor: pointer; white-space: nowrap;
      border: 1px solid var(--bad, #c5221f); background: transparent; color: var(--bad, #c5221f); text-decoration: none; }
    .tw-banner a.tw-btn { border-color: var(--panel-border, #e2e5eb); color: var(--text, #1b1f27); font-weight: 500; }
    @keyframes twPulse { 50% { opacity: .35; } }
    @media (prefers-reduced-motion: reduce) { .tw-banner .tw-dot { animation: none; } }`;
  document.head.appendChild(css);

  const el = document.createElement('div');
  el.className = 'tw-banner';
  el.hidden = true;
  el.setAttribute('role', 'status');
  const place = () => document.body.appendChild(el);
  if (document.body) place(); else document.addEventListener('DOMContentLoaded', place);

  const esc = (x) => { const d = document.createElement('div'); d.textContent = x ?? ''; return d.innerHTML; };
  const dur = (s) => (s >= 60 ? `${Math.ceil(s / 60)} min` : `${Math.max(0, Math.round(s))} s`);
  const quand = (iso) => {
    const d = new Date(iso), now = new Date();
    const h = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', ' h ');
    const demain = new Date(now); demain.setDate(now.getDate() + 1);
    return d.toDateString() === now.toDateString() ? `aujourd'hui à ${h}` : d.toDateString() === demain.toDateString() ? `demain à ${h}`
      : `${d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric' })} à ${h}`;
  };

  let stopping = false;
  async function tick() {
    let e;
    try { e = await (await fetch('/api/automations/etat')).json(); } catch { return; }
    if (e.error) return;
    if (e.running) {
      const reste = e.estimate_s ? e.estimate_s - (e.elapsed_s || 0) : null;
      const pct = e.estimate_s ? Math.min(100, Math.round((100 * (e.elapsed_s || 0)) / e.estimate_s)) : null;
      el.className = `tw-banner${e.sur_mac ? ' mac' : ''}`;
      el.innerHTML = `<span class="tw-dot"></span><span class="tw-txt">
          <b>${e.sur_mac ? 'Twiin utilise ton ordinateur' : 'Twiin travaille en arrière-plan'}</b> · ${esc(e.name)}
          <span class="tw-sub">${e.sur_mac ? 'Ne touche ni la souris ni le clavier. ' : 'Tu peux continuer à travailler. '}${reste != null
            ? (reste > 0 ? `Encore environ ${dur(reste)}.` : 'Presque fini…') : ''}</span>
          ${pct != null ? `<span class="tw-bar"><span style="width:${pct}%"></span></span>` : ''}</span>
        <button type="button" class="tw-stop">${stopping ? 'Arrêt…' : 'Arrêter'}</button>`;
      el.querySelector('.tw-stop').onclick = async () => {
        stopping = true; tick();
        await fetch('/api/automations/stop', { method: 'POST' }).catch(() => {});
        setTimeout(() => { stopping = false; tick(); }, 2500);
      };
      el.hidden = false;
    } else if (e.prochain) {
      el.className = 'tw-banner plan';
      el.innerHTML = `<span class="tw-dot"></span><span class="tw-txt"><b>Programmé ${esc(quand(e.prochain.at))}</b> · ${esc(e.prochain.name)}
          <span class="tw-sub">Twiin utilisera ton ordinateur à ce moment-là. Tu seras prévenu 2 min avant.</span></span>
        ${location.pathname.endsWith('automatisations.html') ? '' : `<a class="tw-btn" href="/automatisations.html#${encodeURIComponent(e.prochain.id)}">Voir</a>`}`;
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  }
  tick();
  setInterval(tick, 3000);
})();
