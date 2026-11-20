// Twiin pour le Mac (Electron) : une icône dans la barre des menus et une fenêtre flottante, par-dessus toutes les
// applis (Excel, Outlook, Finder…), qui s'ouvre et se ferme avec ⌥⌘T, l'icône du Dock ou celle de la barre des menus. Pendant un enregistrement, elle devient une
// petite pastille (chrono + Terminer). Elle n'apparaît jamais dans les images enregistrées (protection de contenu).
// Le contenu est le même que le panneau de l'extension Chrome (extension/panel.js), servi par le serveur Twiin local.
const { app, BrowserWindow, Tray, Menu, globalShortcut, desktopCapturer, session, shell, ipcMain, nativeImage, screen, Notification,
  systemPreferences, dialog, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn, execFile } = require('node:child_process');
const { install } = require('./setup');
const { setupVoice } = require('./voice-permissions'); // autorisation du micro (capture vocale)

const IS_MAC = process.platform === 'darwin';
const BASE = 'http://localhost:3000';
// App installée : le code vit dans le dossier de l'utilisateur (on y écrit), copié au premier lancement.
// En développement (npm start) : le dossier du dépôt. TWIIN_ONBOARDING=1 force l'onboarding pour le tester.
const DATA_DIR = app.getPath('userData');
const APP_DIR = app.isPackaged ? path.join(DATA_DIR, 'app') : path.join(__dirname, '..');
const RECORDER_DIR = path.join(APP_DIR, 'recorder');
const ONBOARD_FILE = path.join(DATA_DIR, 'onboarding.json');
const SHORTCUT = IS_MAC ? 'Alt+Command+T' : 'Control+Alt+T'; // ⌥⌘T sur Mac, Ctrl+Alt+T sous Windows
const FULL = { width: 400, height: 720 };
const PILL = { width: 320, height: 40 }; // barre mini pendant l'enregistrement

let win = null, tray = null, server = null, compact = false, rec = { on: false }, trayTimer = null, screenPick = 0;

// --- Serveur Twiin : on le démarre s'il ne tourne pas (avec le Node intégré à Electron) ---
async function serverUp() {
  try { return (await fetch(`${BASE}/api/config`)).ok; } catch { return false; }
}
async function ensureServer() {
  if (await serverUp()) return true;
  server = spawn(process.execPath, ['server.js'], { cwd: RECORDER_DIR, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT: '3000' }, stdio: 'inherit' });
  server.on('exit', () => { server = null; });
  for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 500)); if (await serverUp()) return true; }
  return false;
}

// --- Fenêtre flottante ---
function placeFull() {
  const { workArea } = screen.getPrimaryDisplay();
  win.setBounds({ x: workArea.x + workArea.width - FULL.width - 16, y: workArea.y + 16, width: FULL.width, height: Math.min(FULL.height, workArea.height - 32) });
}
function placePill() {
  const { workArea } = screen.getPrimaryDisplay();
  win.setBounds({ x: Math.round(workArea.x + (workArea.width - PILL.width) / 2), y: workArea.y + 6, width: PILL.width, height: PILL.height });
}
function setCompact(on) {
  compact = on;
  if (!win) return;
  // la taille minimale du panneau (300 × 360) empêcherait la barre d'enregistrement de faire 40 px de haut
  if (on) win.setMinimumSize(1, 1);
  win.setResizable(true);
  on ? placePill() : placeFull();
  if (!on) win.setMinimumSize(300, 360);
  win.setResizable(!on);
  win.webContents.send('compact', on);
}
function createWindow() {
  win = new BrowserWindow({
    ...FULL, show: false, frame: false, transparent: false, backgroundColor: '#e9ebef', roundedCorners: true, hasShadow: true,
    resizable: true, minimizable: true, fullscreenable: false, alwaysOnTop: true, title: 'Twiin', minWidth: 300, minHeight: 360,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Invisible dans les captures seulement quand il le faut (voir proteger()) : sinon Twiin disparaissait aussi des
  // captures d'écran de l'utilisateur (⌘⇧4 montrait ce qu'il y a derrière la fenêtre).
  placeFull();
  win.loadFile(path.join(__dirname, 'loading.html'));
  win.once('ready-to-show', () => win.show());
  win.on('close', (e) => { if (!app.isQuitting) { e.preventDefault(); win.hide(); } }); // fermer = cacher
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}
// --- Notifications Twiin : une petite carte aux couleurs du SaaS (Iris et Ilo), en haut à droite de l'écran ----------
// quand une vidéo ou une automatisation se termine et que la fenêtre Twiin est réduite, cachée ou en arrière-plan.
const toasts = [];
// Twiin est retiré des captures d'écran UNIQUEMENT pendant un enregistrement de tâche ou quand Holo travaille sur ce Mac
// (pour ne pas apparaître dans les images de la tâche, ni gêner Holo). Le reste du temps, ⌘⇧4 le capture normalement.
let protege = false;
function proteger(on) {
  if (on === protege) return;
  protege = on;
  win?.setContentProtection(on);
  toasts.forEach((t) => t.setContentProtection(on));
}
function placeToasts() {
  const { workArea } = screen.getPrimaryDisplay();
  toasts.forEach((t, i) => t.setBounds({ x: workArea.x + workArea.width - 400 - 8, y: workArea.y + 8 + i * 122, width: 400, height: 122 }));
}
function toast({ kick, titre, texte, lien, echec }) {
  const t = new BrowserWindow({ width: 400, height: 122, show: false, frame: false, transparent: true, hasShadow: false, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, focusable: false, alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false } });
  t.setAlwaysOnTop(true, 'screen-saver');
  t.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  t.setContentProtection(protege); // pas dans les images d'un enregistrement (seulement pendant)
  toasts.push(t); placeToasts();
  t.on('closed', () => { toasts.splice(toasts.indexOf(t), 1); placeToasts(); });
  const q = new URLSearchParams({ kick: kick || 'Twiin', titre, texte: texte || '', ...(lien ? { lien } : {}), ...(echec ? { echec: '1' } : {}) });
  t.loadURL(`${BASE}/toast.html?${q}`);
  t.once('ready-to-show', () => t.showInactive());
}
ipcMain.on('toast:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close());
// Twiin a-t-il la main de l'utilisateur ? (fenêtre visible, en grand, au premier plan) : sinon on prévient par une notification
const discret = () => !win || !win.isVisible() || win.isMinimized() || compact || !win.isFocused();
// --- Jumeaux guides : pendant une automatisation, Iris et Ilo suivent la souris et disent ce qui se passe -------------
// Fenêtre transparente, au-dessus de tout, qui ne prend ni le focus ni les clics (Holo clique « à travers »).
// Invisible dans les captures d'écran (Holo ne la voit pas, elle ne le gêne pas) mais visible sur l'écran et le projecteur ;
// TWIIN_GUIDE_CAPTURE=1 la rend visible dans les captures, pour filmer une démo.
let guide = null, guideSuivi = null, gx = null, gy = null;
const GUIDE_W = 380, GUIDE_H = 150;
function ouvrirGuide() {
  if (guide) return;
  guide = new BrowserWindow({ width: GUIDE_W, height: GUIDE_H, show: false, frame: false, transparent: true, hasShadow: false, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, focusable: false, alwaysOnTop: true,
    webPreferences: { contextIsolation: true, sandbox: true, autoplayPolicy: 'no-user-gesture-required' } });
  guide.setAlwaysOnTop(true, 'screen-saver');
  guide.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  guide.setIgnoreMouseEvents(true);
  guide.setContentProtection(process.env.TWIIN_GUIDE_CAPTURE !== '1');
  guide.loadURL(`${BASE}/guide.html`);
  guide.once('ready-to-show', () => guide?.showInactive());
  guide.on('closed', () => { guide = null; clearInterval(guideSuivi); guideSuivi = null; gx = gy = null; });
  // suit la souris en douceur, à côté du pointeur (jamais dessus), et reste dans l'écran
  guideSuivi = setInterval(() => {
    if (!guide) return;
    const p = screen.getCursorScreenPoint();
    const wa = screen.getDisplayNearestPoint(p).workArea;
    let x = p.x + 26, y = p.y + 22;
    if (x + GUIDE_W > wa.x + wa.width) x = p.x - GUIDE_W - 14;
    if (y + GUIDE_H > wa.y + wa.height) y = p.y - GUIDE_H - 10;
    x = Math.max(wa.x, x); y = Math.max(wa.y, y);
    gx = gx == null ? x : gx + (x - gx) * 0.22; gy = gy == null ? y : gy + (y - gy) * 0.22;
    guide.setBounds({ x: Math.round(gx), y: Math.round(gy), width: GUIDE_W, height: GUIDE_H });
  }, 33);
}
function fermerGuide() { if (guide) guide.close(); }
setInterval(async () => {
  const g = await fetch(BASE + '/api/guide').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  if (g.actif) ouvrirGuide(); else fermerGuide();
}, 1500);

function surveiller() {
  const J = (u) => fetch(BASE + u).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  let tuto = null, n8nVus = null;
  setInterval(async () => {
    // enregistrement (app, extension ou page Twiin) ou Holo sur ce Mac : Twiin invisible dans les captures
    const [st, etat] = await Promise.all([J('/api/actions/status'), J('/api/automations/etat')]);
    proteger(!!(rec.on || st.running || (etat.running && etat.sur_mac)));
    // vidéo de formation : passage de « en cours » à « finie »
    const t = await J('/api/tuto/status');
    if (tuto?.running && t.running === false && t.name === tuto.name && discret()) {
      const titre = ((await J('/api/tutos')).tutos || []).find((x) => x.name === t.name)?.title || 'Ta tâche';
      toast(t.error ? { kick: 'Vidéo de formation', titre: "La vidéo n'a pas pu être créée", texte: String(t.error).slice(0, 90), lien: '/videos.html', echec: true }
        : { kick: 'Vidéo de formation prête', titre, texte: 'Elle est dans « Mes vidéos ».', lien: `/videos.html#${encodeURIComponent(t.name)}` });
    }
    if (t.name || t.running != null) tuto = t;
    // automatisation n8n : l'événement « done » de la création
    const n = await J('/api/n8n/events?since=0');
    const evs = n.events || [];
    if (n8nVus != null && evs.length > n8nVus) {
      const fin = evs.slice(n8nVus).find((e) => e.type === 'done');
      const nom = evs.find((e) => e.type === 'plan')?.plan?.name || 'Ton automatisation';
      if (fin && discret()) toast(fin.ok ? { kick: 'Automatisation prête', titre: nom, texte: 'Créée et testée : elle est dans « Mes automatisations ».', lien: '/automatisations.html' }
        : { kick: 'Automatisation', titre: "La création n'a pas abouti", texte: String(fin.status || nom).slice(0, 90), lien: '/automatisations.html', echec: true });
    }
    n8nVus = evs.length < (n8nVus ?? 0) ? 0 : evs.length; // une nouvelle création repart de zéro
  }, 4000);
}

function toggle() {
  if (!win) return;
  if (win.isVisible() && win.isFocused()) win.hide();
  else { win.show(); win.focus(); }
}

// --- Capture d'écran : écran entier, sans sélecteur (le 1er écran, puis le suivant pour « + Ajouter un écran ») ---
function setupCapture() {
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, callback) => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    if (!sources.length) return callback({});
    callback({ video: sources[screenPick++ % sources.length] });
  });
}

// --- Barre des menus ---
function trayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Afficher Twiin', accelerator: SHORTCUT, click: () => { win.show(); win.focus(); } },
    { label: rec.on ? 'Terminer et analyser' : 'Enregistrer une tâche', click: () => { win.show(); win.webContents.send('cmd', { type: rec.on ? 'stop' : 'record' }); } },
    { type: 'separator' },
    { label: 'Tout arrêter (automatisations, Holo)', click: () => fetch(`${BASE}/api/automations/stop`, { method: 'POST' }).catch(() => {}) },
    { label: 'Contrôler depuis mon téléphone…', click: () => shell.openExternal(`${BASE}/telecommande.html`) },
    { label: 'Ouvrir Twiin dans le navigateur', click: () => shell.openExternal(BASE) },
    { label: 'Revoir la configuration…', click: () => { if (onb) onb.focus(); else createOnboarding(); } },
    { type: 'separator' },
    { label: 'Quitter Twiin', role: 'quit' },
  ]);
}
function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'trayTemplate.png'));
  img.setTemplateImage(true);
  tray = new Tray(img);
  tray.setToolTip('Twiin');
  tray.on('click', toggle);
  tray.on('right-click', () => tray.popUpContextMenu(trayMenu()));
}
const clock = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function paintTray() {
  clearInterval(trayTimer);
  if (rec.on && rec.since) {
    const tick = () => tray.setTitle(` ● ${clock((Date.now() - rec.since) / 1000)}`);
    tick(); trayTimer = setInterval(tick, 1000);
  } else tray.setTitle(rec.analyzing ? ' Analyse…' : '');
}

// --- Messages de la fenêtre (via preload.js) ---
ipcMain.on('rec', (_e, r) => {
  const was = rec;
  rec = r || { on: false };
  if (rec.on) proteger(true); // tout de suite au début d'un enregistrement (la fin est prise en compte par surveiller())
  if (rec.on && !was.on) { screenPick = 0; setCompact(true); }                  // enregistrement : pastille
  if (!rec.on && was.on) { setCompact(false); win.show(); }                        // fin : on montre l'analyse
  if (rec.done && !was.done && (!win.isVisible() || !win.isFocused())) {
    new Notification({ title: rec.done.n ? `Analyse terminée : « ${rec.done.name} »` : 'Analyse terminée : aucune tâche trouvée',
      body: rec.done.n ? 'Dans Twiin : créer l\'automatisation ou la vidéo de formation.' : 'Refais la tâche du début à la fin.' })
      .on('click', () => { win.show(); win.focus(); }).show();
  }
  paintTray();
});
ipcMain.on('compact', (_e, on) => setCompact(!!on));
ipcMain.on('hide', () => win.hide());
ipcMain.on('minimize', () => win.minimize()); // « − » : réduire dans le Dock
ipcMain.on('open', (_e, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });

// --- Premier lancement : installation en arrière-plan + onboarding (5 écrans) ---------------------------------------
let onb = null, installState = { running: false, done: !app.isPackaged, error: null, steps: {} };
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const needsOnboarding = () => process.env.TWIIN_ONBOARDING === '1' || (app.isPackaged && !readJson(ONBOARD_FILE)?.done);

async function runInstall() {
  if (!app.isPackaged || installState.running) return; // en développement, tout est déjà installé
  installState = { running: true, done: false, error: null, steps: {} };
  const report = (e) => { installState.steps[e.step] = e; onb?.webContents.send('ob:progress', { ...installState, last: e }); };
  try {
    await install({ resources: process.resourcesPath, dataDir: DATA_DIR, appDir: APP_DIR, version: app.getVersion(), report });
    installState.done = true;
  } catch (e) { installState.error = e.message; }
  installState.running = false;
  onb?.webContents.send('ob:progress', installState);
  if (installState.done && envReady()) ensureServer();
}
function envReady() {
  const env = fs.existsSync(path.join(APP_DIR, '.env')) ? fs.readFileSync(path.join(APP_DIR, '.env'), 'utf8') : '';
  return /^(HF_TOKEN|TWIIN_CLE)=\s*\S+/m.test(env);
}
function createOnboarding() {
  onb = new BrowserWindow({ width: 820, height: 640, minWidth: 720, minHeight: 560, title: 'Bienvenue dans Twiin', backgroundColor: '#e9ebef',
    titleBarStyle: IS_MAC ? 'hiddenInset' : 'default', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false } });
  onb.loadFile(path.join(__dirname, 'onboarding.html'));
  onb.on('closed', () => { onb = null; if (!readJson(ONBOARD_FILE)?.done) app.quit(); }); // fermé avant la fin : on quittera, sans état bancal
  runInstall();
}
// Ce que l'onboarding demande à l'app
const py = () => path.join(APP_DIR, '.venv', IS_MAC ? 'bin/python' : 'Scripts/python.exe');
const pyCheck = (code) => new Promise((res) => execFile(py(), ['-c', code], { timeout: 8000 }, (err, out) => res(err ? null : String(out).trim())));
ipcMain.handle('ob:state', () => ({ platform: process.platform, version: app.getVersion(), packaged: app.isPackaged, configured: envReady(),
  pilote: app.isPackaged && fs.existsSync(path.join(process.resourcesPath, 'twiin', 'config-pilote.env')), install: installState })); // pilote : accès déjà intégrés, pas d'écran Configuration
ipcMain.handle('ob:import', async () => {
  const r = await dialog.showOpenDialog(onb, { title: 'Fichier de configuration Twiin', properties: ['openFile', 'showHiddenFiles'],
    message: 'Choisis le fichier de configuration envoyé par l\'équipe Twiin (twiin.env ou .env)' });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  const text = fs.readFileSync(r.filePaths[0], 'utf8');
  const keys = [...text.matchAll(/^([A-Z0-9_]+)=\s*(\S+)/gm)].map((m) => m[1]); // les noms seulement, jamais les valeurs
  if (!keys.includes('HF_TOKEN') && !keys.includes('TWIIN_CLE')) return { ok: false, error: 'Ce fichier ne contient pas d\'accès Twiin : ce n\'est pas une configuration Twiin.' };
  const dest = path.join(APP_DIR, '.env');
  fs.mkdirSync(APP_DIR, { recursive: true });
  if (fs.existsSync(dest)) fs.copyFileSync(dest, `${dest}.ancien`);
  fs.writeFileSync(dest, text, { mode: 0o600 });
  if (installState.done) ensureServer();
  return { ok: true, keys };
});
ipcMain.handle('ob:perms', async () => {
  if (!IS_MAC) return { screen: true, accessibility: true, input: true };
  const input = fs.existsSync(py()) ? (await pyCheck('import Quartz; print(Quartz.CGPreflightListenEventAccess())')) === 'True' : null;
  return { screen: systemPreferences.getMediaAccessStatus('screen') === 'granted', accessibility: systemPreferences.isTrustedAccessibilityClient(false), input };
});
const PANES = { screen: 'Privacy_ScreenCapture', accessibility: 'Privacy_Accessibility', input: 'Privacy_ListenEvent' };
ipcMain.handle('ob:ask', async (_e, kind) => {
  if (kind === 'screen') await desktopCapturer.getSources({ types: ['screen'] }).catch(() => {}); // Twiin apparaît dans la liste
  if (kind === 'accessibility') systemPreferences.isTrustedAccessibilityClient(true);
  if (kind === 'input' && fs.existsSync(py())) await pyCheck('import Quartz; Quartz.CGRequestListenEventAccess()');
  shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${PANES[kind]}`);
});
ipcMain.handle('ob:relaunch', () => { app.relaunch(); app.exit(0); });
const EXT_DIR = path.join(DATA_DIR, 'Extension Chrome');
ipcMain.handle('ob:ext:prepare', () => {
  fs.cpSync(path.join(APP_DIR, 'extension'), EXT_DIR, { recursive: true, force: true }); // dossier fixe, à choisir dans Chrome
  return EXT_DIR;
});
ipcMain.handle('ob:ext:chrome', () => {
  if (IS_MAC) spawn('open', ['-a', 'Google Chrome', 'chrome://extensions']);
  else spawn('cmd', ['/c', 'start', 'chrome', 'chrome://extensions'], { windowsHide: true });
});
ipcMain.handle('ob:ext:show', () => shell.openPath(EXT_DIR));
ipcMain.handle('ob:ext:copy', () => clipboard.writeText(EXT_DIR));
ipcMain.handle('ob:ext:status', async () => {
  try { return await (await fetch(`${BASE}/api/extension/status`)).json(); } catch { return { connected: false, server: false }; }
});
ipcMain.handle('ob:login', (_e, on) => {
  if (typeof on === 'boolean') app.setLoginItemSettings({ openAtLogin: on });
  return app.getLoginItemSettings().openAtLogin;
});
ipcMain.handle('ob:finish', async () => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(ONBOARD_FILE, JSON.stringify({ done: true, at: new Date().toISOString(), version: app.getVersion() }));
  await startApp();
  onb?.close();
  shell.openExternal(`${BASE}/#audit`); // l'audit s'ouvre dans le navigateur
});

// --- Démarrage ---
let started = false;
async function startApp() {
  if (started) return;
  started = true;
  setupCapture();
  setupVoice(session.defaultSession, new URL(BASE).origin);
  createTray();
  createWindow();
  if (!globalShortcut.register(SHORTCUT, toggle)) console.warn(`Raccourci ${SHORTCUT} déjà pris par une autre appli.`);
  const ok = await ensureServer();
  if (ok) { win.loadURL(`${BASE}/ext/desktop.html`); surveiller(); }
  else win.webContents.executeJavaScript("document.body.dataset.state = 'fail'");
}
app.whenReady().then(async () => {
  // Icône dans le Dock (et ⌘Tab) : sur un Mac à encoche, l'icône de la barre des menus peut être masquée
  app.dock?.setIcon(nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')));
  if (needsOnboarding()) return createOnboarding();
  if (app.isPackaged) await runInstall(); // mise à jour : recopie le code si la version a changé (rapide), sinon rien
  startApp();
});
app.on('before-quit', () => { app.isQuitting = true; });
app.on('activate', () => { if (onb) onb.focus(); else if (win) { win.show(); win.focus(); } }); // clic sur l'icône du Dock
app.on('will-quit', () => { globalShortcut.unregisterAll(); if (server) server.kill('SIGTERM'); }); // on n'arrête que le serveur qu'on a lancé
app.on('window-all-closed', (e) => e.preventDefault());
