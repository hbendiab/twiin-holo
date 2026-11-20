// Tests de extension/capture.js : « Réanalyser » et l'étape « voix » de l'analyse. Le fichier est chargé comme un script de navigateur
// (vm), avec le réseau, l'écran et le micro simulés.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';

function load({ analyse = { workflows: [{ name: 'Tâche' }] }, voice } = {}) {
  const calls = [], reports = [];
  const fetch = async (url, o = {}) => {
    calls.push({ url, method: o.method || 'GET', auth: o.headers?.Authorization });
    const body = url.includes('/api/actions/start') ? { session: 's1' }
      : url.includes('/api/analysis/progress') ? { phase: 'model' }
      : url.includes('/api/actions') && !url.includes('stop') ? { events: [], next: 0 }
      : url.includes('/api/reanalyze') || url.includes('/api/generate-workflows') ? analyse : {};
    return { ok: true, json: async () => body };
  };
  const track = { label: 'screen:1:0', addEventListener() {}, stop() {} };
  const ctx = vm.createContext({
    fetch, console, setTimeout, clearTimeout, setInterval, clearInterval, AbortSignal, // capture.js coupe les appels trop longs
    Worker: class { set onmessage(f) {} }, ImageCapture: class { grabFrame() { return Promise.resolve(null); } },
    navigator: { mediaDevices: { getDisplayMedia: async () => ({ getVideoTracks: () => [track], getTracks: () => [track] }) } },
    document: { createElement: () => ({}) },
    Voice: voice && { ...voice, report: (m) => reports.push(m) },
  });
  ctx.globalThis = ctx;
  vm.runInContext(fs.readFileSync(new URL('../extension/capture.js', import.meta.url), 'utf8'), ctx);
  const Capture = vm.runInContext('Capture', ctx);
  Capture.config({ base: 'http://x', token: 'T' });
  return { Capture, calls, reports };
}

test('Réanalyser : appelle /api/reanalyze avec le jeton, garde le résultat, transmet le compte rendu de la voix', async () => {
  const { Capture, calls, reports } = load({ analyse: { workflows: [{ name: 'A' }, { name: 'B' }], _meta: { voice: { status: 'empty' } } }, voice: { state: {} } });
  await Capture.reanalyze();
  const c = calls.find((x) => x.url.endsWith('/api/reanalyze'));
  assert.equal(c.method, 'POST'); assert.equal(c.auth, 'Bearer T');
  assert.equal(Capture.state.result.workflows.length, 2);
  assert.equal(Capture.state.analyzing, false); assert.equal(Capture.state.phase, null);
  assert.deepEqual(reports, [{ status: 'empty' }]);
});

test('Réanalyser : une erreur du serveur est affichée, pas une exception', async () => {
  const { Capture } = load({ analyse: { error: 'Aucun enregistrement à relancer.' } });
  await Capture.reanalyze();
  assert.match(Capture.state.error, /Aucun enregistrement à relancer/);
  assert.equal(Capture.state.analyzing, false);
});

test('Réanalyser : ignoré pendant une analyse déjà en cours', async () => {
  const { Capture, calls } = load();
  const first = Capture.reanalyze();
  await Capture.reanalyze();
  await first;
  assert.equal(calls.filter((x) => x.url.endsWith('/api/reanalyze')).length, 1);
});

test('enregistrement avec micro actif : l\'analyse aura l\'étape voix ; sans micro, non', async () => {
  for (const recording of [true, false]) {
    const { Capture } = load({ voice: { state: { recording }, open: async () => ({ getTracks: () => [] }), start() {}, stop: async () => true, cancel() {} } });
    await Capture.start({ fromClick: true });
    await Capture.stop();
    assert.equal(Capture.state.hadVoice, recording);
  }
});
