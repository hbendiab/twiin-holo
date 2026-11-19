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
const PILL = { width: 340, height: 64 };

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
  win.setBounds({ x: Math.round(workArea.x + (workArea.width - PILL.width) / 2), y: workArea.y + 10, width: PILL.width, height: PILL.height });
}
function setCompact(on) {
  compact = on;
  if (!win) return;
  win.setResizable(!on);
  on ? placePill() : placeFull();
  win.webContents.send('compact', on);
}
function createWindow() {
  win = new BrowserWindow({
    ...FULL, show: false, frame: false, transparent: false, backgroundColor: '#e9ebef', roundedCorners: true, hasShadow: true,
    resizable: true, minimizable: false, fullscreenable: false, alwaysOnTop: true, title: 'Twiin',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setContentProtection(true); // la fenêtre Twiin n'apparaît pas dans les images de la tâche
  placeFull();
  win.loadFile(path.join(__dirname, 'loading.html'));
  win.once('ready-to-show', () => win.show());
  win.on('close', (e) => { if (!app.isQuitting) { e.preventDefault(); win.hide(); } }); // fermer = cacher
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
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
  createTray();
  createWindow();
  if (!globalShortcut.register(SHORTCUT, toggle)) console.warn(`Raccourci ${SHORTCUT} déjà pris par une autre appli.`);
  const ok = await ensureServer();
  if (ok) win.loadURL(`${BASE}/ext/desktop.html`);
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
