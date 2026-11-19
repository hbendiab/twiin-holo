// Moteur de transcription de la voix : « local » (Whisper sur le poste, l'audio n'en sort pas) ou « cloud »
// (ElevenLabs Scribe, l'audio part chez un tiers). Ce choix revient à la DSI de l'entreprise : voir le README.
// Ce fichier ne contient que des fonctions simples (réglage, découpage des passages), testées dans voice_engine.test.js.
import fs from 'node:fs';
import path from 'node:path';

export const ENGINES = ['local', 'cloud'];
const ALIASES = { local: 'local', whisper: 'local', cloud: 'cloud', elevenlabs: 'cloud' };

// Normalise un nom de moteur (« ElevenLabs » → « cloud ») ; null si inconnu.
export function normalizeEngine(value) {
  return ALIASES[String(value ?? '').trim().toLowerCase()] || null;
}

// Moteur choisi : le réglage enregistré par la page (fichier gitignoré) gagne sur VOICE_ENGINE du .env ; défaut « local ».
export function readEngine(settingsFile, envValue) {
  try {
    const saved = normalizeEngine(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).engine);
    if (saved) return saved;
  } catch { /* pas de réglage enregistré */ }
  return normalizeEngine(envValue) || 'local';
}

export function writeEngine(settingsFile, engine) {
  const e = normalizeEngine(engine);
  if (!e) throw new Error('moteur inconnu (local ou cloud)');
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify({ engine: e }, null, 2));
  return e;
}

// Même découpage que transcribe.py (local) : un passage se coupe à une pause > 1,2 s ou au bout de 12 s,
// pour que le cloud et le local donnent des lignes « 🎤 » comparables. words = [{start, end, text}] en secondes.
export const PAUSE_S = 1.2;
export const MAX_CHUNK_S = 12;
export function chunkWords(words) {
  const chunks = [];
  let cur = [];
  for (const w of words) {
    if (cur.length && (w.start - cur[cur.length - 1].end > PAUSE_S || w.end - cur[0].start > MAX_CHUNK_S)) {
      chunks.push(cur);
      cur = [];
    }
    cur.push(w);
  }
  if (cur.length) chunks.push(cur);
  return chunks.map((c) => ({
    start: Math.round(c[0].start * 100) / 100,
    end: Math.round(c[c.length - 1].end * 100) / 100,
    text: c.map((w) => w.text).join(' ').replace(/\s+/g, ' ').trim(),
  }));
}

// Réponse ElevenLabs Scribe → même forme que voice.json du local : { segments: [{start, end, text}], audio_duration }.
// `words` = [{text, start, end, type: 'word' | 'spacing' | 'audio_event'}] ; on ne garde que les vrais mots.
// Sans mots horodatés, on garde le texte entier en un seul passage (heure de début = 0).
export function scribeToVoice(d) {
  const words = (Array.isArray(d?.words) ? d.words : [])
    .filter((w) => (w.type === undefined || w.type === 'word') && String(w.text ?? '').trim() && Number.isFinite(w.start) && Number.isFinite(w.end))
    .map((w) => ({ start: w.start, end: w.end, text: String(w.text).trim() }));
  const last = words.length ? words[words.length - 1].end : 0;
  const duration = Number.isFinite(d?.audio_duration_secs) ? d.audio_duration_secs : last;
  let segments = chunkWords(words);
  const text = String(d?.text ?? '').trim();
  if (!segments.length && text) segments = [{ start: 0, end: Math.round(duration * 100) / 100, text }];
  return { segments, audio_duration: Math.round(duration * 100) / 100 };
}
