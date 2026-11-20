// Titres courts partout dans le SaaS : tout élément marqué data-court affiche le titre court de son texte
// (« Analyser un cas Awwwards avec Claude et… » → « Inspirations design Awwwards »). Le titre complet reste au survol.
// Les titres déjà raccourcis sont gardés par le serveur (workflows/titres-courts.json) et ici, pour s'afficher sans attendre.
(() => {
  if (window.twiinTitres) return;
  window.twiinTitres = true;
  let memo = {};
  try { memo = JSON.parse(localStorage.getItem('twiin-titres-courts') || '{}'); } catch { /* stockage indisponible */ }
  const garder = () => { try { localStorage.setItem('twiin-titres-courts', JSON.stringify(memo)); } catch { /* idem */ } };
  const poser = (el, long) => {
    const court = memo[long];
    el.dataset.courtOk = '1';
    if (court && court !== long) { if (el.tagName === 'INPUT') el.value = court; else el.textContent = court; el.title = long; }
  };
  let attente = null;
  function passer() {
    attente = null;
    const els = [...document.querySelectorAll('[data-court]:not([data-court-ok])')];
    if (!els.length) return;
    const longs = new Map(els.map((el) => [el, (el.dataset.court || (el.tagName === 'INPUT' ? el.value : el.textContent)).trim()]));
    const manquants = [...new Set([...longs.values()].filter((t) => t && !(t in memo)))];
    for (const [el, t] of longs) if (t in memo) poser(el, t);
    if (!manquants.length) return;
    fetch('/api/titres-courts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ titres: manquants }) })
      .then((r) => r.json()).then((d) => {
        Object.assign(memo, d.titres || {}); garder();
        for (const [el, t] of longs) if (el.isConnected && !el.dataset.courtOk) poser(el, t);
      }).catch(() => { for (const [el] of longs) el.dataset.courtOk = '1'; });
  }
  const plus_tard = () => { if (!attente) attente = setTimeout(passer, 60); };
  new MutationObserver(plus_tard).observe(document.documentElement, { childList: true, subtree: true });
  plus_tard();
})();
