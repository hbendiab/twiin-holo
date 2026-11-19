// Prépare le code de Twiin embarqué dans l'installeur (desktop/build/twiin), à partir du dossier twiin/ du dépôt.
// Jamais : .env (clés), enregistrements (workflows/), automatisations générées (jeton du pont n8n → Holo),
// environnement Python, n8n et dépendances des vidéos (installés au premier lancement), caches.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DESKTOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = path.dirname(DESKTOP); // twiin/
const OUT = path.join(DESKTOP, 'build', 'twiin');

const INCLUDE = ['recorder', 'audit', 'automation', 'discovery', 'extension', 'scripts', 'tuto', 'twiin', 'pyproject.toml', 'README.md', '.env.example'];
const EXCLUDE = [
  /(^|\/)\.env$/, /(^|\/)\.env\.(?!example)/, /(^|\/)\.DS_Store$/, /(^|\/)__pycache__(\/|$)/, /\.pyc$/, /\.egg-info(\/|$)/,
  /^automation\/workflows(\/|$)/,       // automatisations générées : contiennent le jeton du pont n8n → Holo
  /^automation\/n8n-runtime(\/|$)/,     // n8n : installé au premier lancement
  /^automation\/n8n-cli\/n8n\/(workflows|config\/cache)(\/|$)/, /^automation\/n8n-cli\/n8n\/config\/sync-state\.json$/, // copies locales de n8n (ids de tes documents)
  /^recorder\/ui\/node_modules(\/|$)/,  // sources du composant React (déjà compilé dans recorder/public/ui)
  /^tuto\/essais-voix(\/|$)/,
  /^tuto\/video\/(node_modules|out)(\/|$)/, /^tuto\/video\/public\/(tutos|pitch)(\/|$)/, // vidéos : dépendances au premier lancement, jamais les vidéos de l'équipe
];
const skip = (rel) => EXCLUDE.some((re) => re.test(rel));

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
let files = 0, bytes = 0;
for (const top of INCLUDE) {
  const from = path.join(SRC, top);
  if (!fs.existsSync(from)) continue;
  fs.cpSync(from, path.join(OUT, top), { recursive: true, filter: (s) => {
    const rel = path.relative(SRC, s).split(path.sep).join('/');
    if (skip(rel)) return false;
    const st = fs.lstatSync(s);
    if (st.isFile()) { files++; bytes += st.size; }
    return true;
  } });
}
// Accès du pilote (relais Twiin + jeton du poste) : seulement les réglages autorisés, jamais une clé de service
const PILOTE = path.join(DESKTOP, 'config-pilote.env');
const PILOTE_OK = /^(TWIIN_RELAIS|TWIIN_CLE|HF_MODEL|HOLO_AGENT|HOLO_MODEL|RECORDER_MODE|ELEVENLABS_VOICE_ID|TWIIN_COMPTES|SUPABASE_URL|SUPABASE_PUBLISHABLE_KEY)=/;
if (fs.existsSync(PILOTE)) {
  const lignes = fs.readFileSync(PILOTE, 'utf8').split('\n').filter((l) => /^[A-Z0-9_]+=/.test(l));
  const interdites = lignes.filter((l) => !PILOTE_OK.test(l)).map((l) => l.split('=')[0]);
  if (interdites.length) { console.error(`config-pilote.env : réglages refusés (${interdites.join(', ')})`); process.exit(1); }
  fs.writeFileSync(path.join(OUT, 'config-pilote.env'), lignes.join('\n') + '\n', { mode: 0o600 });
  console.log(`Accès pilote intégrés (relais) : ${lignes.length} réglages`);
} else console.warn('Pas de config-pilote.env : le client devra importer un fichier de configuration.');
// Contrôle : aucun secret ne doit être embarqué
const leaks = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
  const p = path.join(d, e.name);
  if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); continue; }
  if (e.name === '.env' || /^\.env\.(?!example)/.test(e.name)) leaks.push(p);
  else if (e.size < 2e6 && /\.(js|mjs|py|json|md|html|txt|toml|yaml|yml|example)$/.test(e.name)) {
    const t = fs.readFileSync(p, 'utf8');
    if (/sb_secret_[\w-]{10,}|\bhf_[A-Za-z0-9]{30,}|\bsk-[A-Za-z0-9]{30,}|eyJhbGciOiJ[\w.-]{40,}/.test(t)) leaks.push(p);
  } } };
walk(OUT);
if (leaks.length) { console.error('SECRET possible, installeur refusé :\n' + leaks.map((l) => '  ' + path.relative(OUT, l)).join('\n')); process.exit(1); }
console.log(`Code embarqué : ${files} fichiers, ${(bytes / 1e6).toFixed(0)} Mo → ${path.relative(DESKTOP, OUT)} (aucun secret détecté)`);
