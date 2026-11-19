// Outils communs des pages « Mes vidéos » et « Mes automatisations » : thème, logo animé, logos des outils, formats.
(() => {
  try { if (localStorage.getItem('twiin-theme') === 'dark') document.documentElement.dataset.theme = 'dark'; } catch { /* rien */ }
})();

const escapeHtml = (str) => { const d = document.createElement('div'); d.textContent = str ?? ''; return d.innerHTML; };

function initThemeButton() {
  const btn = document.getElementById('themeBtn');
  if (!btn) return;
  const label = () => { btn.textContent = document.documentElement.dataset.theme === 'dark' ? 'Thème clair' : 'Thème sombre'; };
  btn.addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme !== 'dark';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    try { localStorage.setItem('twiin-theme', dark ? 'dark' : 'light'); } catch { /* rien */ }
    label();
  });
  label();
}

// Le logo : deux cellules collées qui « respirent » (même dessin que la page Twiin).
function initLogo() {
  return; // le logo est désormais la vidéo des deux sphères (shell.js) ; ancien dessin gardé ci-dessous
  const box = document.getElementById('logoCells');
  if (!box) return;
  box.innerHTML = `<svg viewBox="40 40 400 220" aria-hidden="true"><defs><filter id="gooLogo" x="-20%" y="-20%" width="140%" height="140%">
    <feGaussianBlur in="SourceGraphic" stdDeviation="14" result="b"/><feColorMatrix in="b" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 26 -11" result="g"/>
    <feComposite in="SourceGraphic" in2="g" operator="atop"/></filter></defs>
    <g filter="url(#gooLogo)"><circle class="a" cx="200" cy="150" r="66" style="fill:var(--cell-a)"/><circle class="b" cx="280" cy="150" r="66" style="fill:var(--cell-b)"/></g>
    <circle class="na" cx="190" cy="150" r="9" style="fill:var(--nucleus)" opacity=".7"/><circle class="nb" cx="290" cy="150" r="9" style="fill:var(--nucleus)" opacity=".7"/></svg>`;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const [a, b, na, nb] = ['.a', '.b', '.na', '.nb'].map((s) => box.querySelector(s));
  const tick = (t) => {
    const d = 40 + 8 * Math.sin(t / 1400);
    a.setAttribute('cx', 240 - d); b.setAttribute('cx', 240 + d); na.setAttribute('cx', 240 - d - 10); nb.setAttribute('cx', 240 + d + 10);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Logos des outils (icons/icons.json, créé par scripts/fetch_icons.py) ; sans logos, la page marche en texte seul.
let ICONS = [];
const iconsReady = fetch('icons/icons.json').then((r) => r.json()).then((d) => {
  ICONS = (d.icons || []).map((e) => ({ ...e, res: e.aliases.map((x) =>
    new RegExp(`(^|[^\\p{L}\\p{N}])${x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`, 'u')) }));
}).catch(() => {});
function findIcons(text, max = 3) {
  if (!text || !ICONS.length) return [];
  const hits = [];
  for (const e of ICONS) {
    let pos = -1;
    for (const re of e.res) { const m = re.exec(text); if (m && (pos < 0 || m.index < pos)) pos = m.index; }
    if (pos >= 0 && !hits.some((h) => h.e.key === e.key)) hits.push({ e, pos });
  }
  return hits.sort((x, y) => x.pos - y.pos).slice(0, max).map((h) => h.e);
}
const iconImg = (e) => `<img class="ticon" src="icons/${e.file}" alt="" title="${escapeHtml(e.label)}">`;
const iconsHtml = (text, max) => findIcons(text, max).map(iconImg).join('');

// Formats
const fmtDur = (s) => (s == null ? '—' : s >= 60 ? `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')} s` : `${Math.round(s)} s`);
function fmtAgo(iso) {
  if (!iso) return 'jamais';
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'à l\'instant';
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  if (s < 86400 * 7) return `il y a ${Math.round(s / 86400)} j`;
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}
const fmtDate = (iso) => new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

initThemeButton();
initLogo();
