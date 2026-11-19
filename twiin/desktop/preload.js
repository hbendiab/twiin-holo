// Pont entre la fenêtre Twiin (page du serveur local) et l'app : pastille, fermeture, liens externes, ordres du menu.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('twiinDesktop', {
  rec: (r) => ipcRenderer.send('rec', r),
  setCompact: (on) => ipcRenderer.send('compact', on),
  hide: () => ipcRenderer.send('hide'),
  openExternal: (url) => ipcRenderer.send('open', url),
  onCommand: (fn) => ipcRenderer.on('cmd', (_e, m) => fn(m)),
  onCompact: (fn) => ipcRenderer.on('compact', (_e, on) => fn(on)),
});
