// Test de bout en bout de la connexion Twiin → Supabase.
//
// Lancer (depuis twiin/recorder) :
//   npm install @supabase/supabase-js     # une seule fois
//   node test-supabase.mjs
//
// Variables lues dans twiin/.env : SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_EMAIL, SUPABASE_PASSWORD
// Le script se connecte avec TON compte (clé publique, jamais la clé service_role), crée une tâche de test,
// y envoie une image, ajoute un essai et une recommandation, vérifie que les accès interdits sont bien refusés,
// puis SUPPRIME tout ce qu'il a créé.

import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), '.env') });

const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_EMAIL, SUPABASE_PASSWORD } = process.env;
const BUCKET = 'task-captures';
// PNG 1×1 pixel, pour tester l'envoi d'une image
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

let failed = 0;
const ok = (msg) => console.log(`  ✅ ${msg}`);
const ko = (msg, detail) => { failed++; console.log(`  ❌ ${msg}${detail ? ` — ${detail}` : ''}`); };
const check = (cond, msg, detail) => (cond ? ok(msg) : ko(msg, detail));

async function main() {
  console.log('\n1. Configuration');
  const missing = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_EMAIL', 'SUPABASE_PASSWORD'].filter((k) => !process.env[k]);
  if (missing.length) { ko('variables manquantes dans twiin/.env', missing.join(', ')); return; }
  ok('variables présentes');
  if (/service_role/i.test(SUPABASE_PUBLISHABLE_KEY) || SUPABASE_PUBLISHABLE_KEY.split('.').length === 3 && safeRole(SUPABASE_PUBLISHABLE_KEY) === 'service_role') {
    ko('SUPABASE_PUBLISHABLE_KEY est une clé service_role : utilise la clé publique (publishable / anon)');
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  console.log('\n2. Connexion');
  const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({ email: SUPABASE_EMAIL, password: SUPABASE_PASSWORD });
  if (authErr) { ko('connexion refusée', authErr.message); return; }
  const user = auth.user;
  ok(`connecté : ${user.email}`);
  const companyId = user.app_metadata?.company_id;
  const role = user.app_metadata?.role;
  check(!!companyId, 'company_id présent dans app_metadata', 'à renseigner par l\'admin (voir supabase/README.md, section 2)');
  check(['admin', 'member'].includes(role), `role valide : ${role ?? 'absent'}`, 'doit valoir admin ou member');
  if (!companyId) return;

  console.log('\n3. Dictionnaire');
  const { data: soft, error: softErr } = await supabase.from('dictionnaire').select('id,name,has_api,connector');
  if (softErr) ko('lecture du dictionnaire', softErr.message);
  else check(soft.length >= 7, `${soft.length} logiciels visibles (au moins les 7 publics)`);

  let taskId = null;
  let path1 = null;
  try {
    console.log('\n4. Tâche');
    const { data: task, error: taskErr } = await supabase.from('taches')
      .insert({ company_id: companyId, title: '[TEST Twiin] connexion Supabase', source_session_id: `test-${Date.now()}`,
                software_ids: soft?.slice(0, 2).map((s) => s.id) ?? [], steps: [{ position: 1, instruction: 'Étape de test' }] })
      .select().single();
    if (taskErr) { ko('création de la tâche', taskErr.message); return; }
    taskId = task.id;
    ok(`tâche créée : ${taskId}`);
    check(task.recorded_by === user.id, 'recorded_by rempli automatiquement avec ton compte');

    console.log('\n5. Image (Storage)');
    path1 = `${companyId}/${taskId}/test.png`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path1, PNG, { contentType: 'image/png' });
    if (upErr) ko('envoi de l\'image', upErr.message);
    else {
      ok(`image envoyée : ${path1}`);
      const { error: updErr } = await supabase.from('taches').update({ screenshots: [{ storage_path: path1, screen_index: 0, at_ms: 0 }] }).eq('id', taskId);
      check(!updErr, 'chemin de l\'image enregistré dans la tâche', updErr?.message);
      const { data: signed, error: signErr } = await supabase.storage.from(BUCKET).createSignedUrl(path1, 60);
      if (signErr) ko('lien temporaire', signErr.message);
      else {
        const r = await fetch(signed.signedUrl);
        check(r.ok, `lien temporaire lisible (HTTP ${r.status})`);
      }
    }

    console.log('\n6. Essai et recommandation');
    const { data: test, error: testErr } = await supabase.from('tests')
      .insert({ task_id: taskId, kind: 'holo_replay', status: 'succeeded', success_rate: 1, summary: 'Essai de test' }).select().single();
    check(!testErr, 'essai créé', testErr?.message);
    const { error: recErr } = await supabase.from('recommendations')
      .insert({ task_id: taskId, test_id: test?.id ?? null, kind: 'accelerate', confidence: 'high', summary: 'Reco de test',
                plan: [{ position: 1, item_type: 'advice', method: 'manual', description: 'Conseil de test' }] });
    check(!recErr, 'recommandation créée', recErr?.message);

    console.log('\n7. Accès interdits (doivent être REFUSÉS)');
    const other = randomUUID();
    const r1 = await supabase.from('taches').insert({ company_id: other, title: '[TEST] intrusion' });
    check(!!r1.error, 'créer une tâche dans une autre entreprise : refusé', 'ACCEPTÉ, la RLS ne protège pas !');
    const r2 = await supabase.storage.from(BUCKET).upload(`${other}/${taskId}/intrus.png`, PNG, { contentType: 'image/png' });
    check(!!r2.error, 'envoyer une image dans le dossier d\'une autre entreprise : refusé', 'ACCEPTÉ, la RLS ne protège pas !');
    if (!r2.error) await supabase.storage.from(BUCKET).remove([`${other}/${taskId}/intrus.png`]);
    const r3 = await supabase.from('dictionnaire').insert({ company_id: null, name: '[TEST] faux public' });
    check(!!r3.error, 'ajouter un logiciel « public » : refusé', 'ACCEPTÉ, la RLS ne protège pas !');
    if (!r3.error) await supabase.from('dictionnaire').delete().eq('name', '[TEST] faux public');
  } finally {
    console.log('\n8. Nettoyage');
    if (path1) await supabase.storage.from(BUCKET).remove([path1]);
    if (taskId) {
      const { error } = await supabase.from('taches').delete().eq('id', taskId); // supprime aussi essais et recommandations
      check(!error, 'tâche de test supprimée (avec son essai et sa recommandation)', error?.message);
    }
    await supabase.auth.signOut();
  }
}

function safeRole(jwt) {
  try { return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).role; } catch { return null; }
}

main()
  .catch((e) => { ko('erreur inattendue', e.message); })
  .finally(() => {
    console.log(failed ? `\n❌ ${failed} problème(s) : voir ci-dessus.\n` : '\n✅ Tout fonctionne : Twiin peut écrire dans Supabase.\n');
    process.exit(failed ? 1 : 0);
  });
