// Connexion Twiin (Supabase Auth), commune à toutes les pages. À charger AVANT les autres scripts de la page.
// - Sans Supabase configuré côté serveur (pas de SUPABASE_URL dans .env) : rien ne change, Twiin marche en local.
// - Avec Supabase : il faut être connecté ; chaque appel à /api part avec le jeton de l'employé (la base ne lui
//   montre que SES données), et son e-mail s'affiche en haut avec « Se déconnecter ».
(() => {
  const nativeFetch = window.fetch.bind(window);
  const onLogin = location.pathname.endsWith('/login.html');
  const goLogin = () => {
    if (!onLogin) location.replace(`/login.html?next=${encodeURIComponent(location.pathname + location.hash)}`);
  };

  window.twiinAuth = (async () => {
    let cfg;
    try { cfg = await (await nativeFetch('/api/config')).json(); } catch { return null; }
    if (!cfg.supabase || !window.supabase) return null;
    const client = window.supabase.createClient(cfg.supabase.url, cfg.supabase.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'twiin-auth' },
    });
    const { data } = await client.auth.getSession();
    if (!data.session) { goLogin(); return client; }
    client.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') goLogin(); });
    showUser(client, data.session.user);
    return client;
  })();

  // Chaque appel à /api part avec le jeton de l'employé connecté ; une session expirée renvoie vers la connexion.
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const isApi = url.startsWith('/api/') && !url.startsWith('/api/config');
    if (isApi) {
      const client = await window.twiinAuth;
      if (client) {
        const { data } = await client.auth.getSession();
        if (data.session) {
          const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined));
          headers.set('Authorization', `Bearer ${data.session.access_token}`);
          init = { ...init, headers };
        }
      }
    }
    const res = await nativeFetch(input, init);
    if (isApi && res.status === 401) goLogin();
    return res;
  };

  function showUser(client, user) {
    const place = () => {
      const bar = document.querySelector('.topbar');
      if (!bar || document.getElementById('userChip')) return;
      const chip = document.createElement('div');
      chip.id = 'userChip';
      chip.className = 'user-chip';
      chip.innerHTML = `<span class="user-mail"></span><button type="button" class="user-out">Se déconnecter</button>`;
      chip.querySelector('.user-mail').textContent = user.email;
      chip.querySelector('.user-out').addEventListener('click', async () => { await client.auth.signOut(); goLogin(); });
      const theme = document.getElementById('themeBtn');
      bar.insertBefore(chip, theme || null);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', place); else place();
    const css = document.createElement('style');
    css.textContent = `.user-chip{display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--text-dim);white-space:nowrap}
      .user-chip .user-mail{max-width:180px;overflow:hidden;text-overflow:ellipsis}
      .user-chip .user-out{font-size:12.5px;padding:5px 10px;border-radius:999px;border:1px solid var(--panel-border);background:var(--panel);color:var(--text-dim);cursor:pointer}
      .user-chip .user-out:hover{border-color:var(--accent);color:var(--accent)}
      @media (max-width:640px){.user-chip .user-mail{display:none}}`;
    document.head.appendChild(css);
  }
})();
