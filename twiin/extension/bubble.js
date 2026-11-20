// Twiin · bulle sur toutes les pages (hors pages Twiin). Montre ce que fait Twiin et donne les gestes utiles sans
// quitter la page : enregistrer, lancer une automatisation liée à ce site, tout arrêter.
// Vie privée : l'adresse de la page n'est jamais envoyée ; seul le nom du site sert, ici même, à trier les automatisations.
(() => {
  if (window.top !== window || window.__twiinBubble) return; // une seule bulle, pas dans les cadres
  window.__twiinBubble = true;
  const ask = (m) => chrome.runtime.sendMessage(m).catch(() => ({ offline: true }));
  const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const site = location.hostname.replace(/^www\./, '');

  // Outils reconnus par site → mots cherchés dans les blocs des automatisations
  const SITE_TOOLS = [
    [/linkedin\.com$/, ['linkedin']], [/docs\.google\.com$/, ['sheets', 'google docs', 'google']], [/mail\.google\.com$/, ['gmail']],
    [/(office|live|microsoft|sharepoint)\.com$/, ['onenote', 'excel', 'word', 'outlook', 'teams']], [/notion\.(so|site)$/, ['notion']],
    [/hubspot\.com$/, ['hubspot']], [/salesforce\.com$/, ['salesforce']], [/pennylane\.com$/, ['pennylane']], [/slack\.com$/, ['slack']],
  ];
  const keywords = (SITE_TOOLS.find(([re]) => re.test(site))?.[1] || []).concat(site.split('.').slice(-2, -1));

  const host = document.createElement('div');
  host.id = 'twiin-bubble';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, "Segoe UI", sans-serif; letter-spacing: -.006em; }
    .wrap { position: fixed; right: 20px; bottom: 20px; z-index: 2147483645; display: flex; flex-direction: column; align-items: flex-end; gap: 10px; color: #161615; }
    .tw2 { display: inline-flex; gap: 2px; }
    .tw2 img { width: 17px; height: 17px; display: block; }
    .fab { width: 50px; height: 50px; border-radius: 14px; border: 1px solid #dce2f0; background: linear-gradient(135deg, #fff, #f3f5fb 55%, #e6ebf5); cursor: pointer;
      backdrop-filter: blur(14px); box-shadow: inset 0 1px 0 #fff, 3px 4px 0 -1px rgba(201,210,231,.8), 0 14px 28px -16px rgba(56,66,110,.5); display: grid; place-items: center; padding: 0; transition: transform .15s; }
    .fab:hover { transform: translateY(-2px); }
    .fab .tw2 img { width: 19px; height: 19px; }
    .pill { display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 14px; border-radius: 12px; background: linear-gradient(135deg, #fff, #f3f5fb); font-size: 13px; max-width: min(420px, calc(100vw - 40px));
      border: 1px solid #dce2f0; box-shadow: 0 14px 30px -14px rgba(56,66,110,.45); }
    .pill .dot { width: 9px; height: 9px; border-radius: 50%; background: #56669c; flex: none; animation: p 1.2s ease-in-out infinite; }
    .pill.mac .dot { background: #e05a5a; }
    .pill.plan .dot { background: #6b7180; animation: none; }
    .pill .t { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pill b { font-weight: 700; }
    button.b { font: 600 13px inherit; font-family: inherit; border-radius: 10px; padding: 8px 14px; cursor: pointer; border: 1px solid transparent; background: #e6ebf5; color: #181520; white-space: nowrap; }
    button.b.dark { background: #56669c; color: #fff; border-color: #56669c; }
    button.b.red { color: #e05a5a; border-color: rgba(224,90,90,.35); }
    .menu { width: 300px; max-width: calc(100vw - 40px); background: linear-gradient(135deg, rgba(255,255,255,.98), rgba(243,245,251,.96)); backdrop-filter: blur(18px); border-radius: 12px; padding: 12px;
      border: 1px solid #dce2f0; box-shadow: inset 0 1px 0 #fff, 3px 4px 0 -1px rgba(201,210,231,.8), 0 24px 50px -22px rgba(56,66,110,.5); font-size: 13.5px; }
    .menu h4 { margin: 4px 6px 8px; font: 500 10.5px ui-monospace, "SF Mono", Menlo, monospace; color: #6f6f6a; text-transform: uppercase; letter-spacing: .07em; }
    .item { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; border: 0; background: transparent; padding: 10px; border-radius: 8px; cursor: pointer; color: #161615; font: 500 13.5px inherit; font-family: inherit; }
    .item:hover { background: #e6ebf5; }
    .item .ic { width: 30px; height: 30px; border-radius: 8px; background: #fff; display: grid; place-items: center; flex: none; border: 1px solid #dce2f0; }
    .item.main .ic { background: #56669c; color: #fff; border-color: #56669c; }
    .item svg { width: 15px; height: 15px; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .auto { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px; background: #fff; border: 1px solid #dce2f0; margin: 0 0 6px; }
    .auto span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .auto small { display: block; color: #6b7180; font-size: 11.5px; }
    .muted { color: #6b7180; font-size: 12.5px; margin: 2px 6px 8px; line-height: 1.45; }
    .sep { height: 1px; background: rgba(22,24,29,.07); margin: 8px 4px; }
    .foot { display: flex; justify-content: space-between; gap: 6px; margin-top: 4px; }
    .foot button { border: 0; background: transparent; color: #6b7180; font: 500 12px inherit; font-family: inherit; cursor: pointer; padding: 6px; }
    .foot button:hover { color: #16181d; }
    @keyframes p { 50% { opacity: .35; } }
    @media (prefers-reduced-motion: reduce) { .pill .dot { animation: none; } }
  </style><div class="wrap"></div>`;
  const wrap = root.querySelector('.wrap');
  // Iris et Ilo : les mêmes images que dans le SaaS (rendu chrome liquide)
  const LOGO = `<span class="tw2" aria-hidden="true"><img src="${chrome.runtime.getURL('img/iris.png')}" alt=""><img src="${chrome.runtime.getURL('img/ilo.png')}" alt=""></span>`;
  const I = {
    rec: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3" fill="currentColor"/>',
    auto: '<path d="M7 7h10v10H7z"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
    video: '<rect x="3" y="6" width="13" height="12" rx="3"/><path d="M16 10l5-3v10l-5-3"/>',
    open: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v6H4V6h6"/>',
  };
  const ic = (k) => `<span class="ic"><svg viewBox="0 0 24 24">${I[k]}</svg></span>`;

  let open = false, state = null, autos = null, msg = '';
  const dur = (s) => (s >= 60 ? `${Math.ceil(s / 60)} min` : `${Math.max(0, Math.round(s))} s`);

  function render() {
    const e = state?.etat || {};
    const prefs = state?.prefs || {};
    const hidden = prefs.bubble === false || (prefs.hidden || []).includes(site);
    // Pendant un enregistrement : pas de bulle, pour ne pas apparaître dans les images de la tâche
    if (!state || state.etat?.offline || state.rec?.on || (hidden && !e.running)) { host.remove(); return; }
    if (!host.isConnected) document.documentElement.appendChild(host);

    let html = '';
    if (e.running) {
      const reste = e.estimate_s ? e.estimate_s - (e.elapsed_s || 0) : null;
      html += `<div class="pill ${e.sur_mac ? 'mac' : ''}" role="status"><span class="dot"></span>
        <span class="t"><b>${e.sur_mac ? 'Twiin utilise ton Mac' : 'Twiin travaille'}</b> · ${esc(e.name)}${reste != null ? ` · ${reste > 0 ? `encore ~${dur(reste)}` : 'presque fini'}` : ''}</span>
        <button class="b red" data-act="stop" type="button">Arrêter</button></div>`;
    } else if (e.prochain && new Date(e.prochain.at) - Date.now() < 15 * 60000) {
      const min = Math.max(0, Math.round((new Date(e.prochain.at) - Date.now()) / 60000));
      html += `<div class="pill plan" role="status"><span class="dot"></span><span class="t"><b>Dans ${min} min</b> · ${esc(e.prochain.name)} va utiliser ton Mac</span>
        <button class="b" data-act="page" data-page="automatisations.html" type="button">Reporter</button></div>`;
    }
    if (open) html += menu();
    html += `<button class="fab" data-act="toggle" type="button" aria-expanded="${open}" aria-label="Twiin">${LOGO}</button>`;
    wrap.innerHTML = html;
  }

  function menu() {
    const mine = (autos || []).filter((a) => {
      const txt = (a.name + ' ' + a.blocks.map((b) => b.name).join(' ')).toLowerCase();
      return keywords.some((k) => k && txt.includes(k));
    });
    const siteBlock = autos == null ? '<p class="muted">Chargement des automatisations…</p>'
      : autos.error ? `<p class="muted">${esc(autos.error)}</p>`
      : mine.length ? mine.slice(0, 3).map((a) => `<div class="auto"><span>${esc(a.name)}<small>${esc(a.freq_label || '')}${a.plan ? ' · programmée' : ''}</small></span>
          <button class="b dark" data-act="run" data-id="${esc(a.id)}" type="button">Lancer</button></div>`).join('')
      : `<p class="muted">Aucune automatisation pour ${esc(site)}. Fais ta tâche ici une fois en l'enregistrant : Twiin te dira si elle s'automatise.</p>`;
    return `<div class="menu" role="menu">
      <button class="item main" data-act="record" type="button">${ic('rec')}<span>Enregistrer une tâche<br><small style="color:#6b7180">⌥ ⇧ R</small></span></button>
      <div class="sep"></div><h4>Sur ${esc(site)}</h4>${siteBlock}
      ${msg ? `<p class="muted" role="status">${esc(msg)}</p>` : ''}
      <div class="sep"></div>
      <button class="item" data-act="page" data-page="automatisations.html" type="button">${ic('auto')}Mes automatisations</button>
      <button class="item" data-act="page" data-page="videos.html" type="button">${ic('video')}Mes tutos vidéo</button>
      <button class="item" data-act="twiin" type="button">${ic('open')}Ouvrir Twiin</button>
      <div class="foot"><button data-act="hide" type="button">Masquer sur ce site</button><button data-act="toggle" type="button">Fermer</button></div>
    </div>`;
  }

  root.addEventListener('click', async (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    if (act === 'toggle') {
      open = !open; msg = '';
      if (open) { autos = null; ask({ type: 'api', path: '/api/automations' }).then((r) => { autos = r.automations || { error: r.error || 'n8n est arrêté : ouvre Mes automatisations pour le démarrer.' }; render(); }); }
    }
    if (act === 'record') { open = false; ask({ type: 'record:start' }); }
    if (act === 'page') ask({ type: 'open', page: el.dataset.page });
    if (act === 'twiin') ask({ type: 'open' });
    if (act === 'stop') { el.textContent = 'Arrêt…'; await ask({ type: 'stop' }); }
    if (act === 'run') {
      el.textContent = '…';
      const r = await ask({ type: 'run', id: el.dataset.id });
      msg = r.error || 'C\'est parti. Suis-la ici ou dans Mes automatisations.';
    }
    if (act === 'hide') {
      const { hidden = [] } = await chrome.storage.local.get('hidden');
      await chrome.storage.local.set({ hidden: [...new Set([...hidden, site])] });
      open = false;
    }
    await refresh();
  });
  // Échap ferme le menu
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) { open = false; render(); } });

  async function refresh() {
    if (document.visibilityState !== 'visible') return;
    state = await ask({ type: 'state' });
    render();
  }
  refresh();
  setInterval(refresh, 4000);
  document.addEventListener('visibilitychange', refresh);
  chrome.storage.onChanged.addListener(refresh);
})();
