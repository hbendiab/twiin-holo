// Twiin pour le Mac (Electron) : une icône dans la barre des menus et une fenêtre flottante, par-dessus toutes les
// applis (Excel, Outlook, Finder…), qui s'ouvre et se ferme avec ⌥⌘T, l'icône du Dock ou celle de la barre des menus. Pendant un enregistrement, elle devient une
// petite pastille (chrono + Terminer). Elle n'apparaît jamais dans les images enregistrées (protection de contenu).
// Le contenu est le même que le panneau de l'extension Chrome (extension/panel.js), servi par le serveur Twiin local.
const { app, BrowserWindow, Tray, Menu, globalShortcut, desktopCapturer, session, shell, ipcMain, nativeImage, screen, Notification } = require('electron');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setupVoice } = require('./voice-permissions'); // autorisation du micro (capture vocale)

const BASE = 'http://localhost:3000';
const RECORDER_DIR = path.join(__dirname, '..', 'recorder');
const SHORTCUT = 'Alt+Command+T'; // ⌥⌘T, comme l'ancien raccourci Twiin
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

// --- Démarrage ---
app.whenReady().then(async () => {
  // Icône dans le Dock (et ⌘Tab) : sur un Mac à encoche, l'icône de la barre des menus peut être masquée
  app.dock?.setIcon(nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')));
  setupCapture();
  setupVoice(session.defaultSession, new URL(BASE).origin);
  createTray();
  createWindow();
  if (!globalShortcut.register(SHORTCUT, toggle)) console.warn(`Raccourci ${SHORTCUT} déjà pris par une autre appli.`);
  const ok = await ensureServer();
  if (ok) win.loadURL(`${BASE}/ext/desktop.html`);
  else win.webContents.executeJavaScript("document.body.dataset.state = 'fail'");
});
app.on('before-quit', () => { app.isQuitting = true; });
app.on('activate', () => { if (win) { win.show(); win.focus(); } }); // clic sur l'icône du Dock
app.on('will-quit', () => { globalShortcut.unregisterAll(); if (server) server.kill('SIGTERM'); }); // on n'arrête que le serveur qu'on a lancé
app.on('window-all-closed', (e) => e.preventDefault());
