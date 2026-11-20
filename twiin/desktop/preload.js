// Pont entre la fenêtre Twiin (page du serveur local) et l'app : pastille, fermeture, liens externes, ordres du menu.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('twiinDesktop', {
  rec: (r) => ipcRenderer.send('rec', r),
  setCompact: (on) => ipcRenderer.send('compact', on),
  hide: () => ipcRenderer.send('hide'),
  minimize: () => ipcRenderer.send('minimize'),
  askMic: () => ipcRenderer.invoke('voice:ask-mic'),
  openExternal: (url) => ipcRenderer.send('open', url),
  closeToast: () => ipcRenderer.send('toast:close'), // notification Twiin (toast.html)
  onCommand: (fn) => ipcRenderer.on('cmd', (_e, m) => fn(m)),
  onCompact: (fn) => ipcRenderer.on('compact', (_e, on) => fn(on)),
});

// Onboarding du premier lancement (onboarding.html) : installation, configuration, autorisations, extension
contextBridge.exposeInMainWorld('twiinSetup', {
  state: () => ipcRenderer.invoke('ob:state'),
  onProgress: (fn) => ipcRenderer.on('ob:progress', (_e, st) => fn(st)),
  importConfig: () => ipcRenderer.invoke('ob:import'),
  perms: () => ipcRenderer.invoke('ob:perms'),
  ask: (kind) => ipcRenderer.invoke('ob:ask', kind),
  relaunch: () => ipcRenderer.invoke('ob:relaunch'),
  extPrepare: () => ipcRenderer.invoke('ob:ext:prepare'),
  extChrome: () => ipcRenderer.invoke('ob:ext:chrome'),
  extShow: () => ipcRenderer.invoke('ob:ext:show'),
  extCopy: () => ipcRenderer.invoke('ob:ext:copy'),
  extStatus: () => ipcRenderer.invoke('ob:ext:status'),
  login: (on) => ipcRenderer.invoke('ob:login', on),
  finish: () => ipcRenderer.invoke('ob:finish'),
});
