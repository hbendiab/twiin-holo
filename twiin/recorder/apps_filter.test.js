import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appReport, effectiveExcluded, excludedTime, filterEvents, timePerApp } from './apps_filter.js';

const ev = (ts, type, app, extra = {}) => ({ ts, type, app, ...extra });
// 60 s de vraie tâche (Numbers ↔ Notion), puis 2 applis ouvertes par erreur
const base = [
  { ts: 0, type: 'start' },
  ev(0, 'app', 'Numbers'), ev(5, 'click', 'Numbers'), ev(10, 'shortcut', 'Numbers', { keys: '⌘C' }),
  ev(12, 'app', 'Google Chrome'), ev(14, 'shortcut', 'Google Chrome', { keys: '⌘V' }), ev(20, 'typing', 'Google Chrome', { until: 30, keys: 12 }),
  ev(30, 'app', 'Numbers'), ev(35, 'click', 'Numbers'),
  ev(40, 'app', 'Ollama'), ev(41, 'click', 'Ollama'),
  ev(44, 'app', 'OpenChamber'), ev(45, 'click', 'OpenChamber'),
  ev(46, 'app', 'Numbers'), ev(55, 'click', 'Numbers'), ev(60, 'shortcut', 'Numbers', { keys: '⌘C' }),
  { ts: 61, type: 'stop' },
];

test('les applis ouvertes par erreur sont suggérées, les autres non', () => {
  const r = Object.fromEntries(appReport(base).map((a) => [a.app, a]));
  assert.equal(r.Ollama.suggested_off, true);
  assert.equal(r.OpenChamber.suggested_off, true);
  assert.equal(r.Numbers.suggested_off, false);
  assert.equal(r['Google Chrome'].suggested_off, false); // saisie + collage
  assert.deepEqual(effectiveExcluded(base, null).sort(), ['Ollama', 'OpenChamber']);
});

test('dans le doute, l\'appli reste comptée', () => {
  // appli courte mais avec un copier-coller : gardée
  const withPaste = [...base, ev(50, 'shortcut', 'Ollama', { keys: '⌘V' })];
  assert.equal(appReport(withPaste).find((a) => a.app === 'Ollama').suggested_off, false);
  // une seule appli, même brève : jamais suggérée
  const solo = [ev(0, 'app', 'Numbers'), ev(2, 'click', 'Numbers')];
  assert.deepEqual(effectiveExcluded(solo, null), []);
  // pas d'événements : pas d'erreur
  assert.deepEqual(appReport([]), []);
});

test('le choix de l\'employé remplace les suggestions (y compris « tout garder »)', () => {
  assert.deepEqual(effectiveExcluded(base, []), []);
  assert.deepEqual(effectiveExcluded(base, ['Numbers']), ['Numbers']);
});

test('filterEvents retire l\'appli partout et garde voix et début/fin', () => {
  const withVoice = [...base, { ts: 42, type: 'voice', text: 'pas dans la tâche' }];
  const out = filterEvents(withVoice, ['Ollama', 'OpenChamber']);
  assert.equal(out.some((e) => ['Ollama', 'OpenChamber'].includes(e.app)), false);
  assert.equal(out.length, withVoice.length - 4);
  assert.equal(out.filter((e) => e.type === 'voice').length, 1);
  assert.equal(filterEvents(base, []), base);
  // recocher = ne plus l'exclure : tout revient
  assert.equal(filterEvents(base, effectiveExcluded(base, [])).length, base.length);
});

test('temps par appli : le temps d\'une fausse appli ne reste pas dans les chiffres', () => {
  const before = timePerApp(base).perApp;
  assert.ok(before.Ollama > 0);
  const after = timePerApp(filterEvents(base, ['Ollama', 'OpenChamber'])).perApp;
  assert.equal(after.Ollama, undefined);
  assert.equal(after.OpenChamber, undefined);
});

test('le temps d\'une fausse appli est retiré, pas reversé à l\'appli précédente', () => {
  // Ollama 40→44 = 4 s, OpenChamber 44→46 = 2 s (valeurs lues à la main dans `base`)
  assert.equal(excludedTime(base, ['Ollama', 'OpenChamber']), 6);
  assert.equal(excludedTime(base, []), 0);
});

test('la dernière (et la première) appli de la tâche n\'est jamais suggérée', () => {
  const lastStep = [ev(0, 'app', 'Numbers'), ev(10, 'shortcut', 'Numbers', { keys: '⌘C' }), ev(90, 'click', 'Numbers'),
    ev(91, 'app', 'Mail'), ev(92, 'click', 'Mail'), { ts: 94, type: 'stop' }];
  assert.deepEqual(effectiveExcluded(lastStep, null), []);
  const firstStep = [ev(0, 'app', 'Mail'), ev(1, 'click', 'Mail'), ev(3, 'app', 'Numbers'), ev(10, 'shortcut', 'Numbers', { keys: '⌘C' }), ev(90, 'click', 'Numbers')];
  assert.deepEqual(effectiveExcluded(firstStep, null), []);
});

// Une appli de 3 s au milieu d'une tâche de 90 s : chaque signe d'activité réelle doit suffire à la garder.
const middle = (...extra) => [ev(0, 'app', 'Numbers'), ev(10, 'click', 'Numbers'), ev(40, 'app', 'Calculatrice'), ev(41, 'click', 'Calculatrice'),
  ...extra, ev(43, 'app', 'Numbers'), ev(90, 'click', 'Numbers')];
test('une appli brève au milieu est suggérée seulement sans aucun signe d\'activité réelle', () => {
  assert.deepEqual(effectiveExcluded(middle(), null), ['Calculatrice']);
  assert.deepEqual(effectiveExcluded(middle(ev(42, 'typing', 'Calculatrice', { until: 42.5, keys: 3 })), null), []);
  assert.deepEqual(effectiveExcluded(middle(ev(42, 'shortcut', 'Calculatrice', { keys: '⌘C' })), null), []);
  assert.deepEqual(effectiveExcluded(middle(ev(42, 'shortcut', 'Calculatrice', { keys: '⌘V' })), null), []);
});

test('une appli de plus de 10 s ou de plus de 10 % de la tâche est gardée', () => {
  const long = [ev(0, 'app', 'Numbers'), ev(10, 'click', 'Numbers'), ev(40, 'app', 'Calculatrice'), ev(41, 'click', 'Calculatrice'),
    ev(55, 'app', 'Numbers'), ev(300, 'click', 'Numbers')]; // 15 s > 10 s
  assert.deepEqual(effectiveExcluded(long, null), []);
  const share = [ev(0, 'app', 'Numbers'), ev(10, 'click', 'Numbers'), ev(40, 'app', 'Calculatrice'), ev(41, 'click', 'Calculatrice'),
    ev(48, 'app', 'Numbers'), ev(70, 'click', 'Numbers')]; // 8 s, mais 8/70 = 11 % > 10 %
  assert.deepEqual(effectiveExcluded(share, null), []);
});

// Vraie session de Louis (données locales, absentes du dépôt public) : le test est ignoré s'il n'y a pas le fichier.
const real = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'workflows', 'sessions', '2026-11-18T16-07-16', 'actions.jsonl');
test('session réelle du 18/11 : Ollama et OpenChamber détectés, Numbers et Chrome gardés', { skip: !fs.existsSync(real) }, () => {
  const events = fs.readFileSync(real, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    .filter((e) => !/localhost:3000|Twiin · Enregistrement/i.test(e.window || ''));
  const rep = Object.fromEntries(appReport(events).map((a) => [a.app, a]));
  assert.equal(rep.Ollama.suggested_off, true);
  assert.equal(rep.OpenChamber.suggested_off, true);
  assert.equal(rep.Numbers.suggested_off, false);
  assert.equal(rep['Google Chrome'].suggested_off, false);
  assert.deepEqual(effectiveExcluded(events, null).sort(), ['Ollama', 'OpenChamber']);
});
