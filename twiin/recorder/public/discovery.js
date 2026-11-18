// « Ai-je bien compris votre problème ? » : seule partie visible de la découverte (le reste tourne côté serveur).
(() => {
  const css = document.createElement('style');
  css.textContent = `
  #discovery { position: fixed; right: 20px; bottom: 20px; width: min(440px, calc(100vw - 32px)); z-index: 50;
    background: var(--panel, #fff); border: 1px solid var(--panel-border, #dadce0); border-radius: 14px;
    box-shadow: 0 10px 30px rgba(0,0,0,.15); padding: 18px 18px 14px; font-size: 14px; color: var(--text, #1f1f1f); }
  #discovery h3 { margin: 0 0 8px; font-size: 16px; }
  #discovery p { margin: 6px 0; color: var(--text-dim, #5f6368); }
  #discovery ol { margin: 6px 0 8px 18px; padding: 0; }
  #discovery .dc-row { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
  #discovery textarea { width: 100%; min-height: 70px; margin-top: 8px; font: inherit; padding: 8px;
    border-radius: 8px; border: 1px solid var(--panel-border, #dadce0); background: transparent; color: inherit; box-sizing: border-box; }
  #discovery .dc-doubt { font-size: 13px; }`;
  document.head.appendChild(css);

  const box = document.createElement('section');
  box.id = 'discovery';
  box.hidden = true;
  box.setAttribute('aria-live', 'polite');
  document.body.appendChild(box);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let shownFor = null;

  async function send(ok, correction) {
    box.querySelectorAll('button').forEach((b) => (b.disabled = true));
    try {
      const r = await fetch('/api/discovery/answer', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                                       body: JSON.stringify({ ok, correction }) });
      if (!r.ok) throw new Error((await r.json()).error || r.statusText);
      if (ok && window.twiinShowResults) window.twiinShowResults();
      box.innerHTML = ok
        ? '<h3>Merci !</h3><p>Twiin prépare la meilleure solution pour cette tâche. Vous serez prévenu dès qu\'elle est prête.</p>'
        : '<h3>Merci pour la précision</h3><p>Twiin reprend son analyse avec votre correction.</p>';
      setTimeout(() => { box.hidden = true; }, 6000);
    } catch (e) {
      box.querySelectorAll('button').forEach((b) => (b.disabled = false));
      alert('Envoi impossible : ' + e.message);
    }
  }

  function show(q) {
    const key = JSON.stringify(q);
    if (shownFor === key) return;
    shownFor = key;
    box.innerHTML = `
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
    box.querySelector('.dc-yes').onclick = () => send(true, '');
    box.querySelector('.dc-no').onclick = () => {
      const row = box.querySelector('.dc-row');
      row.outerHTML = `<textarea placeholder="Qu'est-ce qui ne correspond pas ?"></textarea>
        <div class="dc-row"><button class="primary dc-send">Envoyer</button></div>`;
      box.querySelector('.dc-send').onclick = () => send(false, box.querySelector('textarea').value);
    };
    box.hidden = false;
  }

  async function poll() {
    try {
      const d = await (await fetch('/api/discovery')).json();
      if (d.phase === 'awaiting_confirmation' && d.question) show(d.question);
    } catch { /* serveur indisponible : on réessaie */ }
    setTimeout(poll, 4000);
  }
  poll();
})();
