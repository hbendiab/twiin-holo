// Tests de l'autorisation du micro dans l'extension Chrome (extension/voice.js) : permissions, onglet d'autorisation, messages simulés.
import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

function setup({ perm = 'prompt', answer = 'ok', tabs = true } = {}) {
  const log = [], listeners = [];
  globalThis.localStorage = { getItem: () => '1', setItem() {} };
  globalThis.chrome = {
    runtime: { sendMessage: async () => ({ base: 'http://x', token: 'T' }), getURL: (p) => `chrome-extension://id/${p}`,
      onMessage: { addListener: (f) => listeners.push(f), removeListener: (f) => listeners.splice(listeners.indexOf(f), 1) } },
    ...(tabs ? { tabs: { create: async ({ url }) => { log.push(['tab', url]); if (answer !== 'never') setTimeout(() => listeners.slice().forEach((f) => f({ type: 'twiin:mic', ok: answer === 'ok' })), 0); } } } : {}),
  };
  const stream = { getTracks: () => [] };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    permissions: perm === 'throw' ? { query: async () => { throw new Error('x'); } } : { query: async () => ({ state: perm }) },
    mediaDevices: { getUserMedia: async () => { log.push(['mic']); return stream; } } } });
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ready: true }) });
  delete globalThis.twiinDesktop;
  delete require.cache[require.resolve('../extension/voice.js')];
  return { Voice: require('../extension/voice.js'), log, listeners, stream };
}

test('micro déjà autorisé : pas d\'onglet, le micro s\'ouvre', async () => {
  const { Voice, log, stream } = setup({ perm: 'granted' });
  await Voice.refresh();
  assert.equal(await Voice.open(), stream);
  assert.deepEqual(log, [['mic']]);
});

test('micro non autorisé : onglet d\'autorisation, attente de la réponse, puis le micro s\'ouvre', async () => {
  const { Voice, log, listeners, stream } = setup({ perm: 'prompt', answer: 'ok' });
  await Voice.refresh();
  assert.equal(await Voice.open(), stream);
  assert.deepEqual(log, [['tab', 'chrome-extension://id/mic-permission.html'], ['mic']]);
  assert.equal(listeners.length, 0); // l'écouteur est retiré
});

test('autorisation refusée sur la page : avertissement, enregistrement sans voix, pas d\'exception', async () => {
  const { Voice, log } = setup({ perm: 'prompt', answer: 'no' });
  await Voice.refresh();
  assert.equal(await Voice.open(), null);
  assert.match(Voice.state.warning, /Micro non disponible[\s\S]*sans la voix/);
  assert.ok(!log.some((l) => l[0] === 'mic'));
});

test('état des permissions illisible : on tente le micro directement, sans onglet', async () => {
  const { Voice, log, stream } = setup({ perm: 'throw' });
  await Voice.refresh();
  assert.equal(await Voice.open(), stream);
  assert.ok(!log.some((l) => l[0] === 'tab'));
});

test('pas d\'API d\'onglets (page web / app Mac) : comportement inchangé', async () => {
  const { Voice, log, stream } = setup({ perm: 'prompt', tabs: false });
  await Voice.refresh();
  assert.equal(await Voice.open(), stream);
  assert.deepEqual(log, [['mic']]);
});
