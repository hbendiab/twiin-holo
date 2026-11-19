// Cadence de l'enregistreur : un worker n'est pas ralenti quand la fenêtre est réduite (contrairement à setInterval).
setInterval(() => postMessage(0), 1000);
