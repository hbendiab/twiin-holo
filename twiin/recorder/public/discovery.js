// Découverte de la tâche, vue de l'employé : un écran de chargement par étapes, UNE question
// (« Ai-je bien compris ton problème ? »), puis la solution retenue. Le jumeau et les essais restent côté serveur.
(() => {
  const css = document.createElement('style');
  css.textContent = `
  /* Au style du thème Twiin : carte opaque, au-dessus de tout (sidebar comprise), voile flouté, texte lisible */
  #discovery { position: fixed; inset: 0; z-index: 2000; display: flex; align-items: center; justify-content: center;
    background: rgba(18, 20, 24, .38); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); padding: 24px; }
  #discovery[hidden] { display: none; }
  #discovery.dc-mini { inset: auto 20px 20px auto; background: none; backdrop-filter: none; -webkit-backdrop-filter: none; padding: 0; pointer-events: none; }
  #discovery.dc-mini .dc-card { width: min(380px, calc(100vw - 40px)); pointer-events: auto; padding: 18px 20px 16px; }
  #discovery .dc-card { width: min(640px, 100%); max-height: calc(100vh - 48px); overflow: auto;
    background: var(--panel-solid, #f7f8fa) !important; border: 1px solid var(--panel-border, #e3e6ec); border-radius: 28px;
    box-shadow: 0 40px 90px -30px rgba(20, 30, 60, .55); padding: 30px 32px 26px; font-size: 15.5px; line-height: 1.5; color: var(--text, #16181d);
    animation: dcIn .22s ease-out; }
  @keyframes dcIn { from { opacity: 0; transform: translateY(8px) scale(.985); } }
  #discovery h3 { margin: 0 0 12px; font-size: 24px; font-weight: 800; letter-spacing: -.025em; line-height: 1.2; }
  #discovery p { margin: 8px 0; color: var(--text-dim, #6b7180); }
  #discovery p b { color: var(--text, #16181d); }
  #discovery .dc-pb { color: var(--text, #16181d); font-size: 16.5px; }
  #discovery ol, #discovery ul { margin: 8px 0 10px; padding-left: 22px; }
  #discovery ol li { margin: 4px 0; }
  #discovery .dc-steps { list-style: none; margin: 6px 0 0; padding: 0; }
  #discovery .dc-steps li { display: flex; align-items: center; gap: 12px; padding: 8px 0; color: var(--text-dim, #6b7180); }
  #discovery .dc-steps li.done, #discovery .dc-steps li.active { color: var(--text, #16181d); }
  #discovery .dc-steps li.active { font-weight: 600; }
  #discovery .dc-steps i { width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--line, #d7dae0); flex: none;
    display: grid; place-items: center; font-style: normal; font-size: 12px; }
  #discovery .dc-steps li.done i { background: var(--accent, #121418); border-color: var(--accent, #121418); color: var(--accent-ink, #fff); }
  #discovery .dc-steps li.done i::after { content: '✓'; }
  #discovery .dc-steps li.active i { border-color: var(--blue, #7d9be3); border-top-color: transparent; animation: dcspin .9s linear infinite; }
  @keyframes dcspin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { #discovery .dc-steps li.active i, #discovery .dc-card { animation: none; } }
  #discovery .dc-bar { height: 6px; border-radius: 3px; background: var(--accent-soft, #e8ecf7); overflow: hidden; margin: 2px 0 6px 34px; }
  #discovery .dc-bar span { display: block; height: 100%; background: linear-gradient(90deg, var(--blue, #7d9be3), var(--coral, #e56b6b)); transition: width .4s; }
  #discovery .dc-row { display: flex; gap: 10px; margin-top: 20px; flex-wrap: wrap; }
  #discovery .dc-row button { padding: 12px 20px !important; font-size: 15px !important; }
  /* bouton principal de la popup (la page retire « primary » aux boutons qu'elle ne gère pas) */
  .dc-primary { background: var(--accent, #121418) !important; color: var(--accent-ink, #fff) !important; border-color: var(--accent, #121418) !important;
    font-weight: 600 !important; box-shadow: 0 10px 22px -10px rgba(18, 20, 24, .55) !important; }
  #discovery .dc-table { overflow-x: auto; margin: 8px 0; border-radius: 14px; border: 1px solid var(--line, #e3e6ec); background: var(--panel-2, #fff); }
  #discovery .dc-table table { border-collapse: collapse; font-size: 14px; width: 100%; display: table !important; }
  #discovery .dc-table th { text-align: left; padding: 8px 12px; color: var(--text-dim, #6b7180); font-weight: 600; border-bottom: 1px solid var(--line, #e3e6ec); }
  #discovery .dc-table td { padding: 8px 12px; border-bottom: 1px solid var(--line, #eef0f3); }
  #discovery textarea { width: 100%; min-height: 90px; margin-top: 12px; font: inherit; padding: 12px 14px;
    border-radius: 16px; border: 1px solid var(--panel-border, #e3e6ec); background: var(--panel-2, #fff); color: inherit; box-sizing: border-box; }
  #discovery .dc-doubt { font-size: 14px; padding: 10px 14px; border-radius: 14px; background: var(--warn-soft, #fdf3dc); color: var(--text, #16181d); }`;
  document.head.appendChild(css);

  const box = document.createElement('section');
  box.id = 'discovery';
  box.hidden = true;
  box.setAttribute('aria-live', 'polite');
  box.innerHTML = '<div class="dc-card"></div>';
  document.body.appendChild(box);
  const card = box.querySelector('.dc-card');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let view = null;       // ce qui est affiché : 'loading-1', 'question', 'loading-2', 'solution', 'closed'
  let closedFor = null;  // ne pas rouvrir une solution déjà fermée (même après rechargement)
  try { closedFor = localStorage.getItem('twiin-solution-vue'); } catch { /* stockage bloqué */ }

  // Étapes de chargement : [libellé, phases pendant lesquelles l'étape est en cours]
  const BEFORE = [
    ['Enregistrement reçu', []],
    ['Envoi de la tâche', ['upload']],
    ['Compréhension de ton problème', ['cadrage']],
  ];
  const AFTER = [
    ['Problème confirmé', []],
    ['Twiin teste plusieurs solutions en toute sécurité', ['answered', 'casse']],
    ['Choix de la meilleure solution', []],
  ];

  function inlineProgress(progress) {
    // Après le « oui » : un bandeau dans l'étape Reco (pas une fenêtre), car la recommandation est déjà affichée
    box.hidden = true;
    let host = document.getElementById('dcProgress');
    if (!host) {
      host = document.createElement('section');
      host.id = 'dcProgress';
      host.className = 'panel view';
      host.dataset.view = '3';
      host.style.cssText = 'margin:14px 0;padding:12px 16px;border-radius:12px;display:flex;gap:10px;align-items:center';
      const results = document.getElementById('results');
      (results?.parentNode || document.body).insertBefore(host, results || null);
    }
    const n = progress?.total ? ` (${progress.done}/${progress.total} essais)` : '';
    host.innerHTML = `<span><b>Twiin vérifie cette recommandation</b> en la testant dans un
      environnement isolé${esc(n)}. Le résultat s'affichera ici.</span>`;
  }

  function loading(title, steps, phase, progress) {
    if (steps === AFTER) return inlineProgress(progress);
    box.classList.remove('dc-mini');
    const idx = steps.findIndex(([, ph]) => ph.includes(phase));
    const cur = idx < 0 ? steps.length - 1 : idx;
    const pct = progress?.total ? Math.round((progress.done / progress.total) * 100) : null;
    card.innerHTML = `<h3>${esc(title)}</h3><ul class="dc-steps">${steps.map(([label], i) => `
      <li class="${i < cur ? 'done' : i === cur ? 'active' : ''}"><i></i>${esc(label)}${
        i === cur && pct != null ? ` (${progress.done}/${progress.total})` : ''}</li>${
        i === cur && pct != null ? `<div class="dc-bar"><span style="width:${pct}%"></span></div>` : ''}`).join('')}</ul>
      <p>${steps === AFTER ? 'Ta recommandation s’affiche sur la page. Twiin te prévient quand les tests sont finis.'
                           : 'Tu peux continuer à utiliser la page : Twiin te préviendra.'}</p>
      <div class="dc-row"><button class="dc-hide">Masquer</button></div>`;
    card.querySelector('.dc-hide').onclick = () => { box.hidden = true; view = 'hidden'; };
    if (view !== 'hidden') box.hidden = false;
  }

  async function send(ok, correction) {
    card.querySelectorAll('button').forEach((b) => (b.disabled = true));
    try {
      const r = await fetch('/api/discovery/answer', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                                       body: JSON.stringify({ ok, correction }) });
      if (!r.ok) throw new Error((await r.json()).error || r.statusText);
      if (ok && window.twiinShowResults) {
        await window.twiinShowResults();
        window.twiinGoReco?.(); // directement à l'étape Reco, la recommandation se calcule
      }
      if (ok) { view = 'loading-2'; loading('Merci ! Twiin cherche la meilleure solution', AFTER, 'answered'); }
      else {
        card.innerHTML = '<h3>Merci pour la précision</h3><p>Twiin reprend son analyse avec ta correction.</p>';
        view = 'closed';
        setTimeout(() => { box.hidden = true; }, 5000);
      }
    } catch (e) {
      card.querySelectorAll('button').forEach((b) => (b.disabled = false));
      alert('Envoi impossible : ' + e.message);
    }
  }

  function question(q) {
    view = 'question';
    box.classList.remove('dc-mini');
    card.innerHTML = `
      <h3>${esc(q.titre || 'Ai-je bien compris ton problème ?')}</h3>
      <p class="dc-pb">${esc(q.probleme)}</p>
      ${q.etapes?.length ? `<ol>${q.etapes.map((e) => `<li>${esc(e)}</li>`).join('')}</ol>` : ''}
      ${q.outils?.length ? `<p><b>Outils :</b> ${q.outils.map(esc).join(', ')}</p>` : ''}
      ${q.objectif ? `<p><b>Objectif :</b> ${esc(q.objectif)}</p>` : ''}
      ${q.resultat?.lignes?.length ? `<p><b>Résultat attendu :</b> ${esc(q.resultat.description || '')}</p>
        <div class="dc-table"><table>
          <tr>${(q.resultat.colonnes || Object.keys(q.resultat.lignes[0])).map((c) => `<th>${esc(c)}</th>`).join('')}</tr>
          ${q.resultat.lignes.map((r) => `<tr>${(q.resultat.colonnes || Object.keys(r)).map((c) => `<td>${esc(r[c] ?? '')}</td>`).join('')}</tr>`).join('')}
        </table></div>` : ''}
      ${q.doutes?.length ? `<p class="dc-doubt"><b>À confirmer :</b> ${q.doutes.map(esc).join(' · ')}</p>` : ''}
      <div class="dc-row">
        <button class="dc-primary dc-yes">Oui, c'est bien ça</button>
        <button class="dc-no">Non, je précise</button>
      </div>`;
    card.querySelector('.dc-yes').onclick = () => send(true, '');
    card.querySelector('.dc-no').onclick = () => {
      card.querySelector('.dc-row').outerHTML = `<textarea placeholder="Qu'est-ce qui ne correspond pas ?"></textarea>
        <div class="dc-row"><button class="dc-primary dc-send">Envoyer</button></div>`;
      card.querySelector('.dc-send').onclick = () => send(false, card.querySelector('textarea').value);
    };
    box.hidden = false;
  }

  function solution(s) {
    view = 'solution';
    box.hidden = true;
    document.getElementById('dcProgress')?.remove();
    // Encart dans la page (en haut des résultats de l'étape Reco), pas une fenêtre par-dessus
    let host = document.getElementById('dcSolution');
    if (!host) {
      host = document.createElement('section');
      host.id = 'dcSolution';
      host.className = 'panel';
      host.style.cssText = 'margin:14px 0;padding:16px 18px;border-radius:14px;border:1px solid var(--accent, #0b57d0)';
      const results = document.getElementById('results');
      (results?.parentNode || document.body).insertBefore(host, results || null);
    }
    // « Accélérer » = conseils seulement : on masque l'option et le bouton d'automatisation de l'étape Reco
    if (!document.getElementById('twiinAccStyle')) {
      const st = document.createElement('style');
      st.id = 'twiinAccStyle';
      st.textContent = 'body.twiin-accelerer [data-opt="automatiser"], body.twiin-accelerer .btn-n8n { display: none !important; }';
      document.head.appendChild(st);
    }
    document.body.classList.toggle('twiin-accelerer', s.kind !== 'automate');
    host.dataset.view = '3';
    host.classList.add('view');
    const card = host;
    card.innerHTML = `
      <p class="eyebrow-small">Recommandation vérifiée${s.essais ? ` par ${esc(s.essais)} essais` : ' par des essais'}</p>
      <h3>${s.kind === 'automate' ? 'Twiin peut automatiser cette tâche' : 'Après vérification : accélère cette tâche toi-même'}</h3>
      <p>${esc(s.texte)}</p>
      ${(s.raisons || []).length ? `<details><summary>Pourquoi</summary><ul>${s.raisons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></details>` : ''}
      <p class="dc-msg"></p>
      <div class="dc-row">${s.kind === 'automate' ? '<button class="dc-primary dc-create">Créer cette automatisation</button>' : ''}
        <button class="${s.kind === 'automate' ? '' : 'dc-primary '}dc-ok">${s.kind === 'automate' ? 'Plus tard' : 'Compris'}</button></div>`;
    const create = card.querySelector('.dc-create');
    if (create) create.onclick = async () => {
      const msg = card.querySelector('.dc-msg');
      create.disabled = true;
      msg.textContent = 'Création dans n8n… (Holo lira les sites en arrière-plan, sans prendre ton écran)';
      try {
        const d = await (await fetch('/api/automations/from-discovery', { method: 'POST' })).json();
        if (d.error) throw new Error(d.error);
        msg.innerHTML = `Créée : <b>${esc(d.name)}</b> (${d.blocks.length} blocs). <a href="automatisations.html">Ouvrir Mes automatisations</a>`;
        try { localStorage.setItem('twiin-solution-vue', JSON.stringify(s)); } catch { /* stockage bloqué */ }
        closedFor = JSON.stringify(s);
      } catch (e) { msg.textContent = `Création impossible : ${e.message}`; create.disabled = false; }
    };
    card.querySelector('.dc-ok').onclick = () => { host.remove(); view = 'closed'; closedFor = JSON.stringify(s);
      try { localStorage.setItem('twiin-solution-vue', closedFor); } catch { /* stockage bloqué */ } };
  }

  async function poll() {
    try {
      const d = await (await fetch('/api/discovery')).json();
      const ph = d.phase;
      if (['upload', 'cadrage'].includes(ph) && view !== 'hidden') loading('Twiin étudie ta tâche', BEFORE, ph);
      else if (ph === 'awaiting_confirmation' && d.question && view !== 'question') question(d.question);
      else if (['answered', 'casse'].includes(ph) && view !== 'hidden') loading('Twiin cherche la meilleure solution', AFTER, ph, d.progress);
      else if (ph === 'done' && d.solution && view !== 'solution' && closedFor !== JSON.stringify(d.solution)) solution(d.solution);
      else if (ph === 'error' && view && view !== 'closed') {
        card.innerHTML = '<h3>Twiin n\'a pas pu terminer l\'étude</h3><p>Réessaie avec « Réanalyser ».</p>' +
          '<div class="dc-row"><button class="dc-hide">Fermer</button></div>';
        card.querySelector('.dc-hide').onclick = () => { box.hidden = true; };
        view = 'closed';
        box.hidden = false;
      }
    } catch { /* serveur indisponible : on réessaie */ }
    setTimeout(poll, 2000);
  }
  poll();
})();
