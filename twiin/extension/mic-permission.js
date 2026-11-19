// Twiin · page d'autorisation du micro (extension Chrome). Le panneau latéral ne peut pas afficher la demande : elle se fait ici, une fois,
// et vaut ensuite pour tout le panneau. Le résultat est annoncé à voice.js (message « twiin:mic »), puis la page se ferme.
const msg = document.getElementById('msg');
document.getElementById('allow').onclick = async () => {
  let ok = false;
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop()); // on voulait seulement l'autorisation
    ok = true;
  } catch (e) {
    msg.textContent = `Micro refusé (${e.name}). Autorise-le dans les réglages de Chrome (cadenas de la barre d'adresse), puis réessaie.`;
  }
  try { await chrome.runtime.sendMessage({ type: 'twiin:mic', ok }); } catch { /* le panneau est peut-être fermé */ }
  if (ok) { msg.textContent = 'C\'est autorisé. Tu peux fermer cet onglet.'; setTimeout(() => window.close(), 600); }
};
