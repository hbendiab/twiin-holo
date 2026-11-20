// Espace perso dans l'équipe : chacun choisit son espace (JC, Noah…) dans la barre de navigation. Le choix est gardé sur
// ce navigateur et envoyé au serveur avec chaque requête (en-tête x-twiin-membre) : vidéos créées, partages, « Bonjour JC ».
(() => {
  if (window.TwiinEspace) return;
  const lire = () => { try { return localStorage.getItem('twiin-membre') || ''; } catch { return ''; } };
  let moi = lire(), equipe = null;
  // toutes les requêtes vers Twiin portent le membre choisi
  const f0 = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    try {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.origin === location.origin && moi) {
        const h = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined));
        h.set('x-twiin-membre', moi);
        init = { ...init, headers: h };
      }
    } catch { /* URL illisible : requête telle quelle */ }
    return f0(input, init);
  };
  const initiale = (p) => (p || '?').trim()[0]?.toUpperCase() || '?';
  const membre = () => equipe?.membres.find((m) => m.id === moi) || null;

  const CSS = `
.tw-espace { position: relative; margin: -8px 4px 14px; }
.tw-espace > button { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; border-radius: 12px;
  background: rgba(255,255,255,.55); border: 1px solid var(--brand-rule, #dce2f0); font-size: 14px; font-weight: 600; color: var(--brand-ink, #181520); }
.tw-espace > button:hover { background: rgba(255,255,255,.85); }
.tw-espace > button:focus-visible { outline: 2px solid var(--brand-strong); outline-offset: 2px; }
.tw-espace .av { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; flex: none; font-size: 12.5px; font-weight: 700;
  background: var(--brand-strong, #56669c); color: #fff; }
.tw-espace .txt { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tw-espace .txt small { display: block; font: 500 10.5px var(--mono, ui-monospace, monospace); text-transform: uppercase; letter-spacing: .05em; opacity: .55; }
.tw-espace .chev { opacity: .5; font-size: 12px; }
.tw-espace .pop { position: absolute; left: 0; right: 0; top: calc(100% + 6px); z-index: 50; padding: 6px; border-radius: 14px; background: var(--canvas, #fff);
  border: 1px solid var(--brand-rule, #dce2f0); box-shadow: 0 24px 40px -24px rgba(40,46,80,.5); display: grid; gap: 2px; max-height: 60vh; overflow: auto; }
.tw-espace .pop[hidden] { display: none; }
.tw-espace .pop button, .tw-espace .pop a { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 10px; font-size: 14px; color: var(--ink, #161615); }
.tw-espace .pop button:hover, .tw-espace .pop a:hover, .tw-espace .pop [aria-current="true"] { background: var(--brand-chip, #e6ebf5); }
.tw-espace .pop .sep { height: 1px; background: var(--brand-rule, #dce2f0); margin: 4px 6px; }
.tw-espace .pop .av { width: 22px; height: 22px; font-size: 11px; }
:root.side-collapsed .tw-espace .txt, :root.side-collapsed .tw-espace .chev { display: none; }
:root.side-collapsed .tw-espace > button { justify-content: center; padding: 6px; }`;

  function dessiner() {
    const side = document.querySelector('.tw-side');
    if (!side || !equipe) return;
    side.querySelector('.tw-espace')?.remove();
    const m = membre();
    const box = document.createElement('div');
    box.className = 'tw-espace';
    box.innerHTML = `<button type="button" aria-haspopup="true" aria-expanded="false"><span class="av">${m ? initiale(m.prenom) : '+'}</span>
        <span class="txt"><small>${escapeH(equipe.nom)}</small>${m ? `Espace de ${escapeH(m.prenom)}` : 'Choisir mon espace'}</span><span class="chev" aria-hidden="true">▾</span></button>
      <div class="pop" hidden role="menu">${equipe.membres.map((x) => `<button type="button" role="menuitem" data-m="${escapeH(x.id)}" aria-current="${x.id === moi}"><span class="av">${initiale(x.prenom)}</span>${escapeH(x.prenom)}</button>`).join('')}
        <span class="sep"></span><a href="/videos.html#equipe" role="menuitem">Vidéos de l'équipe</a><a href="/mise-en-service.html#equipe" role="menuitem">Gérer l'équipe</a></div>`;
    side.querySelector('.tw-brand')?.after(box);
    const btn = box.querySelector('button'), pop = box.querySelector('.pop');
    btn.onclick = (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; btn.setAttribute('aria-expanded', String(!pop.hidden)); };
    document.addEventListener('click', () => { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); });
    pop.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => choisir(b.dataset.m));
  }
  const escapeH = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function choisir(id) {
    moi = id;
    try { localStorage.setItem('twiin-membre', id); } catch { /* rien */ }
    location.reload(); // chaque page se recharge dans l'espace choisi
  }
  async function charger() {
    try { equipe = await (await f0('/api/equipe')).json(); } catch { return; }
    if (moi && !equipe.membres.some((m) => m.id === moi)) moi = '';
    dessiner();
    document.dispatchEvent(new CustomEvent('twiin-espace', { detail: membre() }));
  }
  const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
  window.TwiinEspace = { get moi() { return moi; }, get membre() { return membre(); }, get equipe() { return equipe; }, choisir, recharger: charger };
  const go = () => (document.querySelector('.tw-side') ? charger() : setTimeout(go, 50));
  go();
})();
