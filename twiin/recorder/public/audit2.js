// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// ÉTAPE 1 · AUDIT v2 (twiin/audit/CLAUDE.md)
//   temps 1 : audit passif des outils (automatique), animé par la sphère de logos
//   temps 2 : questions guidées, clic pour le structuré, voix pour le qualitatif (Q7) ; « Autre » / « Je ne sais pas »
//             partout ; Q5 à Q7 seulement sur les 3 tâches les plus lourdes ; brouillon gardé à chaque écran
//   temps 3 : résultat, top 3 en heures/semaine et euros/an, alertes de croisement
// Les suggestions viennent du temps 1 ou de la bibliothèque (serveur) : rien n'est inventé ici.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
(() => {
  const $ = (id) => document.getElementById(id);
  const screenEl = $('a2Screen');
  const FREQ = [['1', '1 fois'], ['2-5', '2 à 5'], ['6-20', '6 à 20'], ['20+', 'Plus de 20'], ['je_ne_sais_pas', 'Je ne sais pas']];
  const DUREE = [['<5', '< 5 min'], ['5-15', '5 à 15 min'], ['15-30', '15 à 30 min'], ['30-60', '30 à 60 min'], ['>60', '> 1 h'], ['je_ne_sais_pas', 'Je ne sais pas']];
  const DECL = [['mail', 'Un mail'], ['date', 'Une date'], ['demande_collegue', "Une demande d'un collègue"], ['document_recu', 'Un document reçu'],
                ['autre', 'Autre'], ['je_ne_sais_pas', 'Je ne sais pas']];
  const RECOPIE = [[true, 'Oui, je recopie'], [false, 'Non'], [null, 'Je ne sais pas']];
  const RECO = { automatiser: 'À automatiser', simplifier_d_abord: "À simplifier d'abord", ne_pas_automatiser: 'Pas rentable à automatiser', a_preciser: 'À préciser' };
  const RECO_WHY = { simplifier_d_abord: 'trop de cas particuliers ou de décisions au cas par cas', ne_pas_automatiser: "moins d'une heure par semaine",
                     a_preciser: 'fréquence ou durée « je ne sais pas »' };
  const label = (list, v) => (list.find(([k]) => k === v) || [, ''])[1];

  // État : réponses (brouillon serveur), questions pré-remplies, outils du temps 1
  const st = { screen: 'intro', rep: {}, q: null, roles: [], outils: null, lourdes: [], idx: 0, dirigeant: null };
  const r = () => st.rep;

  // ── voix : la question est lue (si l'employé le veut) ; tout marche au clic sans la voix ─────────────────────────
  let voiceOn = false;
  try { voiceOn = localStorage.getItem('twiin-a2-voix') === '1'; } catch { /* rien */ }
  $('a2Voice').checked = voiceOn;
  $('a2Voice').addEventListener('change', () => { voiceOn = $('a2Voice').checked; try { localStorage.setItem('twiin-a2-voix', voiceOn ? '1' : '0'); } catch { /* rien */ } if (voiceOn) say(); });
  let audio = null, spoken = '';
  function say(text = spoken) {
    if (!text) return;
    audio?.pause();
    audio = new Audio(`/api/voice/say?text=${encodeURIComponent(text)}`);
    audio.play().catch(() => {});
  }
  $('a2Listen').addEventListener('click', () => say());

  // ── sphère de logos pendant le temps 1 ──────────────────────────────────────────────────────────────────────────
  let sphere = null;
  function sphereShow(images, opts) {
    if (!window.TwiinUI || !images.length) return;
    $('sphereBox').hidden = false;
    const props = { images, variant: 'logo', autoRotate: true, dragSensitivity: 0.8, momentumDecay: 0.96, maxRotationSpeed: 6,
                    baseImageScale: 0.15, hoverScale: 1.3, perspective: 1000, maxSize: 400, ...opts };
    if (sphere) sphere.update(props); else sphere = window.TwiinUI.mountSphere($('scanSphere'), props);
  }
  function sphereSearching() {
    const pool = [...ICONS].sort(() => Math.random() - 0.5).slice(0, 60);
    sphereShow(pool.map((e) => ({ id: e.key, src: `icons/${e.file}`, alt: e.label, title: e.label, weight: 0.5 })), { autoRotateSpeed: 1.4 });
    $('sphereCaption').textContent = 'Twiin regarde les outils de ton poste…';
  }
  function sphereResult(apps) {
    const withLogo = apps.map((a) => ({ a, e: findIcons(a.nom, 1)[0] })).filter((x) => x.e);
    if (!withLogo.length) { $('sphereBox').hidden = true; return; }
    const max = Math.max(1, ...withLogo.map((x) => x.a.usage?.jours_utilises_30 || 0));
    const fill = [];
    for (let k = 0; fill.length < Math.max(36, withLogo.length); k++) fill.push(...withLogo.map((x) => ({ ...x, k })));
    sphereShow(fill.map(({ a, e, k }) => ({ id: `${a.id}-${k}`, src: `icons/${e.file}`, alt: a.nom, title: a.nom,
      description: a.usage?.jours_utilises_30 != null ? `Ouvert ${a.usage.jours_utilises_30} jours sur les 30 derniers` : '',
      weight: (a.usage?.jours_utilises_30 || 0) / max })), { autoRotateSpeed: 0.2 });
    $('sphereCaption').textContent = `${withLogo.length} outils de travail repérés. Ils servent à la question suivante.`;
  }

  // ── serveur ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const api = async (url, body) => {
    const res = await fetch(url, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await res.json();
    if (d.error) throw new Error(d.error);
    return d;
  };
  const save = () => api('/api/onboarding/reponses', st.rep).catch(() => {});
  async function loadQuestions() {
    const d = await api(`/api/onboarding/questions?role=${encodeURIComponent(r().role_metier || '')}`);
    st.q = d.questions; st.roles = d.roles;
  }

  // ── parcours : la liste des écrans dépend des réponses (Q5-Q7 pour chacune des 3 tâches les plus lourdes) ────────
  function screens() {
    const list = ['intro', 'role', 'q1', 'q2', 'q34'];
    st.lourdes.forEach((id, i) => list.push(`q567:${i}`));
    if ((r().taches || []).length) list.push('q8');
    list.push('recap');
    return list;
  }
  function progress() {
    const list = screens();
    const i = Math.max(0, list.indexOf(st.screen));
    const done = st.screen === 'resultat' ? 1 : i / (list.length - 1);
    $('a2Bar').style.width = `${Math.round(done * 100)}%`;
    const left = st.screen === 'resultat' ? 0 : Math.max(1, Math.round((1 - done) * 7));
    $('a2Meta').textContent = st.screen === 'resultat' ? 'Terminé' : st.screen === 'intro' ? 'Environ 7 min' : `Étape ${i} sur ${list.length - 1} · environ ${left} min restantes`;
  }
  function go(screen) {
    st.screen = screen;
    render();
    $('a2').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function nextScreen() {
    const list = screens();
    const i = list.indexOf(st.screen);
    return list[i + 1];
  }
  $('a2Back').addEventListener('click', () => {
    const list = screens();
    const i = list.indexOf(st.screen);
    if (st.screen === 'resultat') return go('recap');
    if (i > 0) go(list[i - 1]);
  });
  $('a2Next').addEventListener('click', async () => {
    const ok = await (VALIDATE[st.screen.split(':')[0]] || (() => true))();
    if (!ok) return;
    save();
    const nxt = nextScreen();
    if (nxt) go(nxt);
  });

  // ── écrans ──────────────────────────────────────────────────────────────────────────────────────────────────────
  const chip = (attrs, text, on) => `<button type="button" class="a2-chip" ${attrs} aria-pressed="${on ? 'true' : 'false'}">${escapeHtml(text)}</button>`;
  const head = (q, help = '') => { spoken = q; return `<h3 class="a2-q">${escapeHtml(q)}</h3>${help ? `<p class="a2-help">${help}</p>` : ''}`; };
  const toolIcon = (nom) => { const e = findIcons(nom, 1)[0]; return e ? `<img src="icons/${e.file}" alt="">` : `<span class="noicon">${escapeHtml((nom || '?')[0])}</span>`; };
  const tache = (id) => (r().taches || []).find((t) => t.id === id);
  const outilsChoisis = () => {
    const opts = st.q?.q1_outils.options || [];
    const conf = r().outils_confirmes;
    const base = opts.filter((o) => !conf || conf.includes(o.application_id)).map((o) => ({ id: o.application_id, nom: o.nom }));
    return [...base, ...(r().outils_ajoutes || [])];
  };

  const RENDER = {
    async intro() {
      const reprise = (r().taches || []).length || r().role_metier;
      const nav = st.dirigeant?.sources_autorisees || [];
      const navOk = nav.includes('historique_navigateur');
      screenEl.innerHTML = `<div class="a2-intro">${head('On commence par tes outils, puis quelques questions.')}
        <ol><li><b>Twiin regarde les outils de ton poste</b> : c'est automatique.</li>
            <li><b>Quelques questions sur tes tâches</b> : surtout des clics, la voix seulement si tu veux.</li>
            <li><b>Ton résultat</b> : les 3 tâches qui te coûtent le plus de temps, en heures et en euros.</li></ol>
        <div class="a2-consent">
          <label class="check"><input type="checkbox" id="a2Usage" ${r().consent_usage !== false ? 'checked' : ''}> Compter les jours d'utilisation de mes applis sur 30 jours
            (jamais ce que j'y fais)</label>
          <label class="check"><input type="checkbox" id="a2Nav" ${navOk && r().consent_navigateur !== false ? 'checked' : ''} ${navOk ? '' : 'disabled'}>
            Repérer les outils pro que j'utilise dans Chrome (seulement les sites métier connus, jamais les pages visitées)
            ${navOk ? '' : '<small style="color:var(--text-dim)">· non autorisé par ton entreprise</small>'}</label>
        </div>
        ${reprise ? '<p class="a2-help">Tu avais commencé : tes réponses sont gardées, tu reprends où tu en étais.</p>' : ''}</div>`;
      $('a2Next').textContent = st.outils?.applications?.length ? 'Refaire l\'audit des outils' : 'Lancer l\'audit';
      if (st.outils?.applications?.length) {
        screenEl.insertAdjacentHTML('beforeend', '<div class="a2-input"><button type="button" id="a2Skip">Garder l\'audit déjà fait et continuer →</button></div>');
        $('a2Skip').onclick = () => go('role');
      }
    },
    role() {
      const roles = st.roles || [];
      const cur = r().role_metier || '';
      const autre = cur && !roles.includes(cur);
      screenEl.innerHTML = `${head('Quel est ton rôle ?', 'Il sert à te proposer des tâches typiques de ton métier.')}
        <div class="a2-chips">${roles.map((x) => chip(`data-role="${escapeHtml(x)}"`, x, cur === x)).join('')}${chip('data-role="__autre"', 'Autre', autre)}</div>
        <div class="a2-input" ${autre ? '' : 'hidden'} id="a2RoleOther"><input id="a2RoleText" placeholder="Ton rôle, en quelques mots" value="${autre ? escapeHtml(cur) : ''}"></div>`;
      screenEl.querySelectorAll('[data-role]').forEach((b) => b.onclick = () => {
        const v = b.dataset.role;
        $('a2RoleOther').hidden = v !== '__autre';
        r().role_metier = v === '__autre' ? $('a2RoleText').value.trim() : v;
        screenEl.querySelectorAll('[data-role]').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
      });
      $('a2RoleText').oninput = () => { r().role_metier = $('a2RoleText').value.trim(); };
    },
    q1() {
      const opts = st.q.q1_outils.options;
      if (!r().outils_confirmes) r().outils_confirmes = opts.map((o) => o.application_id); // cochés par défaut
      const conf = new Set(r().outils_confirmes);
      screenEl.innerHTML = `${head(st.q.q1_outils.question, 'Ils ont été repérés sur ton poste, les plus utilisés d\'abord. Décoche ceux qui ne servent pas à ton travail.')}
        <div class="a2-grid">${opts.map((o) => `<button type="button" class="a2-tool" data-app="${o.application_id}" aria-pressed="${conf.has(o.application_id)}">
            ${toolIcon(o.nom)}<span>${escapeHtml(o.nom)}</span>${o.usage?.jours_utilises_30 != null ? `<small>${o.usage.jours_utilises_30} j / 30</small>` : ''}</button>`).join('')}
          ${(r().outils_ajoutes || []).map((o) => `<button type="button" class="a2-tool" data-added="${o.id}" aria-pressed="true">${toolIcon(o.nom)}<span>${escapeHtml(o.nom)}</span><small>ajouté</small></button>`).join('')}
        </div>
        <div class="a2-input"><input id="a2AddTool" list="a2ToolList" placeholder="+ Ajouter un outil absent de la liste"><button type="button" id="a2AddBtn">Ajouter</button></div>
        <datalist id="a2ToolList">${ICONS.map((e) => `<option value="${escapeHtml(e.label)}">`).join('')}</datalist>`;
      screenEl.querySelectorAll('[data-app]').forEach((b) => b.onclick = () => {
        const id = b.dataset.app, s = new Set(r().outils_confirmes);
        s.has(id) ? s.delete(id) : s.add(id);
        r().outils_confirmes = [...s];
        b.setAttribute('aria-pressed', s.has(id) ? 'true' : 'false');
      });
      screenEl.querySelectorAll('[data-added]').forEach((b) => b.onclick = () => { r().outils_ajoutes = (r().outils_ajoutes || []).filter((o) => o.id !== b.dataset.added); RENDER.q1(); });
      const add = () => {
        const nom = $('a2AddTool').value.trim();
        if (!nom) return;
        const id = nom.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        if (!(r().outils_ajoutes || []).some((o) => o.id === id)) r().outils_ajoutes = [...(r().outils_ajoutes || []), { id, nom }];
        RENDER.q1();
      };
      $('a2AddBtn').onclick = add;
      $('a2AddTool').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
    },
    q2() {
      const opts = st.q.q2_taches.options;
      const cur = r().taches || [];
      const has = (sid) => cur.some((t) => t.suggestion_id === sid);
      const libres = cur.filter((t) => t.source === 'saisie_libre');
      screenEl.innerHTML = `${head(st.q.q2_taches.question, 'Coche celles qui te parlent. Si une tâche manque, ajoute-la avec « Autre ».')}
        <div class="a2-cards">${opts.map((o) => `<button type="button" class="a2-card" data-sug="${o.suggestion_id}" aria-pressed="${has(o.suggestion_id)}">
            <span class="box">${has(o.suggestion_id) ? '✓' : ''}</span><span>${escapeHtml(o.libelle)}</span>
            <span class="icons">${(o.applis_detectees.length ? o.applis_detectees : o.applis_typiques).slice(0, 3).map((a) => { const e = findIcons(a.replace(/-/g, ' '), 1)[0]; return e ? `<img src="icons/${e.file}" alt="">` : ''; }).join('')}</span></button>`).join('')}
          ${libres.map((t) => `<button type="button" class="a2-card" data-free="${t.id}" aria-pressed="true"><span class="box">✓</span><span>${escapeHtml(t.libelle)}</span><span class="icons" style="font-size:12px;color:var(--text-dim)">ajoutée</span></button>`).join('')}
        </div>
        <div class="a2-input"><input id="a2Other" placeholder="Autre tâche : écris-la ou dicte-la"><button type="button" id="a2OtherMic">🎙 Dicter</button><button type="button" id="a2OtherAdd">Ajouter</button></div>
        <p class="a2-help" style="margin-top:10px"><button type="button" class="a2-chip dim" id="a2NoTask">Je ne sais pas, aucune de celles-ci</button></p>`;
      screenEl.querySelectorAll('[data-sug]').forEach((b) => b.onclick = () => {
        const o = opts.find((x) => x.suggestion_id === b.dataset.sug);
        if (has(o.suggestion_id)) r().taches = (r().taches || []).filter((t) => t.suggestion_id !== o.suggestion_id);
        else r().taches = [...(r().taches || []), { id: `t_${o.suggestion_id}`, libelle: o.libelle, source: 'suggestion', suggestion_id: o.suggestion_id,
                                                    applis_ids: o.applis_detectees.filter((a) => outilsChoisis().some((x) => x.id === a)) }];
        RENDER.q2();
      });
      screenEl.querySelectorAll('[data-free]').forEach((b) => b.onclick = () => { r().taches = (r().taches || []).filter((t) => t.id !== b.dataset.free); RENDER.q2(); });
      const add = () => {
        const lib = $('a2Other').value.trim();
        if (!lib) return;
        r().taches = [...(r().taches || []), { id: `t_libre_${Date.now().toString(36)}`, libelle: lib, source: 'saisie_libre', applis_ids: [] }];
        RENDER.q2();
      };
      $('a2OtherAdd').onclick = add;
      $('a2Other').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
      $('a2OtherMic').onclick = () => dictate($('a2Other'), $('a2OtherMic'), 'taches');
      $('a2NoTask').onclick = () => { r().taches = []; r().aucune_tache = true; save(); go('recap'); };
    },
    q34() {
      const ts = r().taches || [];
      spoken = 'Pour chaque tâche : combien de fois par semaine, et combien de temps à chaque fois ?';
      screenEl.innerHTML = `${head(spoken, 'Un clic par ligne suffit. « Je ne sais pas » est une réponse valable.')}
        ${ts.map((t) => `<div class="a2-row"><b>${escapeHtml(t.libelle)}</b>
          <div class="lbl">Combien de fois par semaine ?</div><div class="a2-chips">${FREQ.map(([k, l]) => chip(`data-t="${t.id}" data-f="${k}"`, l, t.frequence_tranche === k)).join('')}</div>
          <div class="lbl">Combien de temps à chaque fois ?</div><div class="a2-chips">${DUREE.map(([k, l]) => chip(`data-t="${t.id}" data-d="${k}"`, l, t.duree_tranche === k)).join('')}</div></div>`).join('')}`;
      screenEl.querySelectorAll('[data-f],[data-d]').forEach((b) => b.onclick = () => {
        const t = tache(b.dataset.t);
        if (b.dataset.f) t.frequence_tranche = b.dataset.f; else t.duree_tranche = b.dataset.d;
        b.parentElement.querySelectorAll('.a2-chip').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
      });
    },
    q567(i) {
      const t = tache(st.lourdes[i]);
      if (!t) return go('q8');
      const tools = outilsChoisis();
      const order = t.applis_ids || [];
      spoken = `Pour « ${t.libelle} » : quels outils ouvres-tu, dans l'ordre ? Recopies-tu des infos de l'un à l'autre ?`;
      screenEl.innerHTML = `<p class="a2-help" style="margin:0 0 4px">Tâche ${i + 1} sur ${st.lourdes.length} parmi les plus lourdes</p>
        <h3 class="a2-q">${escapeHtml(t.libelle)}</h3>
        <div class="a2-row"><b>Quels outils ouvres-tu pour cette tâche ? Clique-les dans l'ordre.</b>
          <div class="a2-grid">${tools.map((o) => { const k = order.indexOf(o.id); return `<button type="button" class="a2-tool" data-tool="${o.id}" aria-pressed="${k >= 0}">${k >= 0 ? `<span class="rank">${k + 1}</span>` : ''}${toolIcon(o.nom)}<span>${escapeHtml(o.nom)}</span></button>`; }).join('')}</div>
          <div class="lbl">Recopies-tu des informations d'un outil à l'autre ?</div>
          <div class="a2-chips">${RECOPIE.map(([v, l]) => chip(`data-rec="${v}"`, l, t.recopie === v || (v === null && t.recopie === null))).join('')}</div></div>
        <div class="a2-row"><b>Qu'est-ce qui la déclenche ?</b>
          <div class="a2-chips">${DECL.map(([k, l]) => chip(`data-decl="${k}"`, l, t.declencheur === k)).join('')}</div>
          <div class="a2-input" ${t.declencheur === 'autre' ? '' : 'hidden'} id="a2DeclOther"><input id="a2DeclText" placeholder="Ce qui la déclenche" value="${escapeHtml(t.declencheur_autre || '')}"></div></div>
        <div class="a2-row"><b>Que se passe-t-il quand ça ne se passe pas comme d'habitude ? <span style="font-weight:400;color:var(--text-dim)">(facultatif)</span></b>
          <p class="a2-help" style="margin:0 0 6px">Raconte à voix haute ou écris. Ta réponse reste sur ce poste.</p>
          <textarea id="a2Exc" placeholder="Par exemple : il manque une pièce, je relance par mail…">${escapeHtml(t.exceptions_transcript || '')}</textarea>
          <div class="a2-input"><button type="button" id="a2ExcMic">🎙 Répondre à voix haute</button></div></div>`;
      screenEl.querySelectorAll('[data-tool]').forEach((b) => b.onclick = () => {
        const id = b.dataset.tool;
        t.applis_ids = order.includes(id) ? order.filter((x) => x !== id) : [...order, id];
        RENDER.q567(i);
      });
      screenEl.querySelectorAll('[data-rec]').forEach((b) => b.onclick = () => {
        t.recopie = b.dataset.rec === 'true' ? true : b.dataset.rec === 'false' ? false : null;
        b.parentElement.querySelectorAll('.a2-chip').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
      });
      screenEl.querySelectorAll('[data-decl]').forEach((b) => b.onclick = () => {
        t.declencheur = b.dataset.decl;
        $('a2DeclOther').hidden = t.declencheur !== 'autre';
        b.parentElement.querySelectorAll('.a2-chip').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
      });
      $('a2DeclText').oninput = () => { t.declencheur_autre = $('a2DeclText').value; };
      $('a2Exc').oninput = () => { t.exceptions_transcript = $('a2Exc').value; };
      $('a2ExcMic').onclick = () => dictate($('a2Exc'), $('a2ExcMic'), 'q7', (txt) => { t.exceptions_transcript = txt; });
    },
    q8() {
      const ts = r().taches || [];
      const cur = ts.find((t) => t.deleguer_en_premier)?.id || (r().deleguer_aucune ? '__nsp' : '');
      screenEl.innerHTML = `${head('Si tu pouvais déléguer une seule tâche demain, laquelle ?')}
        <div class="a2-cards">${ts.map((t) => `<button type="button" class="a2-card" data-del="${t.id}" aria-pressed="${cur === t.id}"><span class="box">${cur === t.id ? '✓' : ''}</span><span>${escapeHtml(t.libelle)}</span></button>`).join('')}
          <button type="button" class="a2-card" data-del="__nsp" aria-pressed="${cur === '__nsp'}"><span class="box">${cur === '__nsp' ? '✓' : ''}</span><span>Je ne sais pas</span></button></div>`;
      screenEl.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => {
        ts.forEach((t) => { t.deleguer_en_premier = t.id === b.dataset.del; });
        r().deleguer_aucune = b.dataset.del === '__nsp';
        RENDER.q8();
      });
    },
    recap() {
      const ts = r().taches || [];
      const tools = outilsChoisis();
      const edit = (s) => `<a href="#" class="edit" data-go="${s}">Modifier</a>`;
      spoken = "Voici ce qu'on a compris. Tu peux tout modifier avant d'envoyer.";
      screenEl.innerHTML = `<div class="a2-recap">${head("Voici ce qu'on a compris", 'Vérifie, modifie si besoin, puis envoie.')}
        <dl>
          <dt>Ton rôle ${edit('role')}</dt><dd>${escapeHtml(r().role_metier || 'non précisé')}</dd>
          <dt>Tes outils de travail ${edit('q1')}</dt><dd><div class="apps-strip" style="margin:0">${tools.map((o) => `<span class="app-pill">${toolIcon(o.nom).replace('<img', '<img class="ticon"')}${escapeHtml(o.nom)}</span>`).join('') || '—'}</div></dd>
          <dt>Tes tâches de la semaine ${edit('q2')}</dt><dd>${ts.length ? ts.map((t) => `<div><b>${escapeHtml(t.libelle)}</b> · ${escapeHtml(label(FREQ, t.frequence_tranche) || '?')} fois, ${escapeHtml(label(DUREE, t.duree_tranche) || '?')} ${edit('q34')}</div>`).join('') : 'aucune'}</dd>
          ${st.lourdes.map((id, i) => { const t = tache(id); if (!t) return ''; const apps = (t.applis_ids || []).map((a) => tools.find((o) => o.id === a)?.nom || a);
            return `<dt>Détail : ${escapeHtml(t.libelle)} ${edit(`q567:${i}`)}</dt><dd>${apps.length ? escapeHtml(apps.join(' → ')) : 'outils non précisés'}
              · ${t.recopie === true ? 'recopie entre outils' : t.recopie === false ? 'pas de recopie' : 'recopie : ?'}
              · déclenchée par : ${escapeHtml(t.declencheur === 'autre' ? t.declencheur_autre || 'autre' : label(DECL, t.declencheur) || '?')}
              ${t.exceptions_transcript ? `<br><span style="color:var(--text-dim)">« ${escapeHtml(t.exceptions_transcript)} »</span>` : ''}</dd>`; }).join('')}
          <dt>À déléguer en premier ${edit('q8')}</dt><dd>${escapeHtml(ts.find((t) => t.deleguer_en_premier)?.libelle || 'je ne sais pas')}</dd>
        </dl></div>`;
      screenEl.querySelectorAll('[data-go]').forEach((a) => a.onclick = (e) => { e.preventDefault(); go(a.dataset.go); });
      $('a2Next').textContent = 'Envoyer et voir mon top 3';
    },
    async resultat() {
      screenEl.innerHTML = '<p class="a2-help">Calcul de ton résultat…</p>';
      let d;
      try { d = await api('/api/audit/resultat'); } catch (e) { screenEl.innerHTML = `<p class="a2-help">Résultat impossible : ${escapeHtml(e.message)}</p>`; return; }
      const f = d.fiche;
      const byId = Object.fromEntries((f.taches || []).map((t) => [t.id, t]));
      const top = f.opportunites.filter((o) => o.a_observer);
      const autres = f.opportunites.filter((o) => !o.a_observer);
      const hTop = top.reduce((n, o) => n + (o.gain_heures_semaine || 0), 0);
      const eTop = top.reduce((n, o) => n + (o.gain_euros_an || 0), 0);
      const fmtE = (x) => `${Math.round(x).toLocaleString('fr-FR')} €`;
      spoken = top.length ? `Voici les ${top.length} tâches qui te coûtent le plus de temps.` : "On n'a pas trouvé de tâche assez lourde pour être automatisée.";
      screenEl.innerHTML = `${head(top.length ? `Ton top ${top.length} des tâches à automatiser` : 'Pas de tâche assez lourde à automatiser pour l\'instant')}
        ${top.length ? `<p class="a2-total">Ensemble, elles représentent <b>${hTop.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} h par semaine</b>, soit environ <b>${fmtE(eTop)} par an</b>
          (au coût horaire de ${f.dirigeant?.cout_horaire ?? 35} €).</p>` : ''}
        <div class="a2-top3">${top.map((o, k) => `<div class="a2-opp"><span class="n">N° ${k + 1}</span><b>${escapeHtml(byId[o.tache_id]?.libelle || o.tache_id)}</b>
            <span class="big">${(o.gain_heures_semaine ?? 0).toLocaleString('fr-FR')} h <small>par semaine</small></span>
            <span class="eur">≈ ${fmtE(o.gain_euros_an || 0)} par an</span>
            <span class="tags">Automatisation ${o.tranche_facilite === 'facile' ? 'facile' : o.tranche_facilite === 'moyen' ? 'moyennement facile' : 'difficile'}${byId[o.tache_id]?.deleguer_en_premier ? ' · celle que tu délèguerais en premier' : ''}</span>
            <button type="button" data-observe="${o.tache_id}">Observer cette tâche</button></div>`).join('')}</div>
        ${autres.length ? `<h4 style="margin:6px 0 4px;font-size:14px">Les autres tâches</h4><ul class="a2-others">${autres.map((o) => `<li><b>${escapeHtml(byId[o.tache_id]?.libelle || o.tache_id)}</b> · ${RECO[o.recommandation]}
            ${RECO_WHY[o.recommandation] ? `<span class="why">(${RECO_WHY[o.recommandation]})</span>` : ''}</li>`).join('')}</ul>` : ''}
        ${f.alertes.length ? `<div class="a2-alerts"><h4>À vérifier</h4><ul>${f.alertes.slice(0, 6).map((a) => `<li>${escapeHtml(a.message)}</li>`).join('')}</ul></div>` : ''}
        <p class="a2-help" style="margin-top:12px"><a href="#" id="a2Redo">Refaire l'audit</a></p>`;
      screenEl.querySelectorAll('[data-observe]').forEach((b) => b.onclick = () => {
        const lib = byId[b.dataset.observe]?.libelle || '';
        setStep(2);
        setPrimary(startBtn);
        statusEl.textContent = `À enregistrer : « ${lib} ». Clique sur « Enregistrer ma tâche », puis fais-la comme d'habitude.`;
      });
      $('a2Redo').onclick = (e) => { e.preventDefault(); go('intro'); };
      setPrimary(screenEl.querySelector('[data-observe]') || document.getElementById('toRecordBtn'));
    },
  };

  // Validations (passage à l'écran suivant)
  const VALIDATE = {
    async intro() {
      r().consent_usage = $('a2Usage').checked;
      r().consent_navigateur = $('a2Nav').checked;
      $('a2Next').disabled = true; $('a2Next').textContent = 'Audit en cours…';
      sphereSearching();
      try {
        const t0 = Date.now();
        st.outils = await api('/api/audit/outils', { usage: r().consent_usage, navigateur: r().consent_navigateur });
        await new Promise((res) => setTimeout(res, Math.max(0, 2500 - (Date.now() - t0))));
        sphereResult(st.outils.applications.filter((a) => a.filtre_metier?.est_metier));
        delete r().outils_confirmes; // nouveaux outils : cochés par défaut
        await loadQuestions();
        return true;
      } catch (e) {
        screenEl.insertAdjacentHTML('beforeend', `<p class="a2-help" style="color:var(--bad)">${escapeHtml(e.message)}</p>`);
        $('sphereBox').hidden = true;
        return false;
      } finally {
        $('a2Next').disabled = false;
      }
    },
    async role() {
      if (!r().role_metier) r().role_metier = '';
      await loadQuestions(); // les tâches proposées dépendent du rôle
      return true;
    },
    async q2() {
      const ts = r().taches || [];
      if (!ts.length) { r().aucune_tache = true; save(); go('recap'); return false; }
      r().aucune_tache = false;
      return true;
    },
    async q34() {
      const { ids } = await api('/api/onboarding/lourdes', { taches: r().taches || [] }).catch(() => ({ ids: [] }));
      st.lourdes = ids;
      return true;
    },
    async recap() {
      await api('/api/onboarding/reponses', { ...st.rep, envoye: true });
      go('resultat');
      return false;
    },
  };

  // Dictée : Q7 (« quand ça ne se passe pas comme d'habitude ») et « Autre tâche ». Transcription, rien de plus.
  let rec = null;
  async function dictate(target, btn, qid, onText) {
    if (rec) { rec.stop(); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { btn.textContent = 'Micro non autorisé'; return; }
    const chunks = [];
    rec = new MediaRecorder(stream);
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      rec = null;
      btn.textContent = 'Transcription…';
      try {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const d = await (await fetch(`/api/voice/transcribe?q=${qid}`, { method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: blob })).json();
        if (d.text) { target.value = target.value ? `${target.value} ${d.text}` : d.text; onText?.(target.value); target.dispatchEvent(new Event('input')); }
      } catch { /* on garde la saisie */ }
      btn.textContent = '🎙 Répondre à voix haute';
    };
    rec.start();
    btn.textContent = '■ Arrêter et transcrire';
  }

  function render() {
    const [name, arg] = st.screen.split(':');
    $('a2Next').textContent = 'Suivant →';
    $('a2Next').hidden = st.screen === 'resultat';
    $('a2Back').hidden = st.screen === 'intro';
    if (name !== 'intro') $('sphereBox').hidden = true;
    RENDER[name](arg !== undefined ? Number(arg) : undefined);
    progress();
    if (voiceOn && st.screen !== 'resultat') say();
  }

  // ── démarrage : brouillon et audit déjà faits ? on reprend où on en était ──────────────────────────────────────────
  document.getElementById('toRecordBtn').addEventListener('click', () => {
    setStep(2);
    setPrimary(startBtn);
    document.getElementById('recordTitle').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  iconsReady.then(async () => {
    try {
      const [rep, outils, dir] = await Promise.all([api('/api/onboarding/reponses'), api('/api/audit/outils'), api('/api/audit/dirigeant')]);
      st.rep = rep.reponses || {};
      st.outils = outils.applications?.length ? outils : null;
      st.dirigeant = dir.dirigeant;
      if (st.outils) await loadQuestions();
      if (st.rep.envoye && st.outils) { st.screen = 'resultat'; }
      else if ((st.rep.taches || []).length && st.outils) {
        const { ids } = await api('/api/onboarding/lourdes', { taches: st.rep.taches }).catch(() => ({ ids: [] }));
        st.lourdes = ids;
        st.screen = 'recap';
      }
    } catch { /* serveur indisponible : écran d'accueil */ }
    render();
    if (!resultsEl.children.length && !recording && st.screen === 'intro') setPrimary($('a2Next'));
  });
})();
