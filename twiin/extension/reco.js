// Twiin · « Reco » dans le panneau : verdict Accélérer / Automatiser, conseils « pour aller plus vite », coût discret.
// Même logique que la page web (recorder/public/app.js) : /api/process-advice + /api/verdict en parallèle, résultat gardé par tâche
// (même tâche, mêmes étapes = pas de nouvel appel au modèle), puis enregistré avec /api/recommendations.
// Module à part : panel.js lui donne l'accès au serveur (config) et lui demande le HTML du bloc (html) et le bouton à mettre en avant (primary).
const Reco = (() => {
  let api = null, onUpdate = () => {};
  const mem = new Map(); // clé de tâche → { status: 'running' | 'done' | 'error', ver, adv, error }
  const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0);
  const key = (t) => `twiin-reco-${t.session || ''}-${hash(JSON.stringify([t.name, t.steps]))}`;
  const isAuto = (ver) => /automat/i.test(ver?.verdict || '');
  const readCache = (k) => { try { const v = JSON.parse(localStorage.getItem(k)); return Array.isArray(v) && v[0] && v[1] ? v : null; } catch { return null; } };
  const writeCache = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage plein ou bloqué : tant pis */ } };

  function config(o) { api = o.api; onUpdate = o.onUpdate || onUpdate; }

  async function run(t) {
    if (!t || !api) return;
    const k = key(t);
    if (mem.get(k)?.status === 'running') return;
    const cached = readCache(k);
    if (cached) { mem.set(k, { status: 'done', adv: cached[0], ver: cached[1] }); return onUpdate(); }
    mem.set(k, { status: 'running' });
    onUpdate();
    try {
      const post = (path) => api(path, { method: 'POST', body: { workflow: t } }).then((d) => { if (!d || d.error) throw new Error(d?.error || 'pas de réponse'); return d; });
      const [adv, ver] = await Promise.all([post('/api/process-advice'), post('/api/verdict')]);
      mem.set(k, { status: 'done', adv, ver });
      writeCache(k, [adv, ver]);
      // gardée côté serveur (base de l'équipe), rattachée à la tâche ; un échec ici ne gêne pas l'affichage
      Promise.resolve(api('/api/recommendations', { method: 'POST', body: { task_id: t.task_id || null, verdict: ver, advice: adv } })).catch(() => {});
    } catch (e) {
      mem.set(k, { status: 'error', error: e.message || String(e) });
    }
    onUpdate();
  }

  const state = (t) => (t ? mem.get(key(t)) : null) || { status: 'idle' };
  // 'auto' | 'tuto' | null : quel bouton la recommandation met en avant
  const primary = (t) => { const s = state(t); return s.status === 'done' ? (isAuto(s.ver) ? 'auto' : 'tuto') : null; };
  const cost = (s) => [s.adv?.cost_usd, s.ver?.cost_usd].filter((x) => typeof x === 'number').reduce((a, b) => a + b, 0);

  function html(t) {
    const s = state(t);
    if (s.status === 'idle') return `<button class="b reco-go" data-act="reco" type="button">Voir la recommandation</button>`;
    if (s.status === 'running') return `<div class="reco"><p class="sub"><span class="spin"></span>Twiin prépare sa recommandation…</p></div>`;
    if (s.status === 'error') {
      return `<div class="reco"><h4>Recommandation impossible</h4><p class="sub">${esc(s.error.length > 160 ? s.error.slice(0, 160) + '…' : s.error)}</p>
        <button class="b" data-act="reco" type="button">Réessayer</button></div>`;
    }
    const { ver, adv } = s;
    const gain = [ver.time_saved ? `Gain estimé : ${esc(ver.time_saved)}` : '', ver.frequency_hint ? esc(ver.frequency_hint) : ''].filter(Boolean).join(' · ');
    const reasons = (ver.reasons || []).map((x) => `<li>${esc(x)}</li>`).join('');
    const recos = (adv?.recommendations || []).map((x) => `<li><b>${esc(x.title || '')}</b>${x.gain ? ` <span class="gain">${esc(x.gain)}</span>` : ''}
      <div>${esc(x.suggestion || '')}</div></li>`).join('');
    const c = cost(s);
    return `<div class="reco"><p class="eyebrow">Twiin te recommande</p>
      <h4>${isAuto(ver) ? 'Automatiser cette tâche' : 'Accélérer cette tâche'}</h4>
      ${gain ? `<p class="sub">${gain}</p>` : ''}
      <details class="more"><summary>Pourquoi ?</summary>
        ${reasons ? `<ul class="reasons">${reasons}</ul>` : ''}
        ${recos ? `<h5>Pour aller plus vite</h5><ol class="recos">${recos}</ol>` : ''}
        ${c > 0 ? `<p class="cost">≈ ${c.toFixed(3).replace('.', ',')} $</p>` : ''}
      </details></div>`;
  }

  return { config, run, html, primary, state, key };
})();
