// Découverte de la tâche, vue de l'employé : un écran de chargement par étapes, UNE question
// (« Ai-je bien compris votre problème ? »), puis la solution retenue. Le jumeau et les essais restent côté serveur.
(() => {
  const css = document.createElement('style');
  css.textContent = `
  #discovery { position: fixed; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center;
    background: rgba(15, 18, 24, .45); padding: 16px; }
  #discovery[hidden] { display: none; }
  #discovery.dc-mini { inset: auto 16px 16px auto; background: none; padding: 0; pointer-events: none; }
  #discovery.dc-mini .dc-card { width: min(380px, calc(100vw - 32px)); pointer-events: auto; padding: 14px 16px 12px; }
  #discovery.dc-mini h3 { font-size: 15px; }
  #discovery .dc-card { width: min(520px, 100%); max-height: calc(100vh - 32px); overflow: auto;
    background: var(--panel, #fff); border: 1px solid var(--panel-border, #dadce0); border-radius: 16px;
    box-shadow: 0 16px 40px rgba(0,0,0,.25); padding: 22px 22px 18px; font-size: 14px; color: var(--text, #1f1f1f); }
  #discovery h3 { margin: 0 0 10px; font-size: 18px; }
  #discovery p { margin: 6px 0; color: var(--text-dim, #5f6368); }
  #discovery ol, #discovery ul { margin: 6px 0 8px 18px; padding: 0; }
  #discovery .dc-steps { list-style: none; margin: 4px 0 0; padding: 0; }
  #discovery .dc-steps li { display: flex; align-items: center; gap: 10px; padding: 7px 0; color: var(--text-dim, #5f6368); }
  #discovery .dc-steps li.done { color: var(--text, #1f1f1f); }
  #discovery .dc-steps li.active { color: var(--text, #1f1f1f); font-weight: 600; }
  #discovery .dc-steps i { width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--panel-border, #c4c7c5); flex: none;
    display: grid; place-items: center; font-style: normal; font-size: 11px; }
  #discovery .dc-steps li.done i { background: var(--ok, #188038); border-color: var(--ok, #188038); color: #fff; }
  #discovery .dc-steps li.done i::after { content: '✓'; }
  #discovery .dc-steps li.active i { border-color: var(--accent, #0b57d0); border-top-color: transparent; animation: dcspin .9s linear infinite; }
  @keyframes dcspin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { #discovery .dc-steps li.active i { animation: none; } }
  #discovery .dc-bar { height: 6px; border-radius: 3px; background: var(--accent-soft, #e8f0fe); overflow: hidden; margin: 4px 0 0 28px; }
  #discovery .dc-bar span { display: block; height: 100%; background: var(--accent, #0b57d0); transition: width .4s; }
  #discovery .dc-row { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
  #discovery textarea { width: 100%; min-height: 70px; margin-top: 8px; font: inherit; padding: 8px;
    border-radius: 8px; border: 1px solid var(--panel-border, #dadce0); background: transparent; color: inherit; box-sizing: border-box; }
  #discovery .dc-doubt { font-size: 13px; }`;
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
    ['Compréhension de votre problème', ['cadrage']],
  ];
  const AFTER = [
    ['Problème confirmé', []],
    ['Twiin teste plusieurs solutions en toute sécurité', ['answered', 'casse']],
    ['Choix de la meilleure solution', []],
  ];

  function loading(title, steps, phase, progress) {
    box.classList.toggle('dc-mini', steps === AFTER); // après le « oui » : la page Reco reste utilisable
    const idx = steps.findIndex(([, ph]) => ph.includes(phase));
    const cur = idx < 0 ? steps.length - 1 : idx;
    const pct = progress?.total ? Math.round((progress.done / progress.total) * 100) : null;
    card.innerHTML = `<h3>${esc(title)}</h3><ul class="dc-steps">${steps.map(([label], i) => `
      <li class="${i < cur ? 'done' : i === cur ? 'active' : ''}"><i></i>${esc(label)}${
        i === cur && pct != null ? ` (${progress.done}/${progress.total})` : ''}</li>${
        i === cur && pct != null ? `<div class="dc-bar"><span style="width:${pct}%"></span></div>` : ''}`).join('')}</ul>
      <p>${steps === AFTER ? 'Votre recommandation s’affiche sur la page. Twiin vous prévient quand les tests sont finis.'
                           : 'Vous pouvez continuer à utiliser la page, Twiin vous préviendra.'}</p>
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
        card.innerHTML = '<h3>Merci pour la précision</h3><p>Twiin reprend son analyse avec votre correction.</p>';
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
      <h3>${esc(q.titre || 'Ai-je bien compris votre problème ?')}</h3>
      <p>${esc(q.probleme)}</p>
      ${q.etapes?.length ? `<ol>${q.etapes.map((e) => `<li>${esc(e)}</li>`).join('')}</ol>` : ''}
      ${q.outils?.length ? `<p><b>Outils :</b> ${q.outils.map(esc).join(', ')}</p>` : ''}
      ${q.objectif ? `<p><b>Objectif :</b> ${esc(q.objectif)}</p>` : ''}
      ${q.doutes?.length ? `<p class="dc-doubt"><b>À confirmer :</b> ${q.doutes.map(esc).join(' · ')}</p>` : ''}
      <div class="dc-row">
        <button class="primary dc-yes">Oui, c'est bien ça</button>
        <button class="dc-no">Non, je précise</button>
      </div>`;
    card.querySelector('.dc-yes').onclick = () => send(true, '');
    card.querySelector('.dc-no').onclick = () => {
      card.querySelector('.dc-row').outerHTML = `<textarea placeholder="Qu'est-ce qui ne correspond pas ?"></textarea>
        <div class="dc-row"><button class="primary dc-send">Envoyer</button></div>`;
      card.querySelector('.dc-send').onclick = () => send(false, card.querySelector('textarea').value);
    };
    box.hidden = false;
  }

  function solution(s) {
    view = 'solution';
    box.classList.remove('dc-mini');
    card.innerHTML = `
      <h3>${s.kind === 'automate' ? '⚡ Twiin peut automatiser cette tâche' : '🎬 Twiin propose d\'accélérer cette tâche'}</h3>
      <p>${esc(s.texte)}</p>
      <ul>${(s.raisons || []).map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
      <p class="dc-msg"></p>
      <div class="dc-row">${s.kind === 'automate' ? '<button class="primary dc-create">Créer cette automatisation</button>' : ''}
        <button class="${s.kind === 'automate' ? '' : 'primary '}dc-ok">${s.kind === 'automate' ? 'Plus tard' : 'Compris'}</button></div>`;
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
    card.querySelector('.dc-ok').onclick = () => { box.hidden = true; view = 'closed'; closedFor = JSON.stringify(s);
      try { localStorage.setItem('twiin-solution-vue', closedFor); } catch { /* stockage bloqué */ } };
    box.hidden = false;
  }

  async function poll() {
    try {
      const d = await (await fetch('/api/discovery')).json();
      const ph = d.phase;
      if (['upload', 'cadrage'].includes(ph) && view !== 'hidden') loading('Twiin étudie votre tâche', BEFORE, ph);
      else if (ph === 'awaiting_confirmation' && d.question && view !== 'question') question(d.question);
      else if (['answered', 'casse'].includes(ph) && view !== 'hidden') loading('Twiin cherche la meilleure solution', AFTER, ph, d.progress);
      else if (ph === 'done' && d.solution && view !== 'solution' && closedFor !== JSON.stringify(d.solution)) solution(d.solution);
      else if (ph === 'error' && view && view !== 'closed') {
        card.innerHTML = '<h3>Twiin n\'a pas pu terminer l\'étude</h3><p>Réessayez avec « Réanalyser le dernier enregistrement ».</p>' +
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
