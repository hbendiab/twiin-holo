// Tests de extension/voice.js (capture vocale de l'app Mac) avec micro, MediaRecorder et réseau simulés.
import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

function setup({ ready = true, checked = true, mic = 'ok', post = 200 } = {}) {
  const calls = [];
  const store = { 'twiin.voice': checked ? '1' : '0' };
  globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
  globalThis.chrome = { runtime: { sendMessage: async () => ({ base: 'http://x', token: 'T' }) } };
  globalThis.Blob = class { constructor(parts, o) { this.type = o?.type; this.size = 3; } };
  globalThis.MediaRecorder = class {
    static isTypeSupported(m) { return m === 'audio/webm;codecs=opus'; }
    constructor(s, o) { this.state = 'inactive'; this.mimeType = o?.mimeType; this.l = {}; }
    addEventListener(n, f) { this.l[n] = f; }
    start() { this.state = 'recording'; this.l.start(); this.l.dataavailable({ data: { size: 3 } }); }
    stop() { this.state = 'inactive'; this.l.stop(); }
  };
  const track = { stopped: false, stop() { this.stopped = true; } };
  const stream = { getTracks: () => [track] };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async (c) => { calls.push(['mic', c]); if (mic === 'denied') { const e = new Error('x'); e.name = 'NotAllowedError'; throw e; } return stream; } } } });
  globalThis.fetch = async (url, o) => {
    calls.push([o?.method || 'GET', url, o?.headers]);
    if (url.endsWith('/api/audio/status')) return { ok: true, json: async () => ({ ready, reason: ready ? '' : 'installation en cours' }) };
    if (post === 'throw') throw new Error('réseau');
    return { ok: post === 200, json: async () => ({}) };
  };
  delete require.cache[require.resolve('../extension/voice.js')];
  const Voice = require('../extension/voice.js');
  return { Voice, calls, track };
}
const posts = (calls) => calls.filter((c) => c[0] === 'POST');

test('désactivée par défaut : aucun micro, aucun envoi', async () => {
  const { Voice, calls } = setup({ checked: false });
  await Voice.refresh();
  assert.equal(await Voice.open(), null);
  assert.equal(calls.filter((c) => c[0] === 'mic').length, 0);
  assert.equal(await Voice.stop('s1'), false);
  assert.equal(posts(calls).length, 0);
});

test('activée + micro OK : audio envoyé avec session, startedAt et jeton', async () => {
  const { Voice, calls, track } = setup();
  await Voice.refresh();
  const st = await Voice.open();
  assert.ok(st);
  Voice.start(st);
  assert.equal(Voice.state.recording, true);
  assert.equal(await Voice.stop('abc-1'), true);
  const [, url, h] = posts(calls)[0];
  assert.match(url, /^http:\/\/x\/api\/audio\?session=abc-1&startedAt=\d+$/);
  assert.equal(h['Content-Type'], 'audio/webm;codecs=opus');
  assert.equal(h.Authorization, 'Bearer T');
  assert.equal(track.stopped, true);
  assert.equal(Voice.state.recording, false);
});

test('micro refusé : avertissement, pas de flux, rien d\'envoyé', async () => {
  const { Voice, calls } = setup({ mic: 'denied' });
  await Voice.refresh();
  assert.equal(await Voice.open(), null);
  assert.match(Voice.state.warning, /Micro non disponible \(NotAllowedError\).*sans la voix/);
  assert.equal(await Voice.stop('s'), false);
  assert.equal(posts(calls).length, 0);
});

test('voix locale pas prête : avertissement, le micro n\'est pas demandé', async () => {
  const { Voice, calls } = setup({ ready: false });
  assert.equal(await Voice.open(), null);
  assert.match(Voice.state.warning, /installation en cours/);
  assert.equal(calls.filter((c) => c[0] === 'mic').length, 0);
});

test('envoi en échec (erreur serveur ou réseau) : avertissement, jamais d\'exception', async () => {
  for (const post of [500, 'throw']) {
    const { Voice } = setup({ post });
    await Voice.refresh();
    Voice.start(await Voice.open());
    assert.equal(await Voice.stop('s'), false);
    assert.match(Voice.state.warning, /pas pu être envoyée/);
    assert.equal(Voice.state.recording, false);
  }
});

test('annulation : micro coupé, rien d\'envoyé', async () => {
  const { Voice, calls, track } = setup();
  await Voice.refresh();
  Voice.start(await Voice.open());
  await Voice.cancel();
  assert.equal(track.stopped, true);
  assert.equal(posts(calls).length, 0);
  assert.equal(Voice.state.recording, false);
});

test('compte rendu du serveur : transcription échouée ou vide = message clair', () => {
  const { Voice } = setup();
  Voice.report({ status: 'failed', reason: 'faster-whisper absent' });
  assert.match(Voice.state.warning, /faster-whisper absent.*sans elle/);
  Voice.report({ status: 'empty' });
  assert.match(Voice.state.warning, /Aucune parole/);
});
