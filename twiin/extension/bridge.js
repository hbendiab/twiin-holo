// Twiin · pont entre l'extension et la page Twiin (localhost:3000) : état de l'enregistrement, démarrage, arrêt,
// et jeton de connexion quand les comptes sont activés. Ne s'exécute que sur les pages Twiin.
(() => {
  const $ = (id) => document.getElementById(id);
  const send = (m) => chrome.runtime.sendMessage(m).catch(() => {});

  // 1. Enregistrement en cours ? (le bouton « Terminer et analyser » n'est actif que pendant un enregistrement)
  let on = null, since = null;
  const check = () => {
    const stop = $('stopBtn');
    if (!stop) return;
    const now = !stop.disabled;
    if (now === on) return;
    on = now; since = now ? Date.now() : null;
    send({ type: 'record:state', rec: { on, since } });
  };
  check(); setInterval(check, 1000);
  addEventListener('pagehide', () => { if (on) send({ type: 'record:state', rec: { on: false, since: null } }); });

  // 2. Jeton Supabase (comptes activés) : l'extension appelle le serveur au nom de l'employé connecté
  const token = () => {
    try {
      const k = Object.keys(localStorage).find((x) => x === 'twiin-auth' || /^sb-.*-auth-token$/.test(x)); // auth.js range la session sous « twiin-auth »
      send({ type: 'token', token: k ? JSON.parse(localStorage.getItem(k))?.access_token : null });
    } catch { /* stockage illisible */ }
  };
  token(); setInterval(token, 5000); // juste après la connexion, le panneau la récupère en quelques secondes

  // 3. Démarrer : Chrome n'autorise le partage d'écran qu'après un vrai clic dans la page → grand bouton au centre
  function prompt() {
    if (on) return;
    document.getElementById('twiin-ext-prompt')?.remove();
    const host = document.createElement('div');
    host.id = 'twiin-ext-prompt';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      .veil { position: fixed; inset: 0; z-index: 2147483646; background: rgba(18,20,24,.28); backdrop-filter: blur(6px); display: grid; place-items: center;
        font-family: "Plus Jakarta Sans", -apple-system, sans-serif; }
      .card { width: min(440px, calc(100vw - 32px)); background: #f7f8fa; color: #16181d; border-radius: 30px; padding: 28px; box-shadow: 0 30px 60px -20px rgba(20,30,60,.35); }
      h2 { margin: 0 0 8px; font-size: 22px; letter-spacing: -.03em; }
      p { margin: 0 0 18px; color: #6b7180; font-size: 14px; line-height: 1.5; }
      .row { display: flex; gap: 8px; flex-wrap: wrap; }
      button { font: 600 15px inherit; font-family: inherit; border-radius: 999px; padding: 13px 22px; cursor: pointer; border: 1px solid #e3e6ec; background: #fff; color: #16181d; }
      button.go { background: #121418; color: #fff; border-color: #121418; flex: 1; }
      kbd { font: 12px ui-monospace, monospace; background: #eceef1; border-radius: 6px; padding: 2px 6px; }
    </style>
    <div class="veil"><div class="card" role="dialog" aria-label="Enregistrer une tâche">
      <h2>Enregistrer une tâche</h2>
      <p>Choisis l'écran à enregistrer, puis fais ta tâche comme d'habitude, dans n'importe quelle appli.
         Pour finir : le bouton de cette page, l'icône Twiin de Chrome ou <kbd>⌥ ⇧ R</kbd>.</p>
      <div class="row"><button class="go" type="button">Choisir l'écran et commencer</button><button class="no" type="button">Annuler</button></div>
    </div></div>`;
    document.documentElement.appendChild(host);
    const close = () => host.remove();
    root.querySelector('.no').onclick = close;
    root.querySelector('.veil').onclick = (e) => { if (e.target.classList.contains('veil')) close(); };
    const go = root.querySelector('.go');
    go.focus();
    go.onclick = () => { close(); $('startBtn')?.click(); }; // le clic de l'employé autorise le partage d'écran
  }

  chrome.runtime.onMessage.addListener((m, _s, reply) => {
    if (m?.type === 'record:prompt') { prompt(); reply({ ok: true }); }
    if (m?.type === 'record:stop') {
      const b = $('stopBtn');
      if (b && !b.disabled) { b.click(); reply({ ok: true }); } else reply({ error: 'Aucun enregistrement en cours.' });
    }
  });
})();
