// Envoie un enregistrement local (twiin/workflows/sessions/<id>) dans Supabase : ligne `taches` + captures Storage.
//   node --env-file=<chemin du .env> testbench/ingest_task.mjs <session-id> "<titre>" [--software Excel,Chrome] [--go]
// Sans --go : simulation (rien n'est envoyé). Utilise TON compte (clé publique) : la RLS s'applique.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(path.resolve('twiin/recorder/package.json'));
const { createClient } = require('@supabase/supabase-js');

const [, , sessionId, title, ...rest] = process.argv;
if (!sessionId || !title) { console.error('usage: ingest_task.mjs <session-id> "<titre>" [--software A,B] [--go]'); process.exit(1); }
const go = rest.includes('--go');
const sw = (rest[rest.indexOf('--software') + 1] || '').split(',').filter(Boolean);
const dir = path.resolve('twiin/workflows/sessions', sessionId);
const frames = fs.readFileSync(path.join(dir, 'frames.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const cand = JSON.parse(fs.readFileSync(path.resolve('twiin/workflows/candidates.json'), 'utf8')).workflows?.[0] || {};
const steps = (cand.steps || []).map((s, i) => ({ position: i + 1, instruction: s }));
console.log(`${frames.length} captures, ${steps.length} étapes, logiciels demandés : ${sw.join(', ') || '(aucun)'}${go ? '' : '  [SIMULATION]'}`);
if (!go) process.exit(0);

const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { data: a, error: ae } = await s.auth.signInWithPassword({ email: process.env.SUPABASE_EMAIL, password: process.env.SUPABASE_PASSWORD });
if (ae) throw ae;
const company = a.user.app_metadata.company_id;
const { data: dico } = await s.from('dictionnaire').select('id,name');
const ids = sw.map((n) => dico.find((d) => d.name.toLowerCase() === n.toLowerCase())?.id).filter(Boolean);
const missing = sw.filter((n) => !dico.some((d) => d.name.toLowerCase() === n.toLowerCase()));
const started = frames[0]?.timestamp, ended = frames.at(-1)?.timestamp;
const { data: t, error: te } = await s.from('taches').insert({
  company_id: company, title, summary: cand.summary ?? null, context: cand.general_intent ?? null, status: 'analysed',
  software_ids: ids, steps, source_session_id: sessionId, started_at: started, ended_at: ended,
  duration_s: started && ended ? Math.round((new Date(ended) - new Date(started)) / 1000) : null,
  expires_at: new Date(Date.now() + 30 * 864e5).toISOString(), stats: { frames: frames.length, ocr: false, action_log: false },
}).select().single();
if (te) throw te;
const shots = [];
for (const f of frames) {
  const b = Buffer.from(f.dataUrl.split(',')[1], 'base64');
  const p = `${company}/${t.id}/frame-${String(f.index).padStart(4, '0')}.jpg`;
  const { error } = await s.storage.from('task-captures').upload(p, b, { contentType: 'image/jpeg' });
  if (error) { console.error('échec image', f.index, error.message); continue; }
  shots.push({ storage_path: p, screen_index: (f.screen ?? 1) - 1, at_ms: (f.seconds ?? 0) * 1000, ocr_text: '' });
}
await s.from('taches').update({ screenshots: shots }).eq('id', t.id);
console.log(`tâche ${t.id} : ${shots.length}/${frames.length} captures envoyées. Logiciels absents du dictionnaire : ${missing.join(', ') || 'aucun'}`);
