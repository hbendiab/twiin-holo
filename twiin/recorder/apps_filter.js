// Fausses applis : applis ou fenêtres ouvertes par erreur pendant un enregistrement, hors tâche.
// Pur (aucun accès disque) pour être testable. Règle d'or : dans le doute, l'appli reste comptée.

const NOT_ACTIONS = ['start', 'stop', 'error', 'voice'];
const MARGINAL_MAX_S = 10;       // moins de 10 s cumulées…
const MARGINAL_MAX_SHARE = 0.1;  // …et moins de 10 % de la durée
export const isCopy = (e) => e.type === 'shortcut' && /C$/i.test(e.keys || '');
export const isPaste = (e) => e.type === 'shortcut' && /V$/i.test(e.keys || '');

const actionsOf = (events) => events.filter((e) => e?.type && !NOT_ACTIONS.includes(e.type));

// Temps passé par appli : chaque événement dure jusqu'au suivant (le dernier, jusqu'à la fin du journal).
export function timePerApp(events) {
  const ev = actionsOf(events);
  const perApp = {};
  if (!ev.length) return { perApp, t0: 0, t1: 0 };
  const t0 = ev[0].ts, t1 = Math.max(...ev.map((e) => e.until || e.ts));
  for (let i = 0; i < ev.length; i++) {
    const end = i + 1 < ev.length ? ev[i + 1].ts : t1;
    if (ev[i].app) perApp[ev[i].app] = (perApp[ev[i].app] || 0) + Math.max(0, end - ev[i].ts);
  }
  return { perApp, t0, t1 };
}

// Une ligne par appli vue : mesures et, si elle ressemble à une appli ouverte par erreur, « suggested_off » + la raison.
export function appReport(events) {
  const ev = actionsOf(events);
  const { perApp, t0, t1 } = timePerApp(events);
  const total = t1 - t0;
  const apps = Object.keys(perApp);
  const top = apps.sort((a, b) => perApp[b] - perApp[a])[0];
  // La première et la dernière appli de la tâche ne sont jamais suggérées (ex. un dernier clic sur « Envoyer » dans Mail)
  const withApp = ev.filter((e) => e.app);
  const first = withApp.reduce((m, e) => (e.ts < m.ts ? e : m), withApp[0] || {}).app;
  const last = withApp.reduce((m, e) => ((e.until || e.ts) >= (m.until || m.ts) ? e : m), withApp[0] || {}).app;
  return apps.map((app) => {
    const mine = ev.filter((e) => e.app === app);
    const typing = mine.filter((e) => e.type === 'typing').length;
    const copies = mine.filter(isCopy).length, pastes = mine.filter(isPaste).length;
    const time = perApp[app];
    const marginal = app !== top && app !== first && app !== last && time < MARGINAL_MAX_S && total > 0 && time / total < MARGINAL_MAX_SHARE
      && typing === 0 && copies + pastes === 0;
    return {
      app, time_s: Math.round(time), suggested_off: marginal,
      reason: marginal ? `${Math.round(time)} s seulement, aucune saisie, aucun copier-coller` : null,
    };
  });
}

// Applis exclues : le choix de l'employé s'il existe, sinon les suggestions automatiques.
export function effectiveExcluded(events, choice) {
  if (Array.isArray(choice)) return choice;
  return appReport(events).filter((a) => a.suggested_off).map((a) => a.app);
}

// Retire les événements des applis exclues (la voix et le début/fin d'enregistrement n'ont pas d'appli : gardés).
export function filterEvents(events, excluded) {
  if (!excluded?.length) return events;
  const out = new Set(excluded);
  return events.filter((e) => !(e?.app && out.has(e.app)));
}

// Temps cumulé des applis exclues, mesuré sur le journal COMPLET (un événement dure jusqu'au suivant : retirer les événements
// avant de mesurer reverserait le temps de la fausse appli à l'appli précédente).
export function excludedTime(events, excluded) {
  const { perApp } = timePerApp(events);
  return (excluded || []).reduce((n, a) => n + (perApp[a] || 0), 0);
}
