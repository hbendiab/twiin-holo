// Deuxième écran : « on fait connaissance ». Le questionnaire d'audit (audit2.js) raconté par Iris et Ilo, à la manière
// d'un narrateur : les jumeaux au-dessus, la question en grand, les mots passent du gris à l'encre au rythme de la voix
// (Iris et Ilo se relaient d'une question à l'autre), puis les réponses apparaissent.
// Actif seulement pendant les questions : sur le résultat, la page redevient normale et les compagnons reprennent leur coin.
(() => {
  if (window.TwiinNarrateur) return;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const QUI = ['iris', 'ilo'];

  const CSS = `
body.twn .twc { opacity: 0; pointer-events: none; }
body.twn [data-view="1"] > h1.page-title, body.twn #toRecordBtn { display: none !important; }
body.twn #a2.panel { background: transparent !important; border: 0 !important; box-shadow: none !important; max-width: 780px; margin: 2vh auto 0 !important; }
body.twn .a2-top { max-width: 420px; margin: 0 auto; }
.twn-narr { display: none; justify-content: center; gap: 6px; margin: 34px 0 6px; }
body.twn .twn-narr { display: flex; }
.twn-narr.attend { visibility: hidden; }
.twn-t { position: relative; width: 64px; height: 64px; transition: transform .5s cubic-bezier(.16,1,.3,1); }
.twn-t .tw-orb { --s: 64px; box-shadow: inset 0 -3px 6px rgba(0,0,0,.45), inset 0 1px 1px rgba(255,255,255,.7), 0 14px 26px -14px rgba(0,0,0,.5); }
.twn-eyes { position: absolute; inset: 0; pointer-events: none; }
.twn-eyes::before, .twn-eyes::after { content: ""; position: absolute; top: 35%; width: 13%; height: 23%; border-radius: 50%; background: #0b0b0b;
  transform: translate(var(--ex, 0px), var(--ey, 0px)) scaleY(var(--o, 1)); transition: transform .12s ease-out; }
.twn-eyes::before { left: 30%; } .twn-eyes::after { right: 30%; }
.twn-t.cligne .twn-eyes { --o: .1; }
.twn-t.parle { animation: twnBob .3s ease-in-out infinite alternate; }
.twn-t:not(.parle) { transform: scale(.94); }
body.twn #a2 h3.a2-q { font-size: clamp(26px, 3.4vw, 36px) !important; font-weight: 500 !important; letter-spacing: -0.035em; line-height: 1.2;
  text-align: center; max-width: 24ch; margin: 18px auto 10px !important; text-wrap: balance; }
body.twn #a2 h3.a2-q span { color: var(--faint, #c6c6c0); transition: color .18s; }
body.twn #a2 h3.a2-q span.dit { color: var(--ink, #161615); }
body.twn #a2 .a2-help { text-align: center; max-width: 52ch; margin: 0 auto 22px; }
body.twn .a2-chips { justify-content: center; }
body.twn .a2-nav { justify-content: center; gap: 12px; }
.twn-plus { transition: opacity .5s cubic-bezier(.16,1,.3,1), transform .5s cubic-bezier(.16,1,.3,1); }
.twn-plus.cache { opacity: 0; transform: translateY(10px); pointer-events: none; }
.twn-vol { position: fixed; z-index: 1001; width: 64px; height: 64px; margin: -32px 0 0 -32px; pointer-events: none; }
.twn-vol .tw-orb { --s: 64px; }
.twn-son { all: unset; position: absolute; right: 0; top: 50%; translate: 0 -50%; display: inline-flex; align-items: center; gap: 6px;
  font: 500 12px var(--mono, ui-monospace, monospace); color: var(--muted, #8a8a85); padding: 6px 10px; border-radius: 999px; cursor: pointer; }
.twn-son svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.twn-son:hover { color: var(--brand-ink, #181520); background: var(--brand-chip, #e6ebf5); }
.twn-son:focus-visible { outline: 2px solid var(--brand-strong, #56669c); }
.twn-narr { position: relative; }
body.twn .a2-voice { display: none !important; } /* le bouton du narrateur remplace la case « Lire les questions » */
/* scan : un flux continu de logos glisse au-dessus d'Iris et Ilo ; celui du centre grossit (un chargement « vivant ») */
body.twn #a2.twn-scanning { display: flex; flex-direction: column; }
#a2.twn-scanning > .a2-top { order: 0; } #a2.twn-scanning > #a2Screen { order: 1; } #a2.twn-scanning > .twn-narr { order: 2; margin-top: 0; }
#a2.twn-scanning > .sphere-box { display: none !important; } #a2.twn-scanning > .a2-nav { order: 3; }
.a2-flux { position: relative; height: 96px; margin: 26px auto 0; max-width: 620px; overflow: hidden; transition: opacity .35s ease;
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 22%, #000 78%, transparent); mask-image: linear-gradient(90deg, transparent, #000 22%, #000 78%, transparent); }
.a2-flux.change { opacity: 0; }
.a2-fl { position: absolute; left: 0; top: 34px; width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; will-change: transform, opacity;
  background: #fff; border: 1px solid var(--brand-rule, #dce2f0); box-shadow: 0 10px 20px -14px rgba(24, 21, 32, .5); }
.a2-fl img { width: 28px; height: 28px; object-fit: contain; }
.a2-seq .a2-row.a2-arrive { animation: twnRow .6s cubic-bezier(.16, 1, .3, 1) both; }
.a2-of { display: block; font: 500 11px var(--mono, ui-monospace, monospace); color: var(--muted, #8a8a85); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 4px; }
@keyframes twnRow { from { opacity: 0; transform: translateY(14px); } }
@keyframes twnBob { from { transform: translateY(0); } to { transform: translateY(-5px); } }
@media (max-width: 640px) { .twn-t, .twn-t .tw-orb { --s: 52px; width: 52px; height: 52px; } }
@media (prefers-reduced-motion: reduce) {
  .twn-t.parle { animation: none; }
  body.twn #a2 h3.a2-q span { color: var(--ink, #161615); transition: none; }
  .twn-plus { transition: none; }
  .a2-seq .a2-row.a2-arrive { animation: none; }
}`;

  let narr = null, ecran = null, texte = '', idx = 0, voixOn = true;
  let minuteurs = [], accueilFini = false;
  // l'ouverture (shell.js) est-elle encore à l'écran ? shell.js se charge après ce fichier : on regarde au moment voulu
  const attenteAccueil = () => !!window.twiinAccueil && !accueilFini;
  const surAudit = () => (location.pathname === '/' || location.pathname.endsWith('/index.html')) && ['', '#audit'].includes(location.hash);
  const actif = () => !!ecran && ecran !== 'resultat' && surAudit();

  function monter() {
    if (narr) return narr;
    const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
    narr = document.createElement('div');
    narr.className = 'twn-narr';
    narr.innerHTML = QUI.map((q) => `<span class="twn-t ${q}" aria-hidden="true"><i class="tw-orb ${q}"></i><i class="twn-eyes"></i></span>`).join('')
      + '<button type="button" class="twn-son" aria-pressed="false"></button>';
    // Couper / remettre la voix pendant le questionnaire (le choix est retenu, via la case existante d'audit2.js)
    const son = narr.querySelector('.twn-son');
    const HP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/>';
    const peindre = () => { son.innerHTML = voixOn ? `${HP}<path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/></svg><span>Voix activée</span>`
      : `${HP}<path d="M16 9l5 6M21 9l-5 6"/></svg><span>Voix coupée</span>`; son.setAttribute('aria-pressed', String(!voixOn)); son.title = voixOn ? 'Couper la voix' : 'Remettre la voix'; };
    son.addEventListener('click', () => {
      const box = document.getElementById('a2Voice');
      voixOn = !voixOn;
      if (!voixOn) couper();
      if (box) { box.checked = voixOn; box.dispatchEvent(new Event('change')); } // audit2 retient le choix (et relit la question si on la remet)
      peindre();
    });
    narr.peindre = peindre;
    document.getElementById('a2Screen').before(narr);
    if (attenteAccueil()) narr.classList.add('attend');
    if (!still) {
      addEventListener('pointermove', (e) => {
        const r = narr.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2), n = Math.hypot(dx, dy) || 1;
        narr.style.setProperty('--ex', `${(dx / n) * 3}px`); narr.style.setProperty('--ey', `${(dy / n) * 2.5}px`);
      }, { passive: true });
      const cligner = () => {
        [...narr.children].forEach((t, i) => setTimeout(() => { t.classList.add('cligne'); setTimeout(() => t.classList.remove('cligne'), 140); }, i * 80));
        setTimeout(cligner, 2800 + Math.random() * 4000);
      };
      setTimeout(cligner, 1500);
    }
    return narr;
  }

  // ── voix : chaque phrase est téléchargée en entier puis jouée (WebAudio), au même volume pour Iris et Ilo ───────
  // Avant : la lecture en flux pouvait démarrer en retard, décalée du texte, voire par-dessus la question suivante.
  let actx = null, source = null, tour = 0;
  const tampon = new Map();
  const ctx = () => (actx ||= new (window.AudioContext || window.webkitAudioContext)());
  const urlVoix = (t, q) => `/api/voice/say?voix=${q}&text=${encodeURIComponent(t)}`;
  function charger(url) {
    if (!tampon.has(url)) {
      tampon.set(url, (async () => {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`voix ${r.status}`);
        const buf = await ctx().decodeAudioData(await r.arrayBuffer());
        // égalisation : même niveau moyen pour toutes les phrases (≈ -21 dB), sans jamais saturer
        const d = buf.getChannelData(0); let s = 0, n = 0, pic = 0;
        for (let i = 0; i < d.length; i += 4) { const v = Math.abs(d[i]); if (v > .02) { s += v * v; n++; } if (v > pic) pic = v; }
        const gain = n ? Math.min(.95 / (pic || 1), Math.pow(10, -21 / 20) / Math.sqrt(s / n)) : 1;
        return { buf, gain };
      })().catch((e) => { tampon.delete(url); throw e; }));
    }
    return tampon.get(url);
  }
  async function lire(son) {
    const c = ctx();
    if (c.state === 'suspended') await Promise.race([c.resume(), new Promise((ok) => setTimeout(ok, 300))]);
    if (c.state !== 'running') throw new Error('son bloqué par le navigateur');
    const src = c.createBufferSource(), g = c.createGain();
    src.buffer = son.buf; g.gain.value = son.gain;
    src.connect(g).connect(c.destination);
    src.start();
    return src;
  }
  const couper = () => { if (source) { try { source.onended = null; source.stop(); } catch { /* déjà fini */ } source = null; } };

  const stop = () => { tour++; minuteurs.forEach(clearTimeout); minuteurs = []; document.querySelectorAll('.twn-plus').forEach((p) => p.classList.remove('cache')); couper(); narr?.querySelectorAll('.parle').forEach((t) => t.classList.remove('parle')); };
  const appliquer = () => document.body.classList.toggle('twn', actif());

  // La question en grand : chaque mot en gris, puis à l'encre quand il est dit ; les réponses arrivent ensuite
  function jouer(force, attendre) {
    stop();
    const ici = tour;
    const screenEl = document.getElementById('a2Screen');
    const h = screenEl.querySelector('h3.a2-q');
    if (!h) return;
    if (!h.dataset.twn) { h.dataset.twn = '1'; h.innerHTML = h.textContent.split(' ').map((m) => `<span>${m.replace(/[<>&]/g, '')}</span>`).join(' '); }
    const mots = [...h.children];
    // tout ce qui suit la question (réponses, aide…) attend la fin de la phrase
    const plus = [];
    for (const c of screenEl.children) {
      if (c === h || c.classList.contains('a2-help') || c.dataset.twnLibre) continue;
      if (c.contains(h)) { for (const cc of c.children) if (cc !== h && !cc.classList.contains('a2-help')) plus.push(cc); } else plus.push(c);
    }
    const nav = document.querySelector('#a2 .a2-nav');
    if (nav) plus.push(nav);
    const montrer = () => plus.forEach((p) => p.classList.remove('cache'));
    const avecVoix = (voixOn || force) && texte;
    const url = avecVoix ? urlVoix(texte, QUI[idx % 2]) : null;
    if (url) charger(url).catch(() => {}); // on commence à la télécharger tout de suite
    if (still) { mots.forEach((m) => m.classList.add('dit')); if (url) charger(url).then((s) => ici === tour && lire(s)).then((src) => { if (src) source = src; }).catch(() => {}); return; }
    mots.forEach((m) => m.classList.remove('dit'));
    plus.forEach((p) => { p.classList.add('twn-plus', 'cache'); });
    if (attendre) return; // l'ouverture est encore là : tout est prêt, on parlera à l'atterrissage
    const parleur = narr.children[idx % 2];
    parleur.classList.add('parle');
    const derouler = (pas) => {
      mots.forEach((m, i) => minuteurs.push(setTimeout(() => m.classList.add('dit'), i * pas)));
      minuteurs.push(setTimeout(() => parleur.classList.remove('parle'), mots.length * pas + 150));
    };
    minuteurs.push(setTimeout(montrer, Math.min(2400, mots.length * 230 + 300))); // jamais plus de 2,4 s d'attente
    if (!url) return derouler(220);
    // voix prête en moins de 2,5 s (toujours, une fois en cache) : texte et voix ensemble ; sinon le texte part seul
    // et la voix est abandonnée pour cette question (plus jamais de voix en retard)
    let parti = false;
    minuteurs.push(setTimeout(() => { if (!parti) { parti = true; derouler(220); } }, 2500));
    charger(url).then(async (son) => {
      if (parti || ici !== tour) return;
      parti = true;
      const src = await lire(son);
      if (ici !== tour) { try { src.stop(); } catch { /* rien */ } return; }
      source = src;
      derouler(Math.max(120, (son.buf.duration * 1000 * .9) / mots.length));
      src.onended = () => { if (source === src) { source = null; parleur.classList.remove('parle'); } };
    }).catch(() => { if (!parti && ici === tour) { parti = true; derouler(220); } });
  }

  // Appelé par audit2.js après chaque écran. Renvoie true si le narrateur s'occupe de la voix.
  function scene(nom, question, i, voix) {
    ecran = nom; texte = question || ''; idx = Math.max(0, i); voixOn = voix;
    monter(); appliquer(); narr.peindre?.();
    if (!actif()) { stop(); return false; }
    if (attenteAccueil()) { narr.classList.add('attend'); jouer(false, true); return true; } // l'ouverture est encore à l'écran : on attend qu'elle se ferme
    jouer(false);
    return true;
  }

  // Fin de l'ouverture : les deux grandes sphères volent jusqu'ici (au lieu du coin des compagnons)
  addEventListener('twiin:bienvenue-fin', (e) => {
    if (accueilFini) return;
    const surIndex = location.pathname === '/' || location.pathname.endsWith('/index.html');
    if (surIndex && ecran === 'resultat') window.twiinAuditReprendre?.(); // audit déjà fait : on repart de la 1re question
    accueilFini = true;
    const prendre = ecran && ecran !== 'resultat' && surIndex;
    if (!prendre) { narr?.classList.remove('attend'); return; }
    window.twiinVolPris = true; // les compagnons du coin n'ont pas à voler
    const depuis = e.detail;
    const atterrir = () => { narr.classList.remove('attend'); appliquer(); if (actif()) jouer(false); };
    if (!depuis || still) return setTimeout(atterrir, 760);
    const vols = depuis.map((d, i) => {
      const v = document.createElement('div');
      v.className = 'twn-vol';
      v.innerHTML = `<i class="tw-orb ${QUI[i]}"></i><i class="twn-eyes"></i>`;
      v.style.left = `${d.x}px`; v.style.top = `${d.y}px`; v.style.transform = `scale(${(d.r * 2) / 64})`;
      document.body.append(v);
      return v;
    });
    // l'ouverture se ferme (0,7 s) et la page passe sur l'audit : on vise la place des jumeaux une fois la page prête
    setTimeout(() => {
      appliquer();
      requestAnimationFrame(() => {
        const cibles = [...narr.children].map((t) => t.getBoundingClientRect());
        vols.forEach((v, i) => {
          const c = cibles[i];
          v.style.transition = `left 1s cubic-bezier(.65,0,.25,1) ${i * 90}ms, top 1s cubic-bezier(.65,0,.25,1) ${i * 90}ms, transform 1s cubic-bezier(.65,0,.25,1) ${i * 90}ms`;
          v.style.left = `${c.left + c.width / 2}px`; v.style.top = `${c.top + c.height / 2}px`; v.style.transform = `scale(${c.width / 64})`;
        });
        setTimeout(() => { vols.forEach((v) => v.remove()); atterrir(); }, 1150);
      });
    }, 720);
  });

  addEventListener('hashchange', () => { appliquer(); if (actif()) jouer(false); else stop(); });

  window.TwiinNarrateur = { actif, scene, dire: (t) => { if (t) texte = t; jouer(true); } }; // « Écouter » : rejoue la question
})();
