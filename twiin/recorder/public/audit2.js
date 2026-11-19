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
  const ICO = {
    mic: '<svg class="ico-svg" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
    edit: '<svg class="ico-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg>',
    star: '<svg class="ico-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.6 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/></svg>',
  };
  const label = (list, v) => (list.find(([k]) => k === v) || [, ''])[1];

  // État : réponses (brouillon serveur), questions pré-remplies, outils du temps 1
  const st = { screen: 'intro', rep: {}, q: null, roles: [], outils: null, lourdes: [], idx: 0, dirigeant: null };
  const r = () => st.rep;

  // ── voix : la question est lue (si l'employé le veut) ; tout marche au clic sans la voix ─────────────────────────
  let voiceOn = false;
  try { const v = localStorage.getItem('twiin-a2-voix'); voiceOn = v === null ? true : v === '1'; } catch { /* rien */ } // Iris et Ilo parlent par défaut
  $('a2Voice').checked = voiceOn;
  $('a2Voice').addEventListener('change', () => { voiceOn = $('a2Voice').checked; try { localStorage.setItem('twiin-a2-voix', voiceOn ? '1' : '0'); } catch { /* rien */ } if (voiceOn) say(); });
  let audio = null, spoken = '';
  function say(text = spoken) {
    if (!text) return;
    if (window.TwiinNarrateur?.actif()) return window.TwiinNarrateur.dire(text); // voix d'Iris ou d'Ilo, texte synchronisé
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

  // ── liste déroulante avec recherche : logos, sans accents, clavier (↑ ↓ Entrée Échap), et « Ajouter … » libre ─────
  const norm = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const mark = (label, q) => {
    const i = q ? norm(label).indexOf(norm(q)) : -1;
    if (i < 0) return escapeHtml(label);
    return `${escapeHtml(label.slice(0, i))}<b>${escapeHtml(label.slice(i, i + q.length))}</b>${escapeHtml(label.slice(i + q.length))}`;
  };
  function combo(input, pop, { items, onPick, openOnFocus = false }) {
    let list = [], active = -1;
    const close = () => { pop.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); };
    const draw = () => {
      list = items(input.value.trim());
      if (!list.length) return close();
      active = Math.min(active, list.length - 1);
      pop.innerHTML = list.map((it, i) => `<div class="a2-opt${it.free ? ' free' : ''}" role="option" id="${pop.id}-${i}" data-i="${i}" aria-selected="${i === active}">
          <span class="ico">${it.icon || (it.free ? '+' : '')}</span><span class="txt">${it.html}</span>${it.sub ? `<small>${it.sub}</small>` : ''}</div>`).join('');
      pop.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      if (active >= 0) { input.setAttribute('aria-activedescendant', `${pop.id}-${active}`); pop.children[active]?.scrollIntoView({ block: 'nearest' }); }
    };
    const pick = (it) => { if (!it) return; onPick(it); };
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', pop.id); input.setAttribute('aria-expanded', 'false'); input.autocomplete = 'off';
    pop.setAttribute('role', 'listbox');
    input.addEventListener('input', () => { active = 0; draw(); });
    input.addEventListener('focus', () => { if (openOnFocus || input.value.trim()) { active = -1; draw(); } });
    input.addEventListener('click', () => { if (pop.hidden && (openOnFocus || input.value.trim())) { active = -1; draw(); } });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (pop.hidden) { active = 0; return draw(); } active = Math.min(list.length - 1, active + 1); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); draw(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (!pop.hidden && list.length) pick(list[Math.max(0, active)]); }
      else if (e.key === 'Escape') { if (!pop.hidden) { e.preventDefault(); close(); } }
    });
    pop.addEventListener('mousedown', (e) => { const o = e.target.closest('[data-i]'); if (!o) return; e.preventDefault(); pick(list[Number(o.dataset.i)]); });
    pop.addEventListener('mousemove', (e) => { const o = e.target.closest('[data-i]'); if (o && Number(o.dataset.i) !== active) { active = Number(o.dataset.i); draw(); } });
    input.addEventListener('blur', () => setTimeout(close, 120));
    return { open() { active = -1; draw(); } };
  }
  const iconOf = (nom) => { const e = findIcons(String(nom || '').replace(/-/g, ' '), 1)[0]; return e ? `<img src="icons/${e.file}" alt="">` : ''; };

  const RENDER = {
    async intro() {
      const nav = st.dirigeant?.sources_autorisees || [];
      const navOk = nav.includes('historique_navigateur'); // l'option Chrome n'existe que si l'entreprise l'autorise
      const deja = !!st.outils?.applications?.length;
      const ETAPES = [['Tes outils', 'Twiin repère les applis de ton poste, automatiquement.'],
                      ['Tes tâches', 'Quelques questions, surtout des clics.'],
                      ['Ton top 3', 'Les tâches qui te coûtent le plus, en heures et en euros.']];
      screenEl.innerHTML = `<div class="a2-intro">${head('On commence par tes outils, puis quelques questions.')}
        <ol class="in-steps">${ETAPES.map(([t, d], i) => `<li><span class="n">0${i + 1}</span><b>${t}</b><p>${d}</p></li>`).join('')}</ol>
        <div class="in-opts">
          <label class="in-switch"><input type="checkbox" role="switch" id="a2Usage" ${r().consent_usage !== false ? 'checked' : ''}>
            <span class="sw" aria-hidden="true"></span><span class="txt">Compter mes jours d'utilisation des applis sur 30 jours<em>jamais ce que j'y fais</em></span></label>
          ${navOk ? `<label class="in-switch"><input type="checkbox" role="switch" id="a2Nav" ${r().consent_navigateur !== false ? 'checked' : ''}>
            <span class="sw" aria-hidden="true"></span><span class="txt">Repérer mes outils pro utilisés dans Chrome<em>seulement les sites métier connus</em></span></label>`
            : '<input type="checkbox" id="a2Nav" hidden>'}
        </div>
        <div class="in-actions">
          ${deja ? '<button type="button" id="a2Skip">Garder mes outils déjà repérés</button>' : ''}
          <button type="button" class="primary" id="a2Go">${deja ? 'Refaire le scan' : 'Commencer'}</button>
        </div></div>`;
      $('a2Next').hidden = true; // les deux choix sont dans l'écran, pas besoin du bouton « Suivant »
      $('a2Go').onclick = () => $('a2Next').click();
      $('a2Skip')?.addEventListener('click', () => { st.scanAFaire = false; r().consent_usage = $('a2Usage').checked; go('role'); });
    },
    role() {
      const roles = st.roles || [];
      const cur = r().role_metier || '';
      screenEl.innerHTML = `${head('Quel est ton rôle ?')}
        <div class="a2-combo a2-combo-big"><input id="a2Role" placeholder="Tape ton rôle ou choisis dans la liste" value="${escapeHtml(cur)}"><div class="a2-pop" id="a2RolePop" hidden></div></div>`;
      const inp = $('a2Role');
      combo(inp, $('a2RolePop'), {
        openOnFocus: true,
        items: (q) => {
          const exact = roles.some((x) => norm(x) === norm(q)); // rôle déjà choisi : on montre toute la liste
          const nq = exact ? '' : norm(q);
          const hits = roles.filter((x) => !nq || norm(x).includes(nq)).map((x) => ({ label: x, html: nq ? mark(x, q) : escapeHtml(x) }));
          if (q && !roles.some((x) => norm(x) === nq)) hits.push({ free: true, label: q, html: `Utiliser « ${escapeHtml(q)} »` });
          return hits;
        },
        onPick: (it) => { inp.value = it.label; r().role_metier = it.label; inp.blur(); },
      });
      inp.oninput = () => { r().role_metier = inp.value.trim(); };
    },
    q1() {
      const opts = st.q.q1_outils.options;
      if (!r().outils_confirmes) r().outils_confirmes = opts.map((o) => o.application_id); // cochés par défaut
      const conf = new Set(r().outils_confirmes);
      screenEl.innerHTML = `${head(st.q.q1_outils.question)}
        <div class="a2-grid">${opts.map((o) => `<button type="button" class="a2-tool" data-app="${o.application_id}" aria-pressed="${conf.has(o.application_id)}">
            ${toolIcon(o.nom)}<span>${escapeHtml(o.nom)}</span>${o.usage?.jours_utilises_30 != null ? `<small>${o.usage.jours_utilises_30} j / 30</small>` : ''}</button>`).join('')}
          ${(r().outils_ajoutes || []).map((o) => `<button type="button" class="a2-tool" data-added="${o.id}" aria-pressed="true">${toolIcon(o.nom)}<span>${escapeHtml(o.nom)}</span><small>ajouté</small></button>`).join('')}
        </div>
        <div class="a2-combo"><input id="a2AddTool" placeholder="Ajouter un outil absent de la liste…"><div class="a2-pop" id="a2ToolPop" hidden></div></div>`;
      screenEl.querySelectorAll('[data-app]').forEach((b) => b.onclick = () => {
        const id = b.dataset.app, s = new Set(r().outils_confirmes);
        s.has(id) ? s.delete(id) : s.add(id);
        r().outils_confirmes = [...s];
        b.setAttribute('aria-pressed', s.has(id) ? 'true' : 'false');
      });
      screenEl.querySelectorAll('[data-added]').forEach((b) => b.onclick = () => { r().outils_ajoutes = (r().outils_ajoutes || []).filter((o) => o.id !== b.dataset.added); RENDER.q1(); });
      const add = (nom) => {
        if (!nom) return;
        const id = norm(nom).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        if (!(r().outils_ajoutes || []).some((o) => o.id === id)) r().outils_ajoutes = [...(r().outils_ajoutes || []), { id, nom }];
        RENDER.q1();
        $('a2AddTool').focus();
      };
      // Propositions : les logiciels connus (logos), sauf ceux déjà dans la liste ; et toujours « Ajouter … » tel quel
      const deja = new Set([...opts.map((o) => norm(o.nom)), ...(r().outils_ajoutes || []).map((o) => norm(o.nom))]);
      combo($('a2AddTool'), $('a2ToolPop'), {
        items: (q) => {
          if (!q) return [];
          const hits = ICONS.filter((e) => !deja.has(norm(e.label)) && norm(e.label).includes(norm(q)))
            .sort((a, b) => norm(a.label).indexOf(norm(q)) - norm(b.label).indexOf(norm(q)) || a.label.length - b.label.length).slice(0, 7)
            .map((e) => ({ label: e.label, html: mark(e.label, q), icon: `<img src="icons/${e.file}" alt="">` }));
          if (!hits.some((h) => norm(h.label) === norm(q))) hits.push({ free: true, label: q, html: `Ajouter « ${escapeHtml(q)} »` });
          return hits;
        },
        onPick: (it) => add(it.label),
      });
    },
    q2() {
      const opts = st.q.q2_taches.options;
      const cur = r().taches || [];
      const has = (sid) => cur.some((t) => t.suggestion_id === sid);
      const icons = (t) => {
        const o = t.suggestion_id && opts.find((x) => x.suggestion_id === t.suggestion_id);
        return o ? (o.applis_detectees.length ? o.applis_detectees : o.applis_typiques).slice(0, 3).map(iconOf).join('') : '';
      };
      screenEl.innerHTML = `${head(st.q.q2_taches.question)}
        ${cur.length ? `<ul class="a2-added">${cur.map((t) => `<li><span class="box">✓</span><span class="lib">${escapeHtml(t.libelle)}</span>
            <span class="icons">${icons(t)}</span><button type="button" class="rm" data-rm="${t.id}" aria-label="Retirer ${escapeHtml(t.libelle)}">×</button></li>`).join('')}</ul>` : ''}
        <div class="a2-combo a2-combo-big"><input id="a2Other" placeholder="${cur.length ? 'Ajouter une autre tâche…' : 'Ajouter une tâche…'}"><div class="a2-pop" id="a2TaskPop" hidden></div>
          <button type="button" id="a2OtherMic" class="quiet" title="Dicter la tâche" aria-label="Dicter la tâche">${ICO.mic}</button></div>
        ${cur.length ? '' : '<p class="a2-help" style="margin-top:10px"><button type="button" class="a2-chip dim" id="a2NoTask">Je ne sais pas</button></p>'}`;
      screenEl.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { r().taches = (r().taches || []).filter((t) => t.id !== b.dataset.rm); RENDER.q2(); });
      const addSug = (o) => {
        if (!has(o.suggestion_id)) r().taches = [...(r().taches || []), { id: `t_${o.suggestion_id}`, libelle: o.libelle, source: 'suggestion', suggestion_id: o.suggestion_id,
          applis_ids: o.applis_detectees.filter((a) => outilsChoisis().some((x) => x.id === a)) }];
      };
      const addFree = (lib) => { r().taches = [...(r().taches || []), { id: `t_libre_${Date.now().toString(36)}`, libelle: lib, source: 'saisie_libre', applis_ids: [] }]; };
      // Propositions : les tâches typiques du métier, pas encore ajoutées (toutes à l'ouverture, filtrées en tapant) ; et sa propre tâche
      const box = combo($('a2Other'), $('a2TaskPop'), {
        openOnFocus: true,
        items: (q) => {
          const nq = norm(q);
          const hits = opts.filter((o) => !has(o.suggestion_id) && (!nq || norm(o.libelle).includes(nq))).slice(0, 8)
            .map((o) => ({ o, label: o.libelle, html: mark(o.libelle, q), icon: (o.applis_detectees.length ? o.applis_detectees : o.applis_typiques).slice(0, 1).map(iconOf).join('') }));
          if (q && !hits.some((h) => norm(h.label) === nq)) hits.unshift({ free: true, label: q, html: `Ajouter « ${escapeHtml(q)} »` });
          return hits;
        },
        onPick: (it) => {
          if (it.free) addFree(it.label); else addSug(it.o);
          r().aucune_tache = false;
          RENDER.q2();
          $('a2Other').focus(); // la liste se rouvre : on enchaîne les ajouts
        },
      });
      $('a2OtherMic').onclick = () => dictate($('a2Other'), $('a2OtherMic'), 'taches', () => { $('a2Other').focus(); box.open(); });
      $('a2NoTask')?.addEventListener('click', () => { r().taches = []; r().aucune_tache = true; save(); go('recap'); });
    },
    q34() {
      const ts = r().taches || [];
      spoken = 'Pour chaque tâche : combien de fois par semaine, et combien de temps à chaque fois ?';
      screenEl.innerHTML = `${head(spoken)}
        <div class="a2-seq">${ts.map((t, i) => `<div class="a2-row" data-i="${i}" hidden><span class="a2-of">Tâche ${i + 1} sur ${ts.length}</span><b>${escapeHtml(t.libelle)}</b>
          <div class="lbl">Combien de fois par semaine ?</div><div class="a2-chips">${FREQ.map(([k, l]) => chip(`data-t="${t.id}" data-f="${k}"`, l, t.frequence_tranche === k)).join('')}</div>
          <div class="lbl">Combien de temps à chaque fois ?</div><div class="a2-chips">${DUREE.map(([k, l]) => chip(`data-t="${t.id}" data-d="${k}"`, l, t.duree_tranche === k)).join('')}</div></div>`).join('')}</div>`;
      const rows = [...screenEl.querySelectorAll('.a2-row[data-i]')];
      const complete = (t) => t.frequence_tranche && t.duree_tranche;
      // une tâche à la fois : la suivante apparaît quand on a répondu à celle-ci pendant cette visite
      // (une réponse déjà pré-remplie se confirme d'un clic)
      const vus = new Set();
      const devoiler = (anim) => {
        let k = 0;
        while (k < ts.length - 1 && vus.has(ts[k].id) && complete(ts[k])) k++;
        rows.forEach((row, i) => {
          if (i > k || !row.hidden) return;
          row.hidden = false;
          if (anim) { row.classList.add('a2-arrive'); setTimeout(() => row.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60); }
        });
      };
      devoiler(false);
      screenEl.querySelectorAll('[data-f],[data-d]').forEach((b) => b.onclick = () => {
        const t = tache(b.dataset.t);
        if (b.dataset.f) t.frequence_tranche = b.dataset.f; else t.duree_tranche = b.dataset.d;
        b.parentElement.querySelectorAll('.a2-chip').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
        const autre = b.dataset.f ? 'duree_tranche' : 'frequence_tranche';
        const ligne = b.closest('.a2-row');
        ligne.dataset[b.dataset.f ? 'f' : 'd'] = '1';
        // remplie = les deux réponses données (ou l'autre était déjà là et on vient de confirmer celle-ci)
        if (complete(t) && (ligne.dataset.f && ligne.dataset.d || t[autre])) { vus.add(t.id); setTimeout(() => devoiler(true), 250); }
      });
    },
    q567(i) {
      const t = tache(st.lourdes[i]);
      if (!t) return go('q8');
      // Les outils ouverts et leur ordre ne sont plus demandés : l'enregistrement (computer use) les observe en vrai.
      screenEl.innerHTML = `<p class="a2-help a2-of">Tâche ${i + 1} sur ${st.lourdes.length}</p>
        ${head(`« ${t.libelle} » : qu'est-ce qui la déclenche ?`)}
        <div class="a2-row"><div class="a2-chips">${DECL.map(([k, l]) => chip(`data-decl="${k}"`, l, t.declencheur === k)).join('')}</div>
          <div class="a2-input" ${t.declencheur === 'autre' ? '' : 'hidden'} id="a2DeclOther"><input id="a2DeclText" placeholder="Ce qui la déclenche" value="${escapeHtml(t.declencheur_autre || '')}"></div></div>
        <div class="a2-row"><b>Recopies-tu des informations d'un outil à l'autre ?</b>
          <div class="a2-chips">${RECOPIE.map(([v, l]) => chip(`data-rec="${v}"`, l, t.recopie === v || (v === null && t.recopie === null))).join('')}</div></div>
        <div class="a2-row"><b>Et quand ça ne se passe pas comme d'habitude ?</b>
          <textarea id="a2Exc" placeholder="Par exemple : il manque une pièce, je relance par mail…">${escapeHtml(t.exceptions_transcript || '')}</textarea>
          <div class="a2-input"><button type="button" id="a2ExcMic">${ICO.mic} Répondre à voix haute</button></div></div>`;
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
      const edit = (s) => `<a href="#" class="a2-edit" data-go="${s}">${ICO.edit}<span>Modifier</span></a>`;
      const deleg = ts.find((t) => t.deleguer_en_premier);
      const parSem = (t) => label(FREQ, t.frequence_tranche);
      const duree = (t) => label(DUREE, t.duree_tranche);
      spoken = "Voici ce qu'on a compris. Tu peux tout modifier avant d'envoyer.";
      screenEl.innerHTML = `<div class="a2-recap">${head("Voici ce qu'on a compris")}
        <div class="rc-keys">
          <div class="rc-key"><span>Rôle</span><b>${escapeHtml(r().role_metier || 'Non précisé')}</b>${edit('role')}</div>
          <div class="rc-key"><span>Outils</span><b>${tools.length}</b>${edit('q1')}</div>
          <div class="rc-key"><span>Tâches</span><b>${ts.length}</b>${edit('q2')}</div>
        </div>
        <section class="rc-block">
          <header><h4>Tes tâches de la semaine</h4>${edit('q34')}</header>
          ${ts.length ? `<ul class="rc-tasks">${ts.map((t) => `<li${t === deleg ? ' class="deleg"' : ''}>
              <span class="nom">${escapeHtml(t.libelle)}${t === deleg ? `<em>${ICO.star}À déléguer en premier</em>` : ''}</span>
              <span class="val">${parSem(t) ? `${escapeHtml(parSem(t))} <small>/ sem.</small>` : '<small>?</small>'}</span>
              <span class="val">${duree(t) ? escapeHtml(duree(t)) : '<small>?</small>'}</span></li>`).join('')}</ul>`
            : '<p class="rc-vide">Aucune tâche pour l\'instant.</p>'}
        </section>
        <section class="rc-block">
          <header><h4>Tes outils de travail</h4>${edit('q1')}</header>
          <div class="rc-tools">${tools.map((o) => `<span class="rc-tool" title="${escapeHtml(o.nom)}">${toolIcon(o.nom)}<span>${escapeHtml(o.nom)}</span></span>`).join('') || '<p class="rc-vide">Aucun outil choisi.</p>'}</div>
        </section></div>`;
      screenEl.querySelectorAll('[data-go]').forEach((x) => x.onclick = (e) => { e.preventDefault(); go(x.dataset.go); });
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
      // « Mon travail » : ce que la personne fait et avec quoi (l'historique de son audit), ses priorités en tête
      const conf = r().outils_confirmes;
      const outils = [...(f.applications || []).filter((x) => (conf ? conf.includes(x.id) : x.filtre_metier?.est_metier)).map((x) => ({ id: x.id, nom: x.nom })),
                      ...(r().outils_ajoutes || [])].filter((o, i, l) => l.findIndex((x) => x.nom.toLowerCase() === o.nom.toLowerCase()) === i); // sans doublon
      const rang = Object.fromEntries(top.map((o, k) => [o.tache_id, k + 1]));
      const ts = [...(f.taches || [])].sort((x, y) => (rang[x.id] || 99) - (rang[y.id] || 99));
      const dateAudit = f.date_audit ? new Date(f.date_audit).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
      const facile = (o) => (o.tranche_facilite === 'facile' ? 'Facile à automatiser' : o.tranche_facilite === 'moyen' ? 'Moyennement facile' : 'Difficile à automatiser');
      spoken = '';
      screenEl.innerHTML = `<div class="mt">
        <section class="mt-bloc">
          <header class="mt-head"><h3>Mes priorités</h3>${dateAudit ? `<span class="mt-date">Audit du ${dateAudit}</span>` : ''}</header>
          ${top.length ? `<p class="a2-total">Ensemble, elles représentent <b>${hTop.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} h par semaine</b>, soit environ <b>${fmtE(eTop)} par an</b>
            (au coût horaire de ${f.dirigeant?.cout_horaire ?? 35} €).</p>` : '<p class="a2-total">Pas encore de tâche assez lourde pour être automatisée.</p>'}
          <div class="a2-top3">${top.map((o, k) => `<div class="a2-opp"><span class="n">Priorité ${k + 1}</span><b>${escapeHtml(byId[o.tache_id]?.libelle || o.tache_id)}</b>
              <span class="big">${(o.gain_heures_semaine ?? 0).toLocaleString('fr-FR')} h <small>par semaine</small></span>
              <span class="eur">≈ ${fmtE(o.gain_euros_an || 0)} par an</span>
              <span class="tags">${facile(o)}${byId[o.tache_id]?.deleguer_en_premier ? ' · celle que tu délèguerais en premier' : ''}</span>
              <button type="button" data-observe="${o.tache_id}">Observer cette tâche</button></div>`).join('')}</div>
        </section>
        <section class="mt-bloc">
          <header class="mt-head"><h3>Mon poste</h3></header>
          <div class="rc-keys">
            <div class="rc-key"><span>Rôle</span><b>${escapeHtml(f.poste?.role_metier || r().role_metier || 'Non précisé')}</b></div>
            <div class="rc-key"><span>Outils de travail</span><b>${outils.length}</b></div>
            <div class="rc-key"><span>Tâches de la semaine</span><b>${ts.length}</b></div>
          </div>
        </section>
        <section class="mt-bloc">
          <header class="mt-head"><h3>Mes tâches de la semaine</h3></header>
          ${ts.length ? `<ul class="rc-tasks">${ts.map((t) => {
            const o = f.opportunites.find((x) => x.tache_id === t.id);
            return `<li${rang[t.id] ? ' class="deleg"' : ''}><span class="nom">${escapeHtml(t.libelle)}${rang[t.id] ? `<em>Priorité ${rang[t.id]}</em>` : o ? `<em class="dim">${escapeHtml(RECO[o.recommandation] || '')}</em>` : ''}</span>
              <span class="val">${label(FREQ, t.frequence_tranche) ? `${escapeHtml(label(FREQ, t.frequence_tranche))} <small>/ sem.</small>` : '<small>?</small>'}</span>
              <span class="val">${escapeHtml(label(DUREE, t.duree_tranche) || '?')}</span></li>`; }).join('')}</ul>` : '<p class="rc-vide">Aucune tâche.</p>'}
        </section>
        <section class="mt-bloc">
          <header class="mt-head"><h3>Mes outils</h3></header>
          <div class="rc-tools">${outils.map((o) => `<span class="rc-tool" title="${escapeHtml(o.nom)}">${toolIcon(o.nom)}<span>${escapeHtml(o.nom)}</span></span>`).join('') || '<p class="rc-vide">Aucun outil.</p>'}</div>
        </section>
        ${f.alertes.length ? `<div class="a2-alerts"><h4>À vérifier</h4><ul>${f.alertes.slice(0, 6).map((x) => `<li>${escapeHtml(x.message)}</li>`).join('')}</ul></div>` : ''}
        <div class="mt-fin"><button type="button" id="a2Redo">Refaire l'audit</button></div>
      </div>`;
      screenEl.querySelectorAll('[data-observe]').forEach((b) => b.onclick = () => {
        const lib = byId[b.dataset.observe]?.libelle || '';
        setStep(2);
        setPrimary(startBtn);
        statusEl.textContent = `À enregistrer : « ${lib} ». Clique sur « Enregistrer ma tâche », puis fais-la comme d'habitude.`;
      });
      $('a2Redo').onclick = () => go('intro');
      setPrimary(screenEl.querySelector('[data-observe]') || document.getElementById('toRecordBtn'));
    },
  };

  // Validations (passage à l'écran suivant)
  // ── scan du poste : Iris et Ilo en bas, les logos des applis « se chargent » au-dessus d'eux, en arc ─────────────
  // L'arc se remplit de gauche à droite comme une barre de chargement ; tant que le scan tourne, il se vide et recommence.
  // Résultat : l'arc montre les vrais outils repérés, puis on passe à « Voici les outils que tu utilises le plus ».
  async function scanner() {
    const texte = 'On regarde les outils de ton poste…';
    spoken = texte;
    screenEl.innerHTML = `<h3 class="a2-q">${texte}</h3><p class="a2-help" id="a2ScanTxt">Seulement le nom des applications, jamais tes fichiers.</p>
      <div class="a2-flux" data-twn-libre="1" aria-hidden="true"></div>`;
    $('a2').classList.add('twn-scanning');
    $('a2Next').disabled = true; $('a2Next').textContent = 'Audit en cours…'; $('a2Back').hidden = true;
    window.TwiinNarrateur?.scene('scan', texte, 0, voiceOn);
    const flux = screenEl.querySelector('.a2-flux');
    const ECART = 66, still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let logos = [], vitesse = 110, decal = 0, avant = performance.now(), tourne = true;
    const remplir = (liste) => {
      const l = [...liste]; while (l.length && l.length < 16) l.push(...liste); // assez de logos pour dépasser la largeur
      flux.innerHTML = '';
      logos = l.slice(0, 24).map((e) => { const s = document.createElement('span'); s.className = 'a2-fl'; s.innerHTML = `<img src="icons/${e.file}" alt="">`; flux.append(s); return s; });
    };
    const image = (now) => {
      if (!tourne) return;
      const dt = Math.min(.05, (now - avant) / 1000); avant = now;
      const W = logos.length * ECART, cw = flux.clientWidth;
      if (!still) decal = (decal + vitesse * dt) % W;
      logos.forEach((s, i) => {
        const x = ((i * ECART - decal) % W + W) % W - (W - cw) / 2;
        const d = x + 22 - cw / 2, k = Math.exp(-((d / 120) ** 2)); // le logo au centre, juste au-dessus des jumeaux, grossit
        s.style.transform = `translate(${x}px, ${-k * 16}px) scale(${.72 + .6 * k})`;
        s.style.opacity = String(.3 + .7 * k);
      });
      requestAnimationFrame(image);
    };
    remplir([...ICONS].sort(() => Math.random() - 0.5));
    requestAnimationFrame(image);
    try {
      const t0 = Date.now();
      st.outils = await api('/api/audit/outils', { usage: r().consent_usage, navigateur: r().consent_navigateur });
      await new Promise((res) => setTimeout(res, Math.max(0, 3500 - (Date.now() - t0)))); // le temps de voir l'animation
      const metier = st.outils.applications.filter((a) => a.filtre_metier?.est_metier);
      const vus = metier.map((a) => findIcons(a.nom, 1)[0]).filter(Boolean);
      // les vrais outils prennent la place des logos de chargement, et le flux ralentit
      flux.classList.add('change');
      await new Promise((res) => setTimeout(res, 350));
      if (vus.length) remplir(vus);
      vitesse = 45; flux.classList.remove('change');
      $('a2ScanTxt').textContent = `${metier.length} outils de travail repérés.`;
      await new Promise((res) => setTimeout(res, 1800));
      delete r().outils_confirmes; // nouveaux outils : cochés par défaut
      return true;
    } catch (e) {
      $('a2').classList.remove('twn-scanning');
      render();
      screenEl.insertAdjacentHTML('beforeend', `<p class="a2-help" style="color:var(--bad)">${escapeHtml(e.message)}</p>`);
      return false;
    } finally {
      tourne = false;
      $('a2Next').disabled = false;
    }
  }

  const VALIDATE = {
    async intro() {
      r().consent_usage = $('a2Usage').checked;
      r().consent_navigateur = $('a2Nav').checked;
      st.scanAFaire = true; // le scan se lance après le rôle, juste avant « les outils que tu utilises le plus »
      return true;
    },
    async role() {
      if (!r().role_metier) r().role_metier = '';
      if (st.scanAFaire || !st.outils) { if (!(await scanner())) return false; st.scanAFaire = false; }
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
    const orig = btn.textContent;
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
      btn.textContent = orig;
    };
    rec.start();
    btn.textContent = orig.length > 3 ? '■ Arrêter et transcrire' : '■';
  }

  function render() {
    $('a2').classList.remove('twn-scanning');
    $('a2').classList.toggle('a2-fini', st.screen === 'resultat'); // « Mon travail » : pas de barre de progression ni de « Retour »
    const [name, arg] = st.screen.split(':');
    $('a2Next').textContent = 'Suivant →';
    $('a2Next').hidden = st.screen === 'resultat';
    $('a2Back').hidden = st.screen === 'intro';
    $('toRecordBtn').hidden = !['intro', 'resultat'].includes(st.screen); // pas de raccourci au milieu des questions
    if (name !== 'intro') $('sphereBox').hidden = true;
    RENDER[name](arg !== undefined ? Number(arg) : undefined);
    progress();
    // Mode narrateur (2e écran « on fait connaissance ») : Iris et Ilo posent la question, mot par mot
    if (window.TwiinNarrateur?.scene(st.screen, spoken, screens().indexOf(st.screen), voiceOn)) return;
    if (voiceOn && st.screen !== 'resultat') say();
  }

  // Fin de la page d'ouverture (« Allons-y ») : on montre les questions, même si l'audit est déjà fait
  window.twiinAuditReprendre = () => { if (st.screen === 'resultat') { go('intro'); return true; } return false; };

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
      const connaissance = new URLSearchParams(location.search).has('faire-connaissance'); // arrivée depuis la page d'ouverture
      if (connaissance) { st.screen = 'intro'; } // on refait connaissance : réponses pré-remplies, rien n'est effacé
      else if (st.rep.envoye && st.outils) { st.screen = 'resultat'; }
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
