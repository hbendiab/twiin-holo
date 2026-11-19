// Coque commune : la sidebar de gauche (seule navigation de Twiin), repliable en bulles, avec le thème et le compte.
// Les liens mènent à de vraies pages Twiin : rien de décoratif sans fonction.
(() => {
  const I = {
    audit: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/>',
    rec: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3" fill="currentColor"/>',
    reco: '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.6 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>',
    video: '<rect x="3" y="6" width="13" height="12" rx="3"/><path d="M16 10l5-3v10l-5-3"/>',
    auto: '<path d="M7 7h10v10H7z"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    chevron: '<path d="M15 6l-6 6 6 6"/>',
  };
  const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${I[k]}</svg>`;
  const path = location.pathname;
  const onIndex = path === '/' || path.endsWith('/index.html');
  const hash = () => ({ '': '#audit', '#exemple': '#enregistrer', '#tester': '#reco' }[location.hash] ?? location.hash);
  const here = (href) => (href.startsWith('/#') ? onIndex && hash() === href.slice(1) : path.endsWith(href));
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const LOGO = still ? '/logo-twiin.png' : '/logo-twiin.webp'; // image animée : les deux sphères tournent, comme un GIF

  const GROUPES = [
    ['Analyser une tâche', [['/#audit', 'audit', 'Audit'], ['/#enregistrer', 'rec', 'Enregistrer'], ['/#reco', 'reco', 'Recommandation']]],
    ['Mes résultats', [['/enregistrements.html', 'rec', 'Mes enregistrements'], ['/videos.html', 'video', 'Mes vidéos'], ['/automatisations.html', 'auto', 'Mes automatisations']]],
  ];

  // Repliée ou dépliée : mémorisé sur ce navigateur ; appliqué tout de suite, sans animation au chargement
  const root = document.documentElement;
  let collapsed = false;
  try { collapsed = localStorage.getItem('twiin-side') === 'collapsed'; } catch { /* rien */ }
  root.classList.toggle('side-collapsed', collapsed);
  root.classList.add('side-noanim');

  // Ancien emplacement du logo (en-tête des pages) : gardé pour la page de connexion
  function logo() {
    const box = document.getElementById('logoCells');
    if (box) box.innerHTML = `<img class="tw-logo" src="${LOGO}" alt="">`;
  }

  function build() {
    logo();
    if (document.body.classList.contains('no-rail')) return;
    let i = 0;
    const item = ([href, ico, label]) => `<a class="tw-item" href="${href}" style="--i:${i++}" ${here(href) ? 'aria-current="page"' : ''} data-label="${label}">
        <span class="tw-round">${svg(ico)}${ico === 'auto' ? '<span class="tw-red" hidden></span>' : ''}</span><span class="tw-lbl">${label}</span></a>`;
    const side = document.createElement('aside');
    side.className = 'tw-side';
    side.setAttribute('aria-label', 'Navigation Twiin');
    side.innerHTML = `
      <a class="tw-brand" href="/#audit" aria-label="Twiin, accueil"><img class="tw-logo" src="${LOGO}" alt=""><span class="tw-lbl tw-word">Twiin</span></a>
      <nav class="tw-nav">${GROUPES.map(([titre, liens]) => `<span class="tw-group"><span>${titre}</span></span>${liens.map(item).join('')}`).join('')}</nav>
      <div class="tw-foot">
        <button type="button" class="tw-item" data-act="theme" style="--i:${i++}" data-label="Thème"><span class="tw-round">${svg('moon')}</span><span class="tw-lbl">Thème sombre</span></button>
        <button type="button" class="tw-item tw-user" data-act="user" style="--i:${i++}" data-label="Compte"><span class="tw-round tw-avatar">T</span><span class="tw-lbl">Mon compte</span></button>
        <button type="button" class="tw-item tw-collapse" data-act="collapse" style="--i:${i++}" data-label="Déplier"
          aria-expanded="${!collapsed}"><span class="tw-round">${svg('chevron')}</span><span class="tw-lbl">Réduire</span></button>
      </div>`;
    document.body.prepend(side);
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('side-noanim')));

    // Thème
    const themeBtn = side.querySelector('[data-act="theme"]');
    const paintTheme = () => {
      const dark = root.dataset.theme === 'dark';
      themeBtn.querySelector('.tw-round').innerHTML = svg(dark ? 'sun' : 'moon');
      themeBtn.querySelector('.tw-lbl').textContent = dark ? 'Thème clair' : 'Thème sombre';
    };
    themeBtn.onclick = () => {
      const legacy = document.getElementById('themeBtn'); // la page principale garde son propre bouton (caché)
      if (legacy) legacy.click();
      else {
        root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem('twiin-theme', root.dataset.theme); } catch { /* rien */ }
      }
      paintTheme();
    };
    paintTheme();

    // Replier / déplier, avec un petit rebond des bulles
    const toggle = side.querySelector('[data-act="collapse"]');
    toggle.onclick = () => {
      collapsed = !collapsed;
      root.classList.toggle('side-collapsed', collapsed);
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.querySelector('.tw-lbl').textContent = collapsed ? 'Déplier' : 'Réduire';
      side.classList.remove('bounce'); void side.offsetWidth; side.classList.add('bounce');
      try { localStorage.setItem('twiin-side', collapsed ? 'collapsed' : 'open'); } catch { /* rien */ }
    };
    toggle.querySelector('.tw-lbl').textContent = collapsed ? 'Déplier' : 'Réduire';

    addEventListener('hashchange', () => side.querySelectorAll('a.tw-item').forEach((a) => a.toggleAttribute('aria-current', here(a.getAttribute('href')))));

    // Point rouge sur « Mes automatisations » : une automatisation tourne ou est programmée
    const dot = side.querySelector('.tw-red');
    const check = () => fetch('/api/automations/etat').then((r) => r.json()).then((e) => { dot.hidden = !(e.running || e.prochain); }).catch(() => {});
    check(); setInterval(check, 15000);

    // Compte : initiale et e-mail de l'employé connecté (Supabase) ; clic = se déconnecter
    const user = side.querySelector('[data-act="user"]');
    Promise.resolve(window.twiinAuth).then(async (c) => {
      if (!c) { user.hidden = true; return; }
      const { data } = await c.auth.getSession();
      const mail = data.session?.user?.email;
      if (!mail) { user.hidden = true; return; }
      user.querySelector('.tw-avatar').textContent = mail[0].toUpperCase();
      user.querySelector('.tw-lbl').innerHTML = `<span class="tw-mail">${mail.replace(/[<>&]/g, '')}</span><small>Se déconnecter</small>`;
      user.dataset.label = mail;
      user.onclick = () => c.auth.signOut().then(() => location.replace('/login.html'));
    }).catch(() => { user.hidden = true; });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
