// Iris et Ilo, compagnons de route : deux petites sphères chromées posées en bas à droite, sur toutes les pages.
// Discrets par principe : ils clignent des yeux et suivent la souris du regard ; ils ne parlent qu'une fois par page
// et par session (une bulle qui s'efface seule), puis seulement quand on clique sur eux.
// À la fin de la page d'ouverture, les deux grandes sphères « volent » jusqu'ici : ce sont les mêmes personnages.
// Les pages peuvent les faire parler : window.TwiinCompagnons.dire('Ton analyse est prête.')
(() => {
  if (window.TwiinCompagnons) return;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const DIRE = {
    '#audit': 'On a regardé ta semaine. Voilà ce qu\'on ferait à ta place.',
    '#enregistrer': 'Fais ta tâche comme d\'habitude. On regarde, on retient.',
    '#reco': 'Voilà ce qu\'on peut prendre en charge pour toi.',
    '/enregistrements.html': 'Tout ce que tu nous as montré. Rien ne quitte ton Mac sans toi.',
    '/videos.html': 'Tes tâches, en tutos prêts à partager.',
    '/automatisations.html': 'Ce qu\'on fait déjà à ta place. Tu peux tout arrêter d\'un clic.',
    '/telecommande.html': 'Ton Mac, dans ta poche. Dis-nous quoi faire, on s\'en occupe.',
  };
  const cle = () => {
    const p = location.pathname;
    if (p === '/' || p.endsWith('/index.html')) return { '': '#audit', '#exemple': '#enregistrer', '#tester': '#reco' }[location.hash] ?? location.hash;
    return Object.keys(DIRE).find((k) => k.startsWith('/') && p.endsWith(k)) || p;
  };

  const CSS = `
.twc { position: fixed; right: max(20px, env(safe-area-inset-right, 0px)); bottom: calc(18px + env(safe-area-inset-bottom, 0px)); z-index: 900;
  display: flex; flex-direction: column; align-items: flex-end; gap: 10px; pointer-events: none; }
.twc > * { pointer-events: auto; }
.twc.attend .twc-duo { visibility: hidden; }
.twc.vol { z-index: 1001; }
.twc-duo { all: unset; cursor: pointer; display: flex; gap: 3px; padding: 6px; border-radius: 999px; -webkit-tap-highlight-color: transparent;
  transition: transform .4s cubic-bezier(.16,1,.3,1); }
.twc-duo:hover { transform: translateY(-2px); }
.twc-duo:focus-visible { outline: 2px solid var(--glass, #009dff); outline-offset: 2px; }
.twc-t { position: relative; display: block; width: 30px; height: 30px; }
.twc-t .tw-orb { --s: 30px; box-shadow: inset 0 -2px 4px rgba(0,0,0,.45), inset 0 1px 1px rgba(255,255,255,.7), 0 6px 14px -6px rgba(0,0,0,.45); }
.twc-eyes { position: absolute; inset: 0; pointer-events: none; }
.twc-eyes::before, .twc-eyes::after { content: ""; position: absolute; top: 36%; width: 14%; height: 24%; border-radius: 50%; background: #0b0b0b;
  transform: translate(var(--ex, 0px), var(--ey, 0px)) scaleY(var(--o, 1)); transition: transform .12s ease-out; }
.twc-eyes::before { left: 29%; } .twc-eyes::after { right: 29%; }
.twc-t.cligne .twc-eyes { --o: .1; }
.twc.parle .twc-t { animation: twcBob .34s ease-in-out infinite alternate; }
.twc.parle .twc-t.ilo { animation-delay: -.17s; }
.twc-t.arrive { animation: twcPop .6s cubic-bezier(.34,1.56,.64,1) both; }
.twc-t.ilo.arrive { animation-delay: .08s; }
.twc-bulle { position: relative; max-width: min(300px, calc(100vw - 40px)); padding: 10px 34px 10px 14px; border-radius: 14px 14px 4px 14px;
  background: var(--canvas, #fff); color: var(--ink, #161615); border: 1px solid var(--brand-rule, #dce2f0); box-shadow: 0 14px 34px -18px rgba(86,102,156,.45);
  font: 14px/1.45 var(--font, -apple-system, system-ui, sans-serif); opacity: 0; transform: translateY(6px) scale(.98); transform-origin: 100% 100%;
  transition: opacity .35s cubic-bezier(.16,1,.3,1), transform .35s cubic-bezier(.16,1,.3,1); }
.twc-bulle.on { opacity: 1; transform: none; }
.twc-bulle p { margin: 0; }
.twc-bulle p span { opacity: 0; transition: opacity .25s; }
.twc-bulle p span.on { opacity: 1; }
.twc-bulle .twc-x { all: unset; position: absolute; top: 6px; right: 6px; width: 22px; height: 22px; display: grid; place-items: center; border-radius: 6px;
  color: var(--muted, #8a8a85); cursor: pointer; font-size: 15px; line-height: 1; }
.twc-bulle .twc-x:hover { background: var(--chip, #efefeb); color: var(--ink, #161615); }
.twc button.twc-duo, .twc button.twc-x { background: transparent !important; border: 0 !important; box-shadow: none !important; scale: 1 !important; }
.twc button.twc-duo { padding: 6px !important; border-radius: 999px !important; }
.twc button.twc-x:hover { background: var(--chip, #efefeb) !important; }
@media (min-width: 901px) { body { padding-bottom: 84px !important; } } /* le bas de page ne passe jamais sous Iris et Ilo */
@keyframes twcBob { from { transform: translateY(0); } to { transform: translateY(-3px); } }
@keyframes twcPop { from { transform: scale(0); } }
@media (max-width: 900px) { .twc { right: 12px; bottom: calc(80px + env(safe-area-inset-bottom, 0px)); } }
@media print { .twc { display: none; } }
@media (prefers-reduced-motion: reduce) {
  .twc.parle .twc-t, .twc-t.arrive { animation: none; }
  .twc-bulle, .twc-bulle p span { transition: none; }
  .twc-bulle p span { opacity: 1; }
}`;

  function monter() {
    const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
    const el = document.createElement('div');
    el.className = 'twc';
    el.innerHTML = `<div class="twc-bulle" role="status" aria-live="polite" hidden><p></p><button type="button" class="twc-x" aria-label="Fermer la bulle">×</button></div>
      <button type="button" class="twc-duo" aria-label="Iris et Ilo : afficher le conseil de cette page" aria-expanded="false">
        <span class="twc-t iris" aria-hidden="true"><i class="tw-orb iris"></i><i class="twc-eyes"></i></span>
        <span class="twc-t ilo" aria-hidden="true"><i class="tw-orb ilo"></i><i class="twc-eyes"></i></span></button>`;
    document.body.append(el);
    const bulle = el.querySelector('.twc-bulle'), p = bulle.querySelector('p'), duo = el.querySelector('.twc-duo');
    const twins = [...el.querySelectorAll('.twc-t')];

    // Bulle : les mots apparaissent un à un, puis elle s'efface seule
    let fin = 0, tours = [];
    const taire = () => {
      tours.forEach(clearTimeout); tours = []; clearTimeout(fin);
      el.classList.remove('parle'); bulle.classList.remove('on'); duo.setAttribute('aria-expanded', 'false');
      fin = setTimeout(() => { bulle.hidden = true; }, 350);
    };
    const dire = (texte, { duree } = {}) => {
      if (!texte) return;
      tours.forEach(clearTimeout); tours = []; clearTimeout(fin);
      const mots = texte.split(' ');
      p.innerHTML = mots.map((m) => `<span>${m.replace(/[<>&]/g, '')}</span>`).join(' ');
      bulle.hidden = false; duo.setAttribute('aria-expanded', 'true');
      requestAnimationFrame(() => bulle.classList.add('on'));
      const spans = [...p.children];
      if (still) spans.forEach((s) => s.classList.add('on'));
      else { el.classList.add('parle'); spans.forEach((s, i) => tours.push(setTimeout(() => s.classList.add('on'), 120 + i * 110))); }
      tours.push(setTimeout(() => el.classList.remove('parle'), 120 + mots.length * 110));
      fin = setTimeout(taire, duree || Math.max(5000, 2600 + mots.length * 320));
    };

    // Une fois par page et par session, ils disent à quoi sert la page
    const vus = () => { try { return JSON.parse(sessionStorage.getItem('twiin-compagnons') || '[]'); } catch { return []; } };
    const presenter = (auto) => {
      const k = cle(), texte = DIRE[k];
      if (!texte) return taire();
      if (auto) {
        const v = vus(); if (v.includes(k)) return taire();
        try { sessionStorage.setItem('twiin-compagnons', JSON.stringify([...v, k])); } catch { /* rien */ }
      }
      dire(texte);
    };
    duo.addEventListener('click', () => (bulle.classList.contains('on') ? taire() : presenter(false)));
    bulle.querySelector('.twc-x').addEventListener('click', taire);
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && bulle.classList.contains('on')) taire(); });
    addEventListener('hashchange', () => { taire(); setTimeout(() => presenter(true), 500); });

    // Ils suivent la souris du regard et clignent des yeux de temps en temps
    if (!still) {
      let raf = 0, px = 0, py = 0;
      addEventListener('pointermove', (e) => {
        px = e.clientX; py = e.clientY;
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          const r = duo.getBoundingClientRect(), dx = px - (r.left + r.width / 2), dy = py - (r.top + r.height / 2), n = Math.hypot(dx, dy) || 1;
          el.style.setProperty('--ex', `${(dx / n) * 1.6}px`); el.style.setProperty('--ey', `${(dy / n) * 1.4}px`);
        });
      }, { passive: true });
      const cligner = () => {
        twins.forEach((t, i) => setTimeout(() => { t.classList.add('cligne'); setTimeout(() => t.classList.remove('cligne'), 130); }, i * 70));
        setTimeout(cligner, 2600 + Math.random() * 4200);
      };
      setTimeout(cligner, 1800);
    }

    // Arrivée : soit en vol depuis la page d'ouverture, soit un petit « pop » sur place
    const arriver = () => { twins.forEach((t) => t.classList.add('arrive')); setTimeout(() => presenter(true), 900); };
    if (window.twiinAccueil) {
      el.classList.add('attend');
      addEventListener('twiin:bienvenue-fin', (e) => {
        el.classList.remove('attend');
        if (window.twiinVolPris) { twins.forEach((t) => t.classList.add('arrive')); return; } // le narrateur de l'audit les a pris
        const depuis = e.detail;
        if (still || !depuis) return arriver();
        el.classList.add('vol');
        twins.forEach((t, i) => {
          const r = t.getBoundingClientRect(), d = depuis[i];
          const s = (d.r * 2) / r.width;
          t.style.transition = 'none';
          t.style.transform = `translate(${d.x - (r.left + r.width / 2)}px, ${d.y - (r.top + r.height / 2)}px) scale(${s})`;
          t.style.zIndex = '1';
        });
        void el.offsetWidth;
        twins.forEach((t, i) => {
          t.style.transition = `transform 1s cubic-bezier(.65,0,.25,1) ${i * 90}ms`;
          t.style.transform = '';
        });
        setTimeout(() => { el.classList.remove('vol'); twins.forEach((t) => { t.style.transition = ''; t.style.zIndex = ''; }); presenter(true); }, 1250);
      }, { once: true });
    } else setTimeout(arriver, 700);

    window.TwiinCompagnons = { dire, taire };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', monter); else monter();
})();
