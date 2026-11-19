// Tests de extension/reco.js (« Reco » du panneau Mac) : script de navigateur chargé via vm, serveur et stockage simulés.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';

const ADV = { stats: { duration_s: 90 }, recommendations: [{ title: 'Raccourci', gain: '-20 s', suggestion: 'Utilise <Cmd>+V' }], cost_usd: 0.005 };
const VER = (v = 'Automatiser') => ({ verdict: v, reasons: ['Répétitif'], time_saved: '2 h/mois', frequency_hint: 'Chaque jour', cost_usd: 0.006 });

function load({ responses = {}, store = {} } = {}) {
  const calls = [], updates = [];
  const api = async (path, o = {}) => {
    calls.push({ path, method: o.method, body: o.body });
    const r = responses[path];
    return typeof r === 'function' ? r() : r ?? {};
  };
  const localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
  const ctx = vm.createContext({ console, localStorage });
  vm.runInContext(fs.readFileSync(new URL('../extension/reco.js', import.meta.url), 'utf8'), ctx);
  const Reco = vm.runInContext('Reco', ctx);
  Reco.config({ api, onUpdate: () => updates.push(Reco.state(T).status) });
  return { Reco, calls, updates, store };
}
const T = { name: 'Saisie', steps: ['a', 'b'], session: 's1', task_id: 7 };

test('avant le clic : bouton « Voir la recommandation », aucun appel', () => {
  const { Reco, calls } = load();
  assert.match(Reco.html(T), /data-act="reco"[^>]*>Voir la recommandation/);
  assert.equal(Reco.primary(T), null); assert.equal(calls.length, 0);
});

test('Automatiser : 2 appels, verdict, gain, raisons, conseils échappés, coût, bouton auto mis en avant, enregistrement', async () => {
  const { Reco, calls, updates } = load({ responses: { '/api/process-advice': ADV, '/api/verdict': VER() } });
  await Reco.run(T);
  assert.deepEqual(updates, ['running', 'done']);
  const paths = calls.map((c) => c.path).sort();
  assert.deepEqual(paths, ['/api/process-advice', '/api/recommendations', '/api/verdict']);
  const rec = calls.find((c) => c.path === '/api/recommendations');
  assert.equal(rec.method, 'POST'); assert.equal(rec.body.task_id, 7); assert.equal(rec.body.verdict.verdict, 'Automatiser');
  const h = Reco.html(T);
  assert.match(h, /Automatiser cette tâche/); assert.match(h, /Gain estimé : 2 h\/mois · Chaque jour/);
  assert.match(h, /Répétitif/); assert.match(h, /Pour aller plus vite/); assert.match(h, /Utilise &lt;Cmd&gt;\+V/);
  assert.match(h, /≈ 0,011 \$/); assert.equal(Reco.primary(T), 'auto');
});

test('Accélérer : bouton vidéo mis en avant', async () => {
  const { Reco } = load({ responses: { '/api/process-advice': ADV, '/api/verdict': VER('Accélérer') } });
  await Reco.run(T);
  assert.match(Reco.html(T), /Accélérer cette tâche/); assert.equal(Reco.primary(T), 'tuto');
});

test('même tâche, mêmes étapes : cache, aucun appel (même après rechargement), pas de ré-enregistrement', async () => {
  const first = load({ responses: { '/api/process-advice': ADV, '/api/verdict': VER() } });
  await first.Reco.run(T);
  const second = load({ responses: {}, store: first.store });
  await second.Reco.run(T);
  assert.equal(second.calls.length, 0); assert.equal(second.Reco.primary(T), 'auto');
});

test('étapes changées : nouvelle clé, nouveau calcul', async () => {
  const { Reco, calls } = load({ responses: { '/api/process-advice': ADV, '/api/verdict': VER() } });
  await Reco.run(T);
  await Reco.run({ ...T, steps: ['a', 'b', 'c'] });
  assert.equal(calls.filter((c) => c.path === '/api/verdict').length, 2);
});

test('erreur serveur : message + Réessayer, rien en cache, pas d\'enregistrement ; le réessai marche', async () => {
  let ok = false;
  const { Reco, calls, store } = load({ responses: { '/api/process-advice': ADV, '/api/verdict': () => (ok ? VER() : { error: 'modèle indisponible' }) } });
  await Reco.run(T);
  assert.match(Reco.html(T), /Recommandation impossible[\s\S]*modèle indisponible[\s\S]*Réessayer/);
  assert.equal(Reco.primary(T), null); assert.equal(Object.keys(store).length, 0);
  assert.ok(!calls.some((c) => c.path === '/api/recommendations'));
  ok = true; await Reco.run(T);
  assert.equal(Reco.primary(T), 'auto');
});

test('double clic pendant le calcul : un seul calcul ; la reco d\'une autre tâche reste séparée', async () => {
  const { Reco, calls } = load({ responses: { '/api/process-advice': ADV, '/api/verdict': VER() } });
  await Promise.all([Reco.run(T), Reco.run(T)]);
  assert.equal(calls.filter((c) => c.path === '/api/verdict').length, 1);
  assert.equal(Reco.primary({ ...T, name: 'Autre' }), null);
});

test('l\'échec de l\'enregistrement n\'empêche pas l\'affichage', async () => {
  const { Reco } = load({ responses: { '/api/process-advice': ADV, '/api/verdict': VER(), '/api/recommendations': () => { throw new Error('x'); } } });
  await Reco.run(T);
  assert.equal(Reco.primary(T), 'auto');
});
