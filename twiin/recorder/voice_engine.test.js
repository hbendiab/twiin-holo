// Tests du choix de moteur et du découpage des passages. Lancer depuis recorder/ :  node --test voice_engine.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeEngine, readEngine, writeEngine, chunkWords, scribeToVoice } from './voice_engine.js';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'twiin-eng-')), 'sub', 'voice_settings.json');

test('normalizeEngine : alias et valeurs inconnues', () => {
  assert.equal(normalizeEngine('ElevenLabs'), 'cloud');
  assert.equal(normalizeEngine(' LOCAL '), 'local');
  assert.equal(normalizeEngine('whisper'), 'local');
  assert.equal(normalizeEngine('azure'), null);
  assert.equal(normalizeEngine(undefined), null);
});

test('readEngine : défaut local, .env, réglage enregistré prioritaire, fichier cassé ignoré', () => {
  const f = tmp();
  assert.equal(readEngine(f, undefined), 'local');
  assert.equal(readEngine(f, 'cloud'), 'cloud');
  assert.equal(readEngine(f, 'n_importe_quoi'), 'local');
  writeEngine(f, 'local');
  assert.equal(readEngine(f, 'cloud'), 'local');
  fs.writeFileSync(f, '{pas du json');
  assert.equal(readEngine(f, 'cloud'), 'cloud');
});

test('writeEngine refuse un moteur inconnu', () => {
  assert.throws(() => writeEngine(tmp(), 'azure'));
});

test('chunkWords : coupe à une pause > 1,2 s et à 12 s', () => {
  const w = (s, e, t) => ({ start: s, end: e, text: t });
  const out = chunkWords([w(1, 1.4, 'Je'), w(1.5, 2, 'copie'), w(4, 4.5, 'puis'), w(4.6, 5, 'je'), w(5.1, 17, 'colle')]);
  assert.deepEqual(out.map((c) => c.text), ['Je copie', 'puis je', 'colle']);
  assert.equal(out[0].start, 1);
  assert.equal(out[1].end, 5);
  assert.deepEqual(chunkWords([]), []);
});

test('scribeToVoice : ignore espaces et bruits, découpe aux pauses', () => {
  const d = { text: 'Je copie Notion', audio_duration_secs: 9, words: [
    { text: 'Je', start: 1, end: 1.3, type: 'word' }, { text: ' ', start: 1.3, end: 1.4, type: 'spacing' },
    { text: 'copie', start: 1.4, end: 1.9, type: 'word' }, { text: '(rire)', start: 2, end: 3, type: 'audio_event' },
    { text: 'Notion.', start: 6, end: 6.6, type: 'word' }] };
  const v = scribeToVoice(d);
  assert.deepEqual(v.segments, [{ start: 1, end: 1.9, text: 'Je copie' }, { start: 6, end: 6.6, text: 'Notion.' }]);
  assert.equal(v.audio_duration, 9);
});

test('scribeToVoice : sans mots horodatés = un seul passage ; rien = vide', () => {
  assert.deepEqual(scribeToVoice({ text: 'Bonjour' }).segments, [{ start: 0, end: 0, text: 'Bonjour' }]);
  assert.deepEqual(scribeToVoice({ text: '', words: [] }).segments, []);
  assert.deepEqual(scribeToVoice(null).segments, []);
});
