// Fusion des passages de voix dans le journal d'actions.
// Les actions gardent EXACTEMENT leur ordre d'origine (le journal écrit une saisie après coup, avec l'heure de son
// début : l'ordre du fichier n'est donc pas l'ordre des heures) ; chaque passage de voix est inséré juste avant la
// première entrée plus tardive que lui. Sans voix, la liste est renvoyée telle quelle.
export function mergeVoice(actions, voiceEvents) {
  if (!voiceEvents?.length) return actions;
  const out = [...actions];
  for (const v of [...voiceEvents].sort((a, b) => a.ts - b.ts)) {
    const i = out.findIndex((e) => (e.ts || 0) > v.ts);
    if (i < 0) out.push(v); else out.splice(i, 0, v);
  }
  return out;
}
