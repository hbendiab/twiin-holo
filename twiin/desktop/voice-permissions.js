// Twiin pour le Mac · autorisation du micro (capture vocale). Module à part : main.js l'appelle une seule fois au démarrage.
// En `npm start`, macOS demande l'autorisation pour Electron / le Terminal ; dans une app empaquetée il faudra aussi le texte
// NSMicrophoneUsageDescription (voir README).
const { systemPreferences, ipcMain } = require('electron');

function setupVoice(session, origin) {
  const ours = (url) => { try { return new URL(url).origin === origin; } catch { return false; } };
  const audioOnly = (details) => (details?.mediaTypes || ['audio']).every((t) => t === 'audio');
  // Seul le micro est filtré (audio, page Twiin uniquement) ; tout le reste reste accordé comme avant (capture d'écran…).
  session.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (permission !== 'media') return callback(true);
    callback(audioOnly(details) && ours(details?.requestingUrl || wc.getURL()));
  });
  session.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) =>
    permission !== 'media' || (ours(requestingOrigin) && (details?.mediaType || 'audio') === 'audio'));
  // La fenêtre demande l'autorisation macOS avant d'ouvrir le micro : true = accordée.
  ipcMain.handle('voice:ask-mic', async () => {
    try {
      const st = systemPreferences.getMediaAccessStatus('microphone');
      if (st === 'granted') return true;
      if (st === 'denied' || st === 'restricted') return false; // à changer dans Réglages Système → Confidentialité → Micro
      return await systemPreferences.askForMediaAccess('microphone');
    } catch { return false; }
  });
}
module.exports = { setupVoice };
