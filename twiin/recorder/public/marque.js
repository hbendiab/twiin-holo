// Marque de l'entreprise cliente (Microsoft, BNP…), réglée dans Mise en service : couleurs, police, formes et logo
// remplacent ceux de Twiin dans tout le SaaS, et les vidéos de formation les reprennent.
// Couleur principale → boutons, liens, états forts ; secondaire → fonds, puces, filets (sinon dérivée de la principale).
// Le contraste sur blanc est garanti : la couleur principale est assombrie si elle n'est pas assez lisible.
(() => {
  if (window.TwiinMarque) return;
  const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const css = (rgb) => `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const lum = (rgb) => { const l = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
  const contraste = (a, b) => { const [x, y] = [lum(hex(a)), lum(hex(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const W = [255, 255, 255], K = [0, 0, 0];
  const FORMES = { carre: ['3px', '4px'], doux: ['8px', '10px'], arrondi: ['16px', '22px'] };

  function teintes(m) {
    const c = hex(m.couleur || '#56669c');
    let fort = c;
    for (let t = 0; t < 0.9 && 1.05 / (lum(fort) + 0.05) < 4.5; t += 0.05) fort = mix(c, K, t);
    const s = m.couleur2 ? hex(m.couleur2) : (lum(c) > 0.35 ? c : mix(c, W, 0.72));
    const v = {
      '--brand': css(s), '--brand-hover': css(mix(s, K, 0.06)), '--brand-strong': css(fort), '--brand-ink': css(mix(c, K, 0.82)),
      '--brand-tint': css(mix(s, W, 0.8)), '--brand-chip': css(mix(s, W, 0.55)), '--brand-rule': css(mix(s, W, 0.45)),
    };
    if (!m.couleur2) Object.assign(v, { '--brand-tint': css(mix(c, W, 0.95)), '--brand-chip': css(mix(c, W, 0.88)), '--brand-rule': css(mix(c, W, 0.83)) });
    if (m.police) v['--font'] = `"${m.police}", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    if (m.forme && FORMES[m.forme]) [v['--r-card'], v['--r-panel']] = FORMES[m.forme];
    return v;
  }
  const policeUrl = (p) => `https://fonts.googleapis.com/css2?family=${encodeURIComponent(p).replace(/%20/g, '+')}:wght@400;500;600;700&display=swap`;

  let style = null, lienPolice = null, etat = {};
  function appliquer(m, { garder = true } = {}) {
    etat = m || {};
    style?.remove(); style = null; lienPolice?.remove(); lienPolice = null;
    if (m && (m.couleur || m.couleur2 || m.police || m.forme)) {
      style = document.createElement('style');
      style.id = 'twiin-marque';
      const v = teintes(m), sombre = ['--font', '--r-card', '--r-panel'];
      style.textContent = `:root:not([data-theme="dark"]) { ${Object.entries(v).map(([k, x]) => `${k}: ${x};`).join(' ')} }
        :root[data-theme="dark"] { ${Object.entries(v).filter(([k]) => sombre.includes(k)).map(([k, x]) => `${k}: ${x};`).join(' ')} }`;
      document.head.append(style);
      if (m.police && m.police !== 'Google Sans Flex') {
        lienPolice = document.createElement('link'); lienPolice.rel = 'stylesheet'; lienPolice.href = policeUrl(m.police); document.head.append(lienPolice);
      }
    }
    // sous « Twiin » dans le menu : le logo seul s'il y en a un (il dit déjà le nom), sinon le nom
    document.querySelectorAll('.tw-client').forEach((e) => e.remove());
    const brand = document.querySelector('.tw-brand');
    if (brand && m && (m.logo || m.nom)) {
      const s = document.createElement('span');
      s.className = 'tw-lbl tw-client';
      s.innerHTML = `<span aria-hidden="true">×</span>${m.logo ? `<img src="${m.logo}" alt="">` : ''}`;
      if (m.logo) s.querySelector('img').alt = m.nom || 'Entreprise'; else s.append(document.createTextNode(m.nom));
      brand.append(s);
    }
    if (garder) try { localStorage.setItem('twiin-marque', JSON.stringify(m || {})); } catch { /* rien */ }
  }

  // Couleur dominante d'un logo (hors blanc, noir et gris), proposée comme couleur principale
  function dominante(src) {
    return new Promise((ok) => {
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement('canvas'); cv.width = cv.height = 48;
        const g = cv.getContext('2d'); g.drawImage(img, 0, 0, 48, 48);
        const d = g.getImageData(0, 0, 48, 48).data, seaux = new Map();
        for (let i = 0; i < d.length; i += 4) {
          const [r, v, b, a] = [d[i], d[i + 1], d[i + 2], d[i + 3]];
          const max = Math.max(r, v, b), min = Math.min(r, v, b);
          if (a < 200 || max - min < 40 || max < 40) continue;
          const k = `${r >> 5},${v >> 5},${b >> 5}`, s = seaux.get(k) || { n: 0, r: 0, v: 0, b: 0 };
          s.n++; s.r += r; s.v += v; s.b += b; seaux.set(k, s);
        }
        const best = [...seaux.values()].sort((a, b) => b.n - a.n)[0];
        ok(best ? css([best.r / best.n, best.v / best.n, best.b / best.n]) : null);
      };
      img.onerror = () => ok(null);
      img.src = src;
    });
  }

  const st = document.createElement('style');
  st.textContent = `.tw-brand:has(.tw-client) { flex-wrap: wrap; row-gap: 6px; }
.tw-client { flex-basis: 100%; display: flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 600; min-width: 0; color: var(--brand-ink);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-left: 2px; }
.tw-client > span { opacity: .45; font-weight: 400; }
.tw-client img { max-height: 24px; max-width: 150px; object-fit: contain; display: block; }`;
  document.head.append(st);
  window.TwiinMarque = { appliquer, teintes, dominante, contraste, policeUrl, get etat() { return etat; } };
  try { const m = JSON.parse(localStorage.getItem('twiin-marque') || 'null'); if (m) appliquer(m); } catch { /* rien */ }
  fetch('/api/marque').then((r) => r.json()).then((m) => appliquer(m)).catch(() => {});
})();
