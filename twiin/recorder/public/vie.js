// Iris et Ilo, vivants, à la manière du compagnon d'adamperlis.com : ils bougent peu, et toujours pour une raison.
// Deux places seulement : la maison (le coin de compagnons.js) ou, si elle est recouverte, un perchoir libre dans un coin
// (jamais sur un mot, un bouton ou une image). Ils changent de place quand la page change ou que leur place est recouverte,
// en longeant les bords, sur des ressorts : ils s'accroupissent, sautent, s'étirent dans le sens du trajet, rebondissent
// en arrivant. Le reste de leur vie se passe sur place : clignements, tête qui penche vers la souris, écoute pendant la
// saisie, réflexion pendant l'analyse, petits numéros à deux au repos, inspiration et hochement à chaque mot quand ils
// parlent, sommeil après 45 s. Un clic sur une boule lui fait changer de tenue. Module à part : il ne fait que déplacer
// et habiller les deux sphères .twc-t créées par compagnons.js. Pas de mouvement si l'utilisateur en demande moins.
(() => {
  if (window.TwiinVie) return;
  window.TwiinVie = true;
  const sansMouvement = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const css = document.createElement('style');
  css.textContent = `
.twc-t { will-change: transform; }
/* « all: unset » sur .twc-duo lui fait hériter pointer-events: none de .twc : les boules ne recevaient aucun clic. On rend
   cliquables les boules seules (le clic remonte au bouton), pas le bouton, dont la place vide recouvre « Enregistrer une tâche ». */
.twc .twc-t { pointer-events: auto; cursor: pointer; touch-action: none; user-select: none; -webkit-user-select: none; }
.twc .twc-t.tenu { cursor: grabbing; z-index: 2; }
.twc.parle .twc-t { animation: none; } /* le balancement de la parole écraserait nos déplacements : on hoche la tête nous-mêmes */
.twc-t .twc-eyes::before, .twc-t .twc-eyes::after { transition: transform .12s ease-out, height .2s ease, top .2s ease, border-radius .2s ease; }
.twc-t.joie .twc-eyes::before, .twc-t.joie .twc-eyes::after { height: 13%; top: 38%; background: transparent; border: 2px solid #0b0b0b; border-bottom: 0;
  border-radius: 50% 50% 0 0; box-sizing: border-box; width: 20%; transform: translate(var(--ex, 0px), var(--ey, 0px)); }
.twc-t.surpris .twc-eyes::before, .twc-t.surpris .twc-eyes::after { transform: translate(var(--ex, 0px), var(--ey, 0px)) scale(1.4); }
.twc-t.dort .twc-eyes::before, .twc-t.dort .twc-eyes::after { height: 5%; top: 48%; border-radius: 2px; transform: none; }
.twc-t.dort .tw-orb { animation: twvSouffle 3.2s ease-in-out infinite; }
.twc-t.dort::after { content: "z"; position: absolute; right: -7px; top: -8px; font: 700 11px ui-rounded, -apple-system, sans-serif;
  color: var(--brand-strong, #56669c); animation: twvZ 2.6s ease-in-out infinite; pointer-events: none; }
.twc-t.ilo.dort::after { animation-delay: -1.3s; }
@keyframes twvSouffle { 50% { transform: scale(1.06, .95); } }
@keyframes twvZ { 0% { opacity: 0; transform: translate(0, 4px) scale(.7); } 30% { opacity: 1; } 100% { opacity: 0; transform: translate(6px, -12px) scale(1.15); } }
/* tenues : un clic sur une boule la fait tourner et changer de tenue */
.twv-acc { position: absolute; inset: 0; pointer-events: none; }
.twv-acc svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; display: none; }
.twc-t.t-lunettes .twv-acc .lunettes, .twc-t.t-noeud .twv-acc .noeud { display: block; }
.twc-t.t-or .tw-orb { filter: sepia(.9) saturate(2.3) hue-rotate(-12deg) brightness(1.08); }
.twc .twc-t.toupie > * { animation: twvToupie .7s cubic-bezier(.45,0,.55,1) !important; } /* !important : jumeaux.js coupe les animations des sphères WebGL */ /* sur les enfants : ils tournent autour du centre de la boule, pas de sa place d'origine */
@keyframes twvToupie { from { rotate: y 0turn; } to { rotate: y 1turn; } }`
  // à l'arrivée sur une page, ils apparaissent directement à leur place (pas de « pop » au coin puis de trajet)
  + (sansMouvement ? '' : `
.twc-t:not(.twv-pret) { opacity: 0; }
.twc .twc-t.arrive { animation: none; }`);
  document.head.append(css);

  const hasard = (a, b) => a + Math.random() * (b - a);
  const borne = (v, a, b) => Math.min(b, Math.max(a, v));
  const INTERDIT = 'a, button, input, select, textarea, label, summary, [role="button"], [contenteditable]';

  const demarrer = (el) => {
    const twins = [...el.querySelectorAll('.twc-t')];
    const bulle = el.querySelector('.twc-bulle');
    // chacun son allure : raideur k, amortissement c, vitesse maximale (px/s)
    const etre = twins.map((t, i) => ({ t, x: 0, y: 0, hx: 0, hy: 0, tx: 0, ty: 0, ox: 0, oy: 0, vx: 0, vy: 0, q: 0, vq: 0, l: 0, vl: 0,
      chemin: [], lance: 0, lanceFait: true, atterri: true, s: 1, vs: 0, sc: 1, k: i ? 70 : 55, c: i ? 14 : 12, vmax: i ? 420 : 380 }));
    const [A, B] = etre;
    twins.forEach((t) => t.classList.remove('arrive')); // l'animation d'arrivée bloquerait nos déplacements

    // place « maison » (le coin) de chaque sphère, sans déplacement
    const maison = () => etre.forEach((e) => {
      const tr = e.t.style.transform; e.t.style.transform = '';
      const r = e.t.getBoundingClientRect(), ax = e.hx, ay = e.hy;
      e.hx = r.left + r.width / 2; e.hy = r.top + r.height / 2;
      e.t.style.transform = tr;
      if (!ax && !ay) { e.x = e.tx = e.hx; e.y = e.ty = e.hy; }
      else if (e.tx === ax && e.ty === ay) { e.tx = e.hx; e.ty = e.hy; } // il était à la maison : elle a bougé avec la fenêtre
    });
    maison();
    addEventListener('resize', maison);

    // ── places libres ─────────────────────────────────────────────────────────────────────────────────────────
    // Un endroit est libre si, sous un carré de 44 px autour de la boule, il n'y a que du fond : ni mot, ni bouton,
    // ni champ, ni image. Le fond vide d'un encadré reste libre.
    const zone = () => {
      const s = document.querySelector('.tw-side');
      return { L: (s && innerWidth > 900 ? s.getBoundingClientRect().right : 0) + 18, R: innerWidth - 18, T: 18, B: innerHeight - 18 };
    };
    const MEDIA = 'img, video, canvas, svg, iframe, .tw-orb, .twc-t';
    const fond = (n, x, y) => {
      if (n === document.documentElement || n === document.body) return true;
      if (n.closest?.(INTERDIT + ', ' + MEDIA)) return false;
      const rg = document.createRange();
      for (const c of n.childNodes) {
        if (c.nodeType !== 3 || !c.textContent.trim()) continue;
        rg.selectNodeContents(c);
        for (const r of rg.getClientRects()) if (x > r.left - 10 && x < r.right + 10 && y > r.top - 8 && y < r.bottom + 8) return false;
      }
      return true;
    };
    const libre = (x, y, autre) => {
      const z = zone();
      if (x < z.L + 22 || x > z.R - 22 || y < z.T + 22 || y > z.B - 22) return false;
      if (autre && Math.hypot(x - autre[0], y - autre[1]) < 40) return false;
      for (const dx of [-22, 0, 22]) for (const dy of [-22, 0, 22]) {
        const hit = document.elementsFromPoint(x + dx, y + dy).find((n) => !el.contains(n));
        if (hit && !fond(hit, x + dx, y + dy)) return false;
      }
      return true;
    };
    const placesDuCoin = (c) => {
      const z = zone(), out = [], bx = c[1] === 'g' ? z.L : z.R, by = c[0] === 'h' ? z.T : z.B;
      for (const a of [40, 70, 105, 145]) for (const b of [40, 70, 105, 145]) out.push([c[1] === 'g' ? z.L + a : z.R - a, c[0] === 'h' ? z.T + b : z.B - b]);
      return out.sort((p, q) => (Math.abs(p[0] - bx) + Math.abs(p[1] - by)) - (Math.abs(q[0] - bx) + Math.abs(q[1] - by)));
    };
    const placeLibre = (c, autre) => {
      const l = placesDuCoin(c).filter((p) => libre(p[0], p[1], autre));
      return l.length ? l[Math.floor(Math.random() * Math.min(3, l.length))] : null; // une des plus proches de l'angle
    };
    // perchoir : un coin libre, de préférence en haut à droite, avec deux places côte à côte
    const perchoir = () => {
      for (const c of ['hd', 'hg', 'bg', 'bd']) {
        const p = placeLibre(c); if (!p) continue;
        const q = [p[0] + (c[1] === 'd' ? -34 : 34), p[1]];
        if (libre(q[0], q[1], null)) return [p, q];
        const r = placeLibre(c, p); if (r) return [p, r];
      }
      return null;
    };

    // ── trajet : on longe les bords de l'écran, jamais par le milieu ────────────────────────────────────────────
    const bordure = () => { const z = zone(), m = 34; return { x0: z.L + m, x1: z.R - m, y0: z.T + m, y1: z.B - m }; };
    const surBord = (x, y) => { // position sur le tour (0 → en haut à gauche, sens des aiguilles)
      const b = bordure(), W = b.x1 - b.x0, H = b.y1 - b.y0;
      const cx = borne(x, b.x0, b.x1), cy = borne(y, b.y0, b.y1);
      const d = [cy - b.y0, b.x1 - cx, b.y1 - cy, cx - b.x0], k = d.indexOf(Math.min(...d));
      return [cx - b.x0, W + (cy - b.y0), W + H + (b.x1 - cx), 2 * W + H + (b.y1 - cy)][k];
    };
    const pointDuTour = (s) => {
      const b = bordure(), W = b.x1 - b.x0, H = b.y1 - b.y0, P = 2 * (W + H); s = ((s % P) + P) % P;
      if (s < W) return [b.x0 + s, b.y0]; if (s < W + H) return [b.x1, b.y0 + s - W];
      if (s < 2 * W + H) return [b.x1 - (s - W - H), b.y1]; return [b.x0, b.y1 - (s - 2 * W - H)];
    };
    const cheminLeLong = (e, x, y) => {
      const b = bordure(), W = b.x1 - b.x0, H = b.y1 - b.y0, P = 2 * (W + H);
      const s0 = surBord(e.x, e.y), s1 = surBord(x, y);
      let d = s1 - s0; if (d > P / 2) d -= P; if (d < -P / 2) d += P; // le plus court des deux sens
      const coins = [0, W, W + H, 2 * W + H].flatMap((c) => [c, c + P, c - P])
        .filter((c) => (d > 0 ? c > s0 && c < s0 + d : c < s0 && c > s0 + d)).sort((p, q) => (d > 0 ? p - q : q - p));
      return [...coins.map(pointDuTour), [x, y]];
    };

    // ── gestes de base (ressorts) : q = écrasement (+ écrasé, − étiré), l = hauteur du saut ─────────────────────
    const sauter = (e, force = 1) => { e.vq += 3 * force; setTimeout(() => { e.vl -= 260 * force; e.vq -= 5 * force; }, 110); };
    etre.forEach((e) => e.t.addEventListener('twv-saut', () => sauter(e, .7)));
    const envoyer = (e, x, y, delai = 0, direct = false) => {
      e.tx = x; e.ty = y; e.ox = 0; e.oy = 0;
      clearTimeout(e.tDep);
      e.tDep = setTimeout(() => {
        e.chemin = direct ? [[x, y]] : cheminLeLong(e, x, y);
        e.vq += 3.2; e.lance = performance.now() + 120; e.lanceFait = false; e.atterri = false; // il s'accroupit, puis s'élance
      }, delai);
    };

    // ── humeurs et regard ────────────────────────────────────────────────────────────────────────────────────
    const mine = (e, cls, ms) => { e.t.classList.add(cls); setTimeout(() => e.t.classList.remove(cls), ms); };
    let regard = null; // pendant un regard échangé, les yeux visent l'autre
    const regarder = (e, x, y) => {
      const dx = x - e.x, dy = y - e.y, n = Math.hypot(dx, dy) || 1;
      e.t.style.setProperty('--ex', `${(dx / n) * 1.6}px`); e.t.style.setProperty('--ey', `${(dy / n) * 1.4}px`);
    };
    let sx = innerWidth / 2, sy = innerHeight / 2;
    addEventListener('pointermove', (ev) => { sx = ev.clientX; sy = ev.clientY; }, { passive: true });
    const humeur = () => {
      if (!dort && !parle() && !numero) {
        const r = Math.random();
        if (r < .35) { regard = Date.now() + 1600; mine(A, 'joie', 1600); mine(B, 'joie', 1600); }
        else if (r < .55) mine(etre[Math.floor(Math.random() * 2)], 'surpris', 900);
        else if (r < .8) mine(etre[Math.floor(Math.random() * 2)], 'joie', 1400);
        else regard = Date.now() + 1800;
      }
      setTimeout(humeur, hasard(4000, 9000));
    };
    setTimeout(humeur, 3000);
    // en plus des clignements de compagnons.js (les deux ensemble), chacun cligne à son propre rythme
    etre.forEach((e) => { const c = () => { if (!dort) mine(e, 'cligne', 130); setTimeout(c, hasard(3500, 8000)); }; setTimeout(c, hasard(1000, 4000)); });
    // écoute : un champ a le focus ; réflexion : le panneau d'analyse est affiché
    let champ = null, frappe = 0;
    addEventListener('focusin', (ev) => { champ = ev.target.closest?.('input, textarea, [contenteditable]') || null; });
    addEventListener('focusout', () => { champ = null; });
    addEventListener('keydown', () => { // petit hochement pendant la saisie, une boule à la fois, pas à chaque touche
      if (!champ || dort || performance.now() < frappe) return;
      frappe = performance.now() + 260; const e = etre[Math.floor(Math.random() * 2)]; e.vq += .9; e.vl += 20;
    });
    const reflechit = () => { const a = document.getElementById('analysis'); return !!a && !a.hidden && a.offsetParent !== null; };

    // ── sommeil : 45 s sans rien ; au réveil, un saut et l'air surpris ──────────────────────────────────────────
    let dort = false, calme = 0, derniere = performance.now();
    const SOMMEIL = 45000;
    const veille = () => {
      clearTimeout(calme); derniere = performance.now();
      if (dort) {
        dort = false;
        etre.forEach((e, i) => { e.t.classList.remove('dort'); setTimeout(() => { mine(e, 'surpris', 700); sauter(e); }, i * 160); });
      }
      calme = setTimeout(() => { dort = true; couper(); etre.forEach((e) => e.t.classList.add('dort')); }, SOMMEIL);
    };
    ['pointermove', 'keydown', 'scroll', 'click', 'touchstart'].forEach((ev) => addEventListener(ev, veille, { passive: true, capture: true }));
    ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach((ev) => addEventListener(ev, () => couper(), { passive: true, capture: true }));
    veille();

    // ── fusion et séparation ─────────────────────────────────────────────────────────────────────────────────
    let fusion = 'non'; // non → rejoindre → une → non
    const fondre = () => {
      if (fusion !== 'rejoindre') return;
      fusion = 'une';
      B.t.style.transition = 'opacity .35s ease .1s'; B.sc = .3; B.t.style.opacity = '0';
      A.sc = 1.28;
      mine(A, 'joie', 1500);
      minuteur(separer, hasard(5000, 9000));
    };
    const separer = () => {
      if (fusion === 'rejoindre') { fusion = 'non'; B.ox = B.oy = 0; return; }
      if (fusion !== 'une') return;
      A.sc = 1;
      B.x = A.x; B.y = A.y; B.ox = B.oy = 0; B.vx = (B.tx - A.tx) * 3; B.vq -= 3;
      B.t.style.transition = 'opacity .2s ease'; B.sc = 1; B.t.style.opacity = '1';
      mine(A, 'surpris', 700); mine(B, 'joie', 1200);
      fusion = 'non';
    };

    // ── petits numéros à deux, au repos (8 s sans action, puis toutes les 15 à 25 s) ─────────────────────────────
    let numero = null, dernierNumero = '', prochainNumero = performance.now() + hasard(12000, 18000), tours = [];
    const minuteur = (f, ms) => tours.push(setTimeout(f, ms));
    const finNumero = (ms) => minuteur(() => { numero = null; prochainNumero = performance.now() + hasard(15000, 25000); }, ms);
    const NUMEROS = {
      pingpong: () => { // ils se renvoient un petit saut en se regardant
        regard = Date.now() + 2400;
        [A, B, A, B, A].forEach((e, i) => minuteur(() => sauter(e, .8), i * 380));
        minuteur(() => { mine(A, 'joie', 1200); mine(B, 'joie', 1200); }, 1900);
        finNumero(2600);
      },
      cachecache: () => { // Ilo se cache derrière Iris, puis pointe le bout du nez
        B.t.style.zIndex = '0'; A.t.style.zIndex = '1';
        B.ox = (A.tx - B.tx) * .8; B.oy = (A.ty - B.ty) * .8;
        minuteur(() => { B.oy -= 16; mine(A, 'surpris', 900); regard = Date.now() + 1200; }, 1700);
        minuteur(() => { B.ox = B.oy = 0; mine(B, 'joie', 1200); }, 2900);
        minuteur(() => { B.t.style.zIndex = ''; A.t.style.zIndex = ''; }, 3600);
        finNumero(3700);
      },
      toupie: () => { // toupie l'un après l'autre
        etre.forEach((e, i) => minuteur(() => { e.t.classList.add('toupie'); setTimeout(() => e.t.classList.remove('toupie'), 720); }, i * 260));
        minuteur(() => { mine(A, 'joie', 1100); mine(B, 'joie', 1100); }, 1000);
        finNumero(1800);
      },
      fusion: () => { // Ilo glisse dans Iris, ils ne font plus qu'un, puis se redédoublent
        fusion = 'rejoindre'; B.ox = A.tx - B.tx; B.oy = A.ty - B.ty;
        minuteur(fondre, 1100);
        finNumero(1200);
      },
    };
    const lancerNumero = (nom) => {
      if (!nom) { const l = Object.keys(NUMEROS).filter((n) => n !== dernierNumero); nom = l[Math.floor(Math.random() * l.length)]; }
      numero = dernierNumero = nom; NUMEROS[nom]();
    };
    const couper = () => { // le moindre geste de l'utilisateur arrête le numéro
      if (!numero && fusion === 'non') return;
      tours.forEach(clearTimeout); tours = [];
      etre.forEach((e) => { e.ox = e.oy = 0; e.t.style.zIndex = ''; e.t.classList.remove('toupie'); });
      separer();
      if (numero) { numero = null; prochainNumero = performance.now() + hasard(15000, 25000); }
    };

    // ── parole : ils rentrent à la maison, prennent une inspiration, et hochent la tête à chaque mot ───────────────
    const parle = () => bulle && bulle.classList.contains('on');
    if (bulle) {
      new MutationObserver((ms) => {
        for (const m of ms) {
          if (m.target === bulle && bulle.classList.contains('on') && !/(^| )on( |$)/.test(m.oldValue || '')) etre.forEach((e) => { e.vq -= 2.2; }); // inspiration
          else if (m.target.tagName === 'SPAN' && m.target.classList.contains('on') && el.classList.contains('parle')) {
            const e = etre[[...m.target.parentNode.children].indexOf(m.target) % 2]; e.vq += 1.1; e.vl += 22; // un hochement par mot, à tour de rôle
          }
        }
      }).observe(bulle, { attributes: true, attributeFilter: ['class'], attributeOldValue: true, subtree: true });
    }
    const enPause = () => el.classList.contains('attend') || document.body.classList.contains('twn') || innerWidth <= 900;

    // ── où se poser : la maison si elle est libre, sinon un perchoir ─────────────────────────────────────────────
    let choisie = null; // place où l'utilisateur les a posées à la souris : prioritaire tant qu'elle reste libre
    const ranger = (force) => {
      if (fusion !== 'non' || numero || tenu) return;
      let pA = [A.hx, A.hy], pB = [B.hx, B.hy];
      if (choisie && libre(...choisie[0], null) && libre(...choisie[1], null)) [pA, pB] = choisie;
      else if (!(libre(A.hx, A.hy, null) && libre(B.hx, B.hy, null))) { const p = perchoir(); if (!p) return; [pA, pB] = p; }
      const loin = (e, p) => Math.hypot(e.tx - p[0], e.ty - p[1]) > 20;
      if (!force && !loin(A, pA) && !loin(B, pB)) return;
      const [e1, p1, e2, p2] = Math.random() < .5 ? [A, pA, B, pB] : [B, pB, A, pA]; // l'un part, l'autre suit
      envoyer(e1, p1[0], p1[1]); envoyer(e2, p2[0], p2[1], hasard(180, 520));
    };
    addEventListener('hashchange', () => setTimeout(() => ranger(), 700));

    // ── déplacer une boule à la souris (appui maintenu + glisser) ─────────────────────────────────────────────────
    let tenu = null; // { e, id, x0, y0, dx, dy, px, py, glisse }
    const placeProche = (x, y) => { // la place libre la plus proche du lâcher (jamais sur un mot ou un bouton)
      if (libre(x, y, null)) return [x, y];
      for (let r = 20; r <= 160; r += 20) for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2, p = [x + Math.cos(a) * r, y + Math.sin(a) * r];
        if (libre(p[0], p[1], null)) return p;
      }
      return null;
    };
    etre.forEach((e) => e.t.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0 || enPause()) return;
      tenu = { e, id: ev.pointerId, x0: ev.clientX, y0: ev.clientY, dx: e.x - ev.clientX, dy: e.y - ev.clientY, px: e.x, py: e.y, glisse: false };
    }));
    addEventListener('pointermove', (ev) => {
      if (!tenu || ev.pointerId !== tenu.id) return;
      if (!tenu.glisse) {
        if (Math.hypot(ev.clientX - tenu.x0, ev.clientY - tenu.y0) < 5) return; // simple clic tant qu'on ne bouge pas
        const e = tenu.e; tenu.glisse = true;
        try { e.t.setPointerCapture(ev.pointerId); } catch { /* sans capture, on suit quand même la souris sur la fenêtre */ }
        e.t.dataset.glisse = '1'; e.t.classList.add('tenu'); clearTimeout(e.tDep); e.chemin = []; mine(e, 'surpris', 700);
      }
      tenu.px = ev.clientX + tenu.dx; tenu.py = ev.clientY + tenu.dy;
    });
    const lacher = (ev) => {
      if (!tenu || ev.pointerId !== tenu.id) return;
      const { e, glisse } = tenu; tenu = null;
      if (!glisse) return;
      e.t.classList.remove('tenu'); setTimeout(() => delete e.t.dataset.glisse, 80); // le clic qui suit le lâcher est ignoré
      const p = placeProche(e.x, e.y), o = e === A ? B : A;
      if (!p) { e.chemin = [[e.tx, e.ty]]; e.lance = 0; e.lanceFait = true; e.atterri = false; mine(e, 'surpris', 700); return; } // nulle part : il rentre
      e.tx = p[0]; e.ty = p[1]; e.ox = e.oy = 0; e.chemin = [p]; e.lance = 0; e.lanceFait = true; e.atterri = false;
      mine(e, 'joie', 1200);
      const cote = p[0] > innerWidth / 2 ? -34 : 34;
      const q = [[p[0] + cote, p[1]], [p[0] - cote, p[1]]].find((c) => libre(c[0], c[1], null));
      if (q) { envoyer(o, q[0], q[1], 250, true); choisie = e === A ? [p, q] : [q, p]; } // l'autre vient se mettre à côté
      else choisie = e === A ? [p, [o.tx, o.ty]] : [[o.tx, o.ty], p];
      regard = Date.now() + 1500;
    };
    addEventListener('pointerup', lacher); addEventListener('pointercancel', lacher);
    // ── d'une page à l'autre : ils réapparaissent là où ils étaient (place gardée pour l'onglet) ───────────────────
    const CLE_PLACE = 'twiin-vie-place';
    let dernierMemo = '';
    const memoriser = () => {
      const v = JSON.stringify({ a: [Math.round(A.tx), Math.round(A.ty)], b: [Math.round(B.tx), Math.round(B.ty)], choisie: !!choisie, w: innerWidth, h: innerHeight });
      if (v === dernierMemo) return;
      dernierMemo = v; try { sessionStorage.setItem(CLE_PLACE, v); } catch { /* stockage indisponible : ils repartiront du coin */ }
    };
    const placerAuDepart = () => {
      let s = null; try { s = JSON.parse(sessionStorage.getItem(CLE_PLACE)); } catch { s = null; }
      let pA, pB;
      if (s && Math.abs(s.w - innerWidth) < 3 && Math.abs(s.h - innerHeight) < 3 && libre(s.a[0], s.a[1], null) && libre(s.b[0], s.b[1], null)) {
        pA = s.a; pB = s.b; if (s.choisie) choisie = [s.a, s.b];
      } else if (libre(A.hx, A.hy, null) && libre(B.hx, B.hy, null)) { pA = [A.hx, A.hy]; pB = [B.hx, B.hy]; }
      else [pA, pB] = perchoir() || [[A.hx, A.hy], [B.hx, B.hy]];
      [[A, pA], [B, pB]].forEach(([e, p], i) => { // petit « pop » sur place
        e.x = e.tx = p[0]; e.y = e.ty = p[1];
        e.s = 0; e.vs = 0; e.sc = 0; e.t.classList.add('twv-pret');
        setTimeout(() => { e.sc = 1; }, 120 + i * 90);
      });
    };
    placerAuDepart();

    window.__twVie = { etre, zone, perchoir, ranger: () => ranger(true), numero: lancerNumero, // outil de test
      etat: () => ({ dort, fusion, numero, parle: parle(), pause: enPause(), ecoute: !!champ, reflechit: reflechit() }) };

    // ── la bulle suit Iris et Ilo : dessous s'ils sont en haut, dessus s'ils sont en bas, coin pointu vers eux ──
    let bdx = 0, bdy = 0; // décalage appliqué à la bulle (propriété translate, sans toucher au transform de compagnons.js)
    const placerBulle = () => {
      const r = bulle.getBoundingClientRect(); if (!r.width) return;
      const L = Math.min(A.x, B.x) - 15, R = Math.max(A.x, B.x) + 15, T = Math.min(A.y, B.y) - 15, Bo = Math.max(A.y, B.y) + 15;
      const haut = (T + Bo) / 2 < innerHeight / 2, droite = (L + R) / 2 > innerWidth / 2;
      const nl = r.left - bdx, nt = r.top - bdy; // place d'origine de la bulle
      const x = borne(droite ? R - r.width : L, 12, innerWidth - 12 - r.width);
      const y = borne(haut ? Bo + 8 : T - 8 - r.height, 12, innerHeight - 12 - r.height);
      bdx = x - nl; bdy = y - nt;
      bulle.style.translate = `${bdx.toFixed(1)}px ${bdy.toFixed(1)}px`;
      bulle.style.borderRadius = haut ? (droite ? '14px 4px 14px 14px' : '4px 14px 14px 14px') : (droite ? '14px 14px 4px 14px' : '14px 14px 14px 4px');
      bulle.style.transformOrigin = `${droite ? '100%' : '0%'} ${haut ? '0%' : '100%'}`;
    };

    // ── boucle ───────────────────────────────────────────────────────────────────────────────────────────────
    let avant = performance.now(), verif = 0, parlait = false;
    const boucle = (now) => {
      requestAnimationFrame(boucle);
      const dt = Math.min(.033, (now - avant) / 1000); avant = now;
      if (el.classList.contains('vol')) return; // vol d'arrivée de la page d'accueil (compagnons.js) : on le laisse finir
      if (enPause()) {
        etre.forEach((e) => { e.x = e.tx = e.hx; e.y = e.ty = e.hy; e.vx = e.vy = 0; e.chemin = []; e.t.style.transform = ''; });
        if (bulle && (bdx || bdy)) { bdx = bdy = 0; bulle.style.translate = bulle.style.borderRadius = bulle.style.transformOrigin = ''; }
        return;
      }
      if (bulle && !bulle.hidden) placerBulle();
      const auRepos = etre.every((e) => !e.chemin.length) && !tenu?.glisse;
      if (parle() !== parlait) { parlait = parle(); if (parlait) couper(); } // ils parlent sur place : la bulle vient à eux
      if (now > verif) { // place recouverte (défilement, contenu qui arrive…) : on se range ailleurs
        verif = now + 700;
        if (auRepos && fusion === 'non' && !numero) memoriser();
        if (auRepos && !dort && !parle() && !numero && fusion === 'non' && (!libre(A.tx, A.ty, null) || !libre(B.tx, B.ty, null))) ranger();
      }
      if (auRepos && !dort && !parle() && !numero && fusion === 'non' && now - derniere > 8000 && now > prochainNumero) lancerNumero();
      const pense = reflechit();

      etre.forEach((e, i) => {
        if (fusion === 'une' && e === B) { e.x = A.x; e.y = A.y; e.vx = e.vy = 0; }
        else if (tenu?.glisse && tenu.e === e) { // dans la main : suit la souris, sa vitesse sert à l'étirer
          const nx = borne(tenu.px, 15, innerWidth - 15), ny = borne(tenu.py, 15, innerHeight - 15);
          if (dt) { e.vx = e.vx * .6 + ((nx - e.x) / dt) * .4; e.vy = e.vy * .6 + ((ny - e.y) / dt) * .4; }
          e.x = nx; e.y = ny;
        } else {
          let tx = e.tx + e.ox, ty = e.ty + e.oy;
          if (e.chemin.length) {
            if (now < e.lance) { tx = e.x; ty = e.y; } // accroupi, juste avant de s'élancer
            else {
              if (!e.lanceFait) { e.lanceFait = true; e.vq -= 6; }
              [tx, ty] = e.chemin[0];
              if (e.chemin.length > 1 && Math.hypot(tx - e.x, ty - e.y) < 28) { e.chemin.shift(); [tx, ty] = e.chemin[0]; } // il prend le virage sans s'arrêter
              const d = Math.hypot(tx - e.x, ty - e.y), v = Math.hypot(e.vx, e.vy);
              if (e.chemin.length === 1 && d < 14 && !e.atterri) { e.atterri = true; e.vq += 1.2 + Math.min(2, v / 250); } // il atterrit
              if (e.chemin.length === 1 && d < 1 && v < 12) e.chemin = [];
            }
          }
          e.vx += ((tx - e.x) * e.k - e.vx * e.c) * dt; e.vy += ((ty - e.y) * e.k - e.vy * e.c) * dt;
          const v = Math.hypot(e.vx, e.vy); if (v > e.vmax) { e.vx *= e.vmax / v; e.vy *= e.vmax / v; }
          e.x += e.vx * dt; e.y += e.vy * dt;
        }
        e.vq += (-e.q * 320 - e.vq * 16) * dt; e.q += e.vq * dt;
        e.vl += (-e.l * 180 - e.vl * 14) * dt; e.l += e.vl * dt;
        e.vs += ((e.sc - e.s) * 170 - e.vs * 13) * dt; e.s += e.vs * dt; // taille (pop d'arrivée, fusion), sur ressort

        // tête : penche dans le sens du trajet, vers la souris, vers le champ qu'on remplit, ou se balance en réfléchissant
        const v = Math.hypot(e.vx, e.vy), st = Math.min(.2, v / 1900), a = (Math.atan2(e.vy, e.vx) * 180) / Math.PI;
        let tete = borne(e.vx / 30, -12, 12);
        if (dort) tete += i ? -6 : 6;
        else if (champ) { const r = champ.getBoundingClientRect(); tete += Math.sign(r.left + r.width / 2 - e.x) * 10; }
        else if (pense) tete += Math.sin(now / 900 + i * 1.3) * 7;
        else tete += borne((sx - e.x) / 600, -1, 1) * 6;
        const q = borne(e.q, -.3, .3);
        const flotte = dort ? Math.sin(now / 900 + i * 2) * 1.5 + 3 : Math.sin(now / 700 + i * 1.7) * 2;
        e.t.style.transform = `translate(${(e.x - e.hx).toFixed(1)}px, ${(e.y - e.hy + flotte + e.l + q * 15).toFixed(1)}px) `
          + `rotate(${a.toFixed(1)}deg) scale(${(1 + st).toFixed(3)}, ${(1 - st * .7).toFixed(3)}) rotate(${(-a).toFixed(1)}deg) `
          + `rotate(${tete.toFixed(1)}deg) scale(${(Math.max(0, e.s) * (1 + q * .45)).toFixed(3)}, ${(Math.max(0, e.s) * (1 - q)).toFixed(3)})`;

        if (!dort) {
          const o = e === A ? B : A;
          if (regard && Date.now() < regard) regarder(e, o.x, o.y);
          else if (champ) { const r = champ.getBoundingClientRect(); regarder(e, r.left + r.width / 2, r.top + r.height / 2); }
          else if (pense) regarder(e, e.x - 20, e.y - 40); // les yeux en l'air
          else regarder(e, sx, sy);
        }
      });
    };
    requestAnimationFrame(boucle);
  };

  // ── tenues : chrome → or → lunettes noires → nœud papillon, chacune la sienne, gardée d'une page à l'autre ──
  const TENUES = ['chrome', 'or', 'lunettes', 'noeud'];
  const ACCESSOIRES = `<svg class="lunettes" viewBox="0 0 30 30"><path d="M2 11.5h3M14 11.5h2M25 11.5h3" stroke="#111" stroke-width="1.4" stroke-linecap="round"/>
<rect x="5" y="8.5" width="9" height="8" rx="3.2" fill="#111"/><rect x="16" y="8.5" width="9" height="8" rx="3.2" fill="#111"/>
<path d="M7 10.5l2.5-0.6M18 10.5l2.5-0.6" stroke="#fff" stroke-opacity=".75" stroke-width="1" stroke-linecap="round"/></svg>
<svg class="noeud" viewBox="0 0 30 30"><path d="M15 29.5 9.5 26.3v6.4ZM15 29.5l5.5-3.2v6.4Z" fill="#161615"/><circle cx="15" cy="29.5" r="1.6" fill="#161615"/></svg>`;
  const lire = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const ecrire = (k, v) => { try { localStorage.setItem(k, v); } catch { /* stockage indisponible : la tenue ne sera pas gardée */ } };
  const habiller = (el) => {
    el.querySelectorAll('.twc-t').forEach((t) => {
      const cle = `twiin-tenue-${t.classList.contains('ilo') ? 'ilo' : 'iris'}`;
      const acc = document.createElement('i'); acc.className = 'twv-acc'; acc.innerHTML = ACCESSOIRES; t.append(acc);
      let n = Math.max(0, TENUES.indexOf(lire(cle)));
      const porter = () => { TENUES.forEach((x) => t.classList.remove(`t-${x}`)); t.classList.add(`t-${TENUES[n]}`); };
      porter();
      t.addEventListener('click', (ev) => {
        ev.stopPropagation(); // pas de bulle au clic : elle les ferait descendre à la maison puis remonter (toute la hauteur de l'écran)
        if (t.classList.contains('toupie') || t.dataset.glisse) return; // un déplacement à la souris n'est pas un clic
        t.dispatchEvent(new CustomEvent('twv-saut')); // petit saut sur place (géré par demarrer)
        n = (n + 1) % TENUES.length; ecrire(cle, TENUES[n]);
        if (sansMouvement) return porter();
        t.classList.add('toupie');
        setTimeout(porter, 230); // de profil, au quart du tour : le changement ne se voit pas
        setTimeout(() => t.classList.remove('toupie'), 720);
        const autre = [...el.querySelectorAll('.twc-t')].find((x) => x !== t);
        if (autre) { autre.classList.add('surpris'); setTimeout(() => autre.classList.remove('surpris'), 800); }
      });
    });
  };

  const pret = (t0 = performance.now()) => {
    const el = document.querySelector('.twc');
    if (el && el.querySelectorAll('.twc-t').length === 2) {
      habiller(el);
      if (sansMouvement) return null;
      try { demarrer(el); } catch (err) { el.querySelectorAll('.twc-t').forEach((t) => t.classList.add('twv-pret')); throw err; } // jamais invisibles
      return null;
    }
    if (performance.now() - t0 < 5000) requestAnimationFrame(() => pret(t0));
    else document.querySelectorAll('.twc-t').forEach((t) => t.classList.add('twv-pret'));
  };
  pret();
})();
