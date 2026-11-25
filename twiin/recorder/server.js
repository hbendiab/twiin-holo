import dotenv from 'dotenv';
import os from 'node:os';
import express from 'express';
import OpenAI from 'openai';
import { jsonrepair } from 'jsonrepair';                // réparation locale des JSON mal formés               // <-- remplace @anthropic-ai/sdk (Hugging Face est compatible OpenAI)
import fs from 'fs';
import path from 'path';
import { spawn as spawnRaw } from 'child_process';
// Windows : aucun programme lancé par Twiin n'ouvre de fenêtre (console Python, PowerShell…)
const spawn = (cmd, args, opts = {}) => spawnRaw(cmd, args, { windowsHide: true, ...opts });
// Arrête un programme et tous ceux qu'il a lancés (Holo, navigateur…). Sous Windows, kill() ne suffit pas.
function killTree(proc) {
  if (!proc || proc.exitCode !== null) return;
  if (process.platform === 'win32') spawnRaw('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true });
  else { try { process.kill(-proc.pid, 'SIGTERM'); } catch { proc.kill('SIGTERM'); } }
}
// Holo plus rapide pour les rejeux et les blocs Holo de n8n : holo4 (pas de limite de 10 requêtes/minute du modèle gratuit).
process.env.HOLO_MODEL ||= 'holo4-35b-a3b';
const spawnMac = (args) => { try { const c = spawnMac(args); c.on('error', () => {}); return c; } catch { return null; } }; // Windows : osascript absent
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
import { mergeVoice } from './voice.js';
import { mountTelecommande } from './telecommande.js';
import { appReport, effectiveExcluded, excludedTime, filterEvents, isCopy, isPaste, timePerApp } from './apps_filter.js';

// recorder/ sits one level below the repo root, alongside the twiin/ Python package
const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CANDIDATES_PATH = path.join(REPO_ROOT, 'workflows', 'candidates.json');

// project-wide .env lives at the repo root, same file Holo's pieces read
dotenv.config({ path: path.join(REPO_ROOT, '.env') });
// Relais Twiin (postes clients) : TWIIN_RELAIS + TWIIN_CLE remplacent les clés des services, qui restent sur le relais.
// Les scripts Python lancés par le serveur héritent de ces variables.
const RELAIS = (process.env.TWIIN_RELAIS || '').replace(/\/+$/, '');
if (RELAIS) {
  for (const k of ['HF_TOKEN', 'ELEVENLABS_API_KEY', 'HAI_API_KEY']) if (!process.env[k]) process.env[k] = process.env.TWIIN_CLE || '';
  process.env.HF_BASE_URL ||= `${RELAIS}/hf/v1`;
  process.env.ELEVENLABS_BASE_URL ||= `${RELAIS}/eleven`;
  process.env.HAI_BASE_URL ||= `${RELAIS}/hai/agp.eu.hcompany.ai`;
  process.env.HAI_API_BASE_URL ||= `${RELAIS}/hai/api.hcompany.ai/v1/`;
}
const HF_BASE = process.env.HF_BASE_URL || 'https://router.huggingface.co/v1';
const ELEVEN_BASE = (process.env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io').replace(/\/+$/, '');
// n8n local : sans clé dans le .env, on reprend celles de n8ncli (n8ncli envs edit LOCAL …), comme les scripts Python.
try {
  const l = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.n8ncli-global.json'), 'utf8')).environments?.LOCAL || {};
  process.env.N8N_LOCAL_URL ||= l.instanceUrl || '';
  process.env.N8N_LOCAL_API_KEY ||= l.apiKey || '';
  process.env.N8N_LOCAL_MCP_TOKEN ||= l.accessToken || '';
} catch { /* pas de n8ncli : clés du .env seulement */ }
if (!process.env.N8N_LOCAL_URL) delete process.env.N8N_LOCAL_URL;
// Jeton du pont n8n → Holo : généré une fois et gardé sur le poste (dossier ignoré par git) s'il n'est pas dans le .env
if (!process.env.TWIIN_LOCAL_TOKEN) {
  const f = path.join(REPO_ROOT, 'workflows', 'runs', '.twiin_local_token');
  try { process.env.TWIIN_LOCAL_TOKEN = fs.readFileSync(f, 'utf8').trim(); } catch {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    process.env.TWIIN_LOCAL_TOKEN = crypto.randomBytes(24).toString('base64url');
    fs.writeFileSync(f, process.env.TWIIN_LOCAL_TOKEN);
  }
}

const app = express();
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ extended: false, limit: '4kb' }));
// --- Mode démo : visiteurs venus par le lien public (tunnel Cloudflare) ------------------------------------------------
// Le tunnel arrive « depuis le Mac » : on le reconnaît à ses en-têtes Cloudflare et on ne lui donne JAMAIS les droits du poste.
// Code d'accès (TWIIN_DEMO_CODE), lecture seule, rien qui touche le Mac (capture, Holo sur l'écran, télécommande),
// pas d'images d'enregistrements (pages possiblement confidentielles), pas de journaux. Seules les automatisations qui
// tournent entièrement dans le cloud de H peuvent être lancées.
const estVisiteur = (req) => !!(req.get('cf-ray') || req.get('cf-connecting-ip'));
const DEMO_COOKIE = 'twiin_demo';
const demoJeton = () => crypto.createHmac('sha256', String(process.env.TWIIN_DEMO_CODE || 'x') + (process.env.TWIIN_LOCAL_TOKEN || '')).update('demo').digest('base64url').slice(0, 32);
// Jury : il peut tout essayer dans l'interface (marque, équipe, cibles, audit, partage de vidéos, lancer une automatisation du cloud),
// mais rien qui pilote le Mac, supprime des données ou touche aux comptes connectés.
const DEMO_POST_OK = [/^\/api\/titres-courts$/, /^\/api\/automations\/[\w-]+\/cibles(\/proposer)?$/, /^\/api\/automations\/[\w-]+\/run$/,
  /^\/api\/automations\/[\w-]+\/stop$/, /^\/api\/marque$/, /^\/api\/equipe\/(membres|nom|partages)$/, /^\/api\/tutos\/[\w-]+\/couverture$/,
  /^\/api\/onboarding\/(profile|reponses|lourdes)$/, /^\/api\/audit\/(dirigeant|outils)$/, /^\/api\/discovery\/answer$/, /^\/api\/voice\/transcribe$/];
const DEMO_GET_NON = [/^\/api\/telecommande/, /^\/api\/back/, /^\/api\/google\//, /^\/api\/sessions\/[^/]+\/(frames|images|frame|shot|screens|media)/i,
  /^\/sessions\//, /^\/api\/actions\/(start|stop|pause)/, /^\/api\/setup/, /^\/back\.html/, /^\/telecommande\.html/, /^\/api\/connexions/];
app.use(async (req, res, next) => {
  if (!estVisiteur(req)) return next();
  res.set('x-twiin-mode', 'demo');
  if (!process.env.TWIIN_DEMO_CODE) return res.status(503).send('Mode démo non configuré.');
  if (req.path === '/demo' && req.method === 'POST') {
    const code = String(req.body?.code || '').trim();
    if (code.toLowerCase() !== String(process.env.TWIIN_DEMO_CODE).toLowerCase()) return res.redirect('/demo?faux=1');
    res.setHeader('Set-Cookie', `${DEMO_COOKIE}=${demoJeton()}; Path=/; Max-Age=172800; HttpOnly; Secure; SameSite=Lax`);
    return res.redirect('/');
  }
  const ok = (req.get('cookie') || '').split(/;\s*/).some((c) => c === `${DEMO_COOKIE}=${demoJeton()}`);
  if (!ok) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Code d\'accès requis.' });
    if (req.path !== '/demo' && !/\.(css|js|png|jpg|svg|woff2?|webp|ico)$/.test(req.path)) return res.redirect('/demo');
    if (req.path === '/demo') return res.send(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Twiin · démo</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px -apple-system,Inter,sans-serif;color:#161615;
background:radial-gradient(60% 60% at 80% 10%,#c9d2e7aa,transparent 70%),#f7f8fc}form{width:min(380px,calc(100vw - 32px));padding:30px;border-radius:18px;background:#fff;
border:1px solid #dce2f0;box-shadow:0 30px 60px -36px rgba(56,66,110,.5);display:grid;gap:14px}.duo{display:flex;gap:4px}.duo img{width:40px;height:40px}
h1{margin:0;font-size:26px;letter-spacing:-.03em}p{margin:0;color:#5d5d58}input{font:inherit;padding:12px;border-radius:10px;border:1px solid #dce2f0}
button{font:600 15px inherit;font-family:inherit;padding:12px;border:0;border-radius:10px;background:#56669c;color:#fff;cursor:pointer}.err{color:#c0392b}</style></head>
<body><form method="post" action="/demo"><span class="duo"><img src="/img/iris.png" alt=""><img src="/img/ilo.png" alt=""></span><h1>Bienvenue sur Twiin</h1>
<p>Démo pour le jury du hackathon Build The Future. Entre le code d'accès.</p>${req.query.faux ? '<p class="err">Code incorrect.</p>' : ''}
<input name="code" autocomplete="off" autofocus aria-label="Code d'accès" placeholder="Code d'accès" required><button type="submit">Entrer</button></form></body></html>`);
    return next();
  }
  if (DEMO_GET_NON.some((r) => r.test(req.path))) return res.status(403).json({ error: 'Mode démo : réservé au poste de l\'équipe.' });
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (!DEMO_POST_OK.some((r) => r.test(req.path))) return res.status(403).json({ error: 'Mode démo : lecture seule. Cette action se fait sur le poste de l\'équipe.' });
    const m = req.path.match(/^\/api\/automations\/([\w-]+)\/run$/);
    if (m) { // seulement si elle ne prend pas le Mac
      try {
        const a = await automationSummary(await n8nApi(`/workflows/${encodeURIComponent(m[1])}`));
        if (a.blocks.some((b) => b.kind === 'holo' && b.env !== 'cloud')) return res.status(403).json({ error: 'Mode démo : cette automatisation utilise le Mac de l\'équipe. Choisis-en une qui tourne dans le cloud.' });
      } catch { return res.status(403).json({ error: 'Mode démo : automatisation introuvable.' }); }
    }
  }
  next();
});
app.use(express.static('public'));
// Panneau de l'extension Chrome, aussi utilisé tel quel par l'app Mac (desktop/, Electron) : /ext/desktop.html
app.use('/ext', express.static(path.join(REPO_ROOT, 'extension')));
// supabase-js pour la page (servi depuis le projet, sans CDN)
app.use('/vendor/supabase', express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd')));

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// SUPABASE : comptes (Supabase Auth) et sauvegarde du parcours (fiches, scans, tâches, recos, tutos, automatisations,
// journal technique). Texte et chiffres seulement : captures d'écran, audio et vidéos restent sur le Mac.
// Le serveur agit AVEC LE JETON DE L'EMPLOYÉ connecté : la sécurité RLS de Supabase s'applique (chacun ses lignes).
// Sans SUPABASE_URL / SUPABASE_ANON_KEY dans .env, Twiin marche comme avant, en local, sans comptes.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SB_ANON = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || ''; // même clé publique, deux noms (équipe / Twiin)
// Comptes activés seulement sur demande (TWIIN_COMPTES=1), une fois les tables créées : sinon Twiin reste en local.
// TWIIN_COMPTES=service : pas d'écran de connexion, Twiin se connecte lui-même avec le compte de service
// (SUPABASE_EMAIL / SUPABASE_PASSWORD) et enregistre tout dans Supabase sous ce compte.
const SB_SERVICE = !!(SB_URL && SB_ANON) && /^service$/i.test(process.env.TWIIN_COMPTES || '');
const SB_ON = (!!(SB_URL && SB_ANON) && /^(1|true|oui)$/i.test(process.env.TWIIN_COMPTES || '')) || SB_SERVICE;
let compteService = null; // { id, email, token, refresh, until }
async function connexionService() {
  if (compteService && compteService.until > Date.now() + 60e3) return compteService;
  const body = compteService?.refresh ? { refresh_token: compteService.refresh }
    : { email: process.env.SUPABASE_EMAIL, password: process.env.SUPABASE_PASSWORD };
  const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=${compteService?.refresh ? 'refresh_token' : 'password'}`, {
    method: 'POST', headers: { apikey: SB_ANON, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) {
    if (compteService?.refresh) { compteService = null; return connexionService(); } // jeton de rafraîchissement périmé : nouvelle connexion
    throw new Error(`Supabase (compte de service) : ${d.error_description || d.msg || r.status}`);
  }
  compteService = { id: d.user.id, email: d.user.email, token: d.access_token, refresh: d.refresh_token,
    company_id: d.user.app_metadata?.company_id || null, until: Date.now() + (d.expires_in || 3600) * 1000 };
  return compteService;
}
const als = new AsyncLocalStorage(); // l'employé de la requête en cours, disponible partout (même dans les tâches longues)
const tokenCache = new Map();
async function sbUserFromToken(token) {
  const hit = tokenCache.get(token);
  if (hit && hit.until > Date.now()) return hit.user;
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) return null;
  const u = await r.json();
  const user = { id: u.id, email: u.email, token, company_id: u.app_metadata?.company_id || null };
  tokenCache.set(token, { user, until: Date.now() + 5 * 60 * 1000 });
  return user;
}
// Appel à l'API REST de Supabase au nom de l'employé connecté. Ne casse jamais le parcours : en cas d'erreur, null.
async function sb(pathname, { method = 'GET', body, prefer } = {}) {
  let user = als.getStore();
  if (SB_SERVICE) user = await connexionService().catch((e) => { console.warn(`[supabase] ${e.message}`); return null; });
  if (!SB_ON || !user) return null;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${pathname}`, {
      method, signal: AbortSignal.timeout(15000),
      headers: { apikey: SB_ANON, Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const txt = await r.text();
    if (!r.ok) { console.warn(`[supabase] ${method} ${pathname.split('?')[0]} : ${r.status} ${txt.slice(0, 200)}`); return null; }
    return txt ? JSON.parse(txt) : null;
  } catch (e) {
    console.warn(`[supabase] ${method} ${pathname.split('?')[0]} : ${e.message}`);
    return null;
  }
}
const sbUser = () => als.getStore() || null;
// Garde le contexte de l'employé dans un rappel lancé plus tard (fin d'un programme, minuterie…)
const keepUser = (fn) => { const u = als.getStore(); return (...a) => (u ? als.run(u, () => fn(...a)) : fn(...a)); };

app.get('/api/config', (req, res) => res.json({ supabase: SB_ON && !SB_SERVICE ? { url: SB_URL, anonKey: SB_ANON } : null, stockage: SB_SERVICE ? 'supabase' : SB_ON ? 'comptes' : 'local' }));
// Toutes les routes /api demandent un employé connecté, sauf : la config, la voix (balise <audio>), le pont n8n → Holo
// (il a son propre jeton) et les fichiers servis.
const OPEN_API = ['/config', '/voice/say', '/holo/run', '/holo/web', '/excel/write', '/extension/']; // ponts n8n : jeton Twiin propre
app.use('/api', async (req, res, next) => {
  if (SB_SERVICE) { // compte de service : pas de connexion à demander
    const u = await connexionService().catch(() => null);
    return u ? als.run(u, next) : next();
  }
  if (!SB_ON || OPEN_API.some((p) => req.path.startsWith(p))) return next();
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const user = token ? await sbUserFromToken(token).catch(() => null) : null;
  if (!user) return res.status(401).json({ error: 'Connecte-toi pour continuer.', login: true });
  als.run(user, next);
});

// --- Hugging Face (routeur compatible OpenAI) ---------------------------------
// Mets HF_TOKEN dans .env (ton token Hugging Face). HF_MODEL est optionnel.
const client = new OpenAI({
  baseURL: HF_BASE,
  apiKey: process.env.HF_TOKEN,
});
const HF_MODEL = process.env.HF_MODEL || 'Qwen/Qwen3.8-27B'; // généraliste vision ; changeable
const MAX_FRAMES = parseInt(process.env.HF_MAX_FRAMES || '24', 10);      // images envoyées au modèle (coût)
const OCR_MAX_CHARS = parseInt(process.env.OCR_MAX_CHARS || '40000', 10); // texte OCR envoyé au modèle, au plus
const OCR_MIN_CONF = 0.5;                                                  // lignes OCR moins sûres : ignorées
// Python : premier venv trouvé (twiin/.venv ou .venv à la racine du dépôt), sous macOS/Linux (bin/) ou Windows (Scripts/).
const IS_WIN = process.platform === 'win32';
const PYTHON = [path.join(REPO_ROOT, '.venv'), path.join(REPO_ROOT, '..', '.venv')]
  .map((v) => path.join(v, IS_WIN ? 'Scripts' : 'bin', IS_WIN ? 'python.exe' : 'python'))
  .find((p) => fs.existsSync(p)) || (IS_WIN ? 'python' : 'python3');
process.env.PYTHONUTF8 = '1';          // Windows : les scripts Python lisent et écrivent en UTF-8 (accents, « »)
process.env.PYTHONIOENCODING = 'utf-8';
// Scripts propres au système : macOS (Vision, Quartz) ou Windows (Windows.Media.Ocr, UI Automation)
const OCR_SCRIPT = IS_WIN ? 'ocr_win.py' : 'ocr.py';
const ACTIONS_SCRIPT = IS_WIN ? 'actions_win.py' : 'actions.py';
const LAST_RUN_PATH = path.join(REPO_ROOT, 'workflows', 'last_run.json'); // OCR + usage du dernier enregistrement (local)

// Prix du modèle par fournisseur ($ / million de tokens), lus une fois au démarrage pour estimer le coût.
let PRICING = {};
fetch(`${HF_BASE}/models`, { headers: { Authorization: `Bearer ${process.env.HF_TOKEN}` } })
  .then((r) => r.json())
  .then((j) => {
    const m = (j.data || []).find((x) => x.id === HF_MODEL);
    for (const p of m?.providers || []) if (p.pricing) PRICING[p.provider] = p.pricing;
  })
  .catch(() => {});

// OCR local (framework Vision de macOS) sur toutes les images gardées : rien ne sort du Mac.
function runOcr(frames) {
  return new Promise((resolve) => {
    const py = spawn(PYTHON, [path.join(path.dirname(fileURLToPath(import.meta.url)), OCR_SCRIPT)]);
    let out = '', err = '';
    py.stdout.on('data', (d) => (out += d));
    py.stderr.on('data', (d) => (err += d));
    py.on('error', (e) => { console.error('OCR indisponible :', e.message); resolve([]); }); // l'analyse continue sans le texte lu à l'écran
    py.stdin.on('error', () => {});     // EPIPE si l'OCR s'arrête avant d'avoir tout lu : ne doit jamais faire tomber le serveur
    py.on('close', (code) => {
      if (code !== 0) { console.error('OCR échoué :', err.slice(0, 500)); return resolve([]); }
      try { resolve(JSON.parse(out)); } catch { resolve([]); }
    });
    py.stdin.end(JSON.stringify(frames.map((f) => ({ index: f.index, dataUrl: f.ocrUrl || f.dataUrl }))));
  });
}

// Texte OCR de chaque image, en ne gardant que les lignes NOUVELLES par rapport à l'image précédente
// (l'interface qui ne bouge pas n'est pas répétée) : c'est ce qui permet d'envoyer le texte de toutes les images.
function ocrTranscript(frames, ocr) {
  const byIndex = new Map(ocr.map((o) => [o.index, o.lines || []]));
  const prevByScreen = new Map(); // dédoublonnage ÉCRAN PAR ÉCRAN (chaque écran a sa propre « image précédente »)
  let total = 0;
  const blocks = [];
  for (const f of frames) {
    const scr = f.screen ?? 1;
    const prev = prevByScreen.get(scr) || new Set();
    const lines = (byIndex.get(f.index) || []).filter((l) => l.conf >= OCR_MIN_CONF).map((l) => l.text.trim()).filter(Boolean);
    const fresh = lines.filter((t) => !prev.has(t));
    prevByScreen.set(scr, new Set(lines));
    if (!fresh.length) continue;
    const block = `[Image ${f.index} · screen ${scr} · t+${f.seconds ?? '?'}s] ` + fresh.join(' | ');
    if (total + block.length > OCR_MAX_CHARS) { blocks.push('[… texte OCR tronqué]'); break; }
    blocks.push(block);
    total += block.length;
  }
  return blocks.join('\n');
}

function sampleFrames(frames) {
  if (frames.length <= MAX_FRAMES) return frames;
  const stride = frames.length / MAX_FRAMES;
  return Array.from({ length: MAX_FRAMES }, (_, i) => frames[Math.floor(i * stride)]);
}

// Format image OpenAI : on passe directement la data-URL base64.
function toImageBlock(dataUrl) {
  return { type: 'image_url', image_url: { url: dataUrl } };
}

const SYSTEM_PROMPT = `You are watching a timelapse of someone's screen, in order. A frame is kept each time the
screen changed and settled, so consecutive frames show successive states of the user's work.
The user may have SEVERAL MONITORS recorded at the same time: every frame is labelled with its screen number
and its time (t+Ns since the start). Frames from different screens are interleaved by time; a task often moves
from one screen to another (e.g. read something in a browser on screen 1, type it into a spreadsheet on screen 2).
Treat all screens as ONE session and follow the user's actions across screens using the times. Mention the
application used for each step (browser site, spreadsheet, note-taking app...), and when values are copied from
one app to another, say which values go where.
Segment the session into distinct candidate workflows.

You also receive an ACTION LOG recorded on the computer during the session: the exact time of every click,
typing burst (keys are never recorded, only that typing happened and where), keyboard shortcut (⌘C / Ctrl+C copy, ⌘V / Ctrl+V paste,
⌘S / Ctrl+S save… ; ⌃ means Ctrl on Windows), structure key (Enter, Tab, Escape: they move between fields, e.g. Enter leaves a page title) and app switch, with the screen, the app, the window title and the label of the clicked element.
The ACTION LOG is authoritative for the ORDER of actions, the SCREEN and APP used, and WHERE the user clicked or
typed. Match each typing burst with the next frame of that screen to read WHAT was typed (from the OCR text).
The ACTION LOG may also contain lines starting with 🎤: what the user SAID aloud during the session, transcribed automatically
(it can contain small recognition errors), with the time. Use them to understand the INTENT: why a step is done, the rules or
exceptions the user states, what matters to them, and to name the steps. They are NOT authoritative for exact values
(the OCR text wins) nor for the order of actions (the click/typing lines win). Never turn a vague or off-topic remark into a step.
You also receive an OCR TRANSCRIPT: the exact text read on every kept frame by a local OCR engine
(only lines that are new compared to the previous frame). Use the images to understand context,
layout and intent; use the OCR transcript for every EXACT value — dates, prices, amounts, names,
places, references, numbers. When an image and the OCR text disagree on a value, the OCR text wins.
Never invent a value that appears in neither the OCR text nor the images. If the transcript shows a
value changing over time (e.g. a search edited several times), keep the FINAL one the user settled on,
and ignore leftovers such as autocomplete suggestions or recent-search lists unless the user acted on them.
Ignore UI noise that is not part of the task (language or settings menus, cookie banners, ads).`;

const SYSTEM_PROMPT_REST = `

Segment by GOAL, not by site or app switch. If the user visits several different
sites/apps in service of one higher-level intent, that's ONE workflow. Ask yourself "why did
they open the next site" before starting a new segment: if the answer is "to keep pursuing the
same goal," it's the same workflow.

For each candidate segment, ask yourself one general question: "what daily workflow could I
extract from this that would be genuinely useful to the user, and could run automatically every
day without them prompting it?" Use your own judgment to answer it — there's no fixed rule for
what counts, and no fixed rule for what to hold concrete vs. generalize. Decide that per segment
based on what would actually make the extracted routine valuable to rerun tomorrow. Two worked
examples to calibrate that judgment:

- User searched Google Flights for SF→NY, Aug 4–7, checked Expedia bundles, did not book. The
  useful daily workflow here stays CONCRETE (same route, same dates) — there's one live decision
  pending, and the value is in continuing to track that exact trip's price until it's booked or
  the dates pass. Generalizing this to {origin}/{destination} would be wrong — there's nothing
  else to apply it to right now.
- User watched a World Cup match, checked live stats, and placed a bet on Kalshi based on a
  hedge they spotted. The useful daily workflow here GENERALIZES past this one match — new
  matches happen daily during the tournament, so the extracted routine is "check today's World
  Cup match(es), pull stats/odds from Kalshi, evaluate for the same kind of hedge opportunity" —
  the category and the decision logic the user actually used are what's held fixed; which match
  is "today's" is what varies.

If a workflow's daily run would end in an irreversible commitment — booking a non-refundable
fare, placing a real-money bet, sending one specific message, submitting a form — default to
ending the routine at a recommendation/flag for the user to act on, rather than auto-executing
that step, unless the user's own session makes clear they'd want it done automatically.

These routines run on a schedule with ZERO user input — nobody is there to fill anything in
at run time. So never write a {placeholder} waiting to be supplied. Every value in a step is
either:
  - FIXED: a concrete number/name/date carried over from this session, because it's a specific
    pending thing being tracked, or
  - SELF-RESOLVED: something the agent looks up itself during that day's run, written as an
    instruction to go find it, not a slot to fill.

For each kept workflow, output a replayable routine as a flat list of natural-language steps,
the general intent in one phrase, a one-sentence summary, and a one-sentence reason it's worth
running daily and unattended.

Return ONLY a JSON object, no prose, no markdown fences, exactly in this shape:
{"workflows":[{"name":"short French title, 2 to 5 words, no app or tool names (logos show them), e.g. Inspirations design Awwwards","general_intent":"abstracted pattern","summary":"one sentence","why_daily":"one sentence","steps":["step 1","step 2"]}]}`;

// Mode « copie fidèle » (par défaut, celui de l'Observer de Twiin) : décrire EXACTEMENT ce que l'utilisateur a fait,
// sans rien ajouter. Mode « daily » (comportement d'origine d'ImproveMe) : imaginer une routine quotidienne.
const RECORDER_MODE = (process.env.RECORDER_MODE || 'faithful').toLowerCase();

const FAITHFUL_PROMPT = `
Your job is OBSERVATION ONLY: write down, as a replayable procedure, exactly what the user did in this session,
so that an agent can reproduce it identically. Rules:
- Steps = the user's actual actions, in the order they happened, across all apps and screens. One step per action
  or small group of actions (open X, type Y into field Z, copy value V from A into B, save...).
- Use the EXACT values the user saw, typed or selected (take them from the OCR transcript). Write the exact text the
  user typed when it is visible.
- Do NOT add anything the user did not do: no comparison with previous runs, no monitoring, no flagging, no
  recommendation, no summary or report step, no extra checks, no "next company on the list".
- Do NOT generalize: no placeholders, no "for each", keep the concrete company, file, page and values of this session.
- Do NOT invent values or steps you cannot see. If something is unclear, describe what is visible.
- Ignore Twiin itself: starting or stopping the recording, the Twiin page, side panel or window, and its buttons
  (« Enregistrer ma tâche », « Terminer et analyser »…) are not part of the task.
- Write "name", "summary", "why_daily" and "steps" in French (the employee reads them), tutoiement not needed:
  infinitive style (« Cliquer sur… »). Keep on-screen labels and values exactly as shown, in their own language.
- If the user made a mistake and corrected it, keep only the corrected final action.
- IGNORE the recording tool itself: the « Twiin · Enregistrement » recorder page (localhost), its Start/Stop/« Ajouter un écran »
  buttons and the browser's screen-sharing dialogs are NOT part of the task. Never write a step about them.
- Return ONE workflow for the whole session unless the user clearly did several unrelated tasks.
- "general_intent": the goal in one phrase. "summary": one sentence describing what was done.
  "why_daily": one sentence on why this task is worth automating (do NOT turn it into extra steps).

Inside JSON string values never use straight double quotes: quote typed text with « » instead.
Return ONLY a JSON object, no prose, no markdown fences, exactly in this shape:
{"workflows":[{"name":"short French title, 2 to 5 words, no app or tool names (logos show them)","general_intent":"goal","summary":"one sentence","why_daily":"one sentence","steps":["step 1","step 2"]}]}`;

// Journal technique (page Back) : chaque appel au modèle, coût, scan, tuto… — jamais montré dans le parcours de l'employé.
const BACK_LOG = path.join(REPO_ROOT, 'workflows', 'back-log.jsonl');
function backLog(kind, data = {}) {
  sb('back_log', { method: 'POST', body: { kind, cost_usd: typeof data.cost_usd === 'number' ? data.cost_usd : null, data }, prefer: 'return=minimal' });
  try {
    fs.mkdirSync(path.dirname(BACK_LOG), { recursive: true });
    fs.appendFileSync(BACK_LOG, JSON.stringify({ t: new Date().toISOString(), kind, ...data }) + '\n');
  } catch { /* le journal ne doit jamais casser le parcours */ }
}
const SESSIONS_DIR = path.join(REPO_ROOT, 'workflows', 'sessions'); // images des enregistrements (local, ignoré par git)
const MAX_OUTPUT_TOKENS = parseInt(process.env.HF_MAX_OUTPUT_TOKENS || '16000', 10);
const REASONING_EFFORT = process.env.HF_REASONING_EFFORT || 'low'; // le modèle réfléchit moins : la réponse n'est plus coupée

function parseWorkflows(text) {
  text = (text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s >= 0 && e > s) text = text.slice(s, e + 1);
  try { return { result: JSON.parse(text), repaired: null }; }
  catch (err) {
    console.warn(`JSON invalide (${err.message}) : réparation locale`);
    return { result: JSON.parse(jsonrepair(text)), repaired: 'local' };
  }
}

// --- Journal d'actions (actions.py) : clics, saisies (sans les touches), raccourcis, changements d'app ----------
let recorderSession = null; // { id, dir, proc, startedAt }

function newSessionDir() {
  const id = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = path.join(SESSIONS_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  return { id, dir };
}

function readActions(dir) {
  const f = path.join(dir, 'actions.jsonl');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

// Les écrans partagés dans le navigateur s'appellent « Écran 1, 2… » ; Chrome donne leur identifiant macOS
// dans le libellé (« screen:2:0 »). On s'en sert pour parler du même écran dans les images et dans le journal.
function displayToScreen(screens) {
  const map = new Map();
  for (const s of screens || []) {
    const m = /^screen:(\d+):/.exec(s.label || '');
    if (m) map.set(Number(m[1]), s.n);
  }
  return map;
}

const IS_RECORDER = (e) => /improveme|Twiin · Enregistrement/i.test(e.window || '') || /localhost:3000/.test(e.window || '');

// --- Fausses applis : applis ouvertes par erreur, hors tâche ---------------------------------------------------------
// Détection automatique (peu de temps, ni saisie ni copier-coller) → préremplit ; l'employé corrige (apps.json de la session).
// Dans le doute, l'appli reste comptée.
const APPS_FILE = 'apps.json';
function readAppChoice(dir) {
  try { const j = JSON.parse(fs.readFileSync(path.join(dir, APPS_FILE), 'utf8')); return Array.isArray(j.excluded) ? j.excluded.map(String) : null; }
  catch { return null; }
}
// Applis exclues pour cette session = choix de l'employé s'il existe, sinon suggestions automatiques.
function excludedApps(dir, events) {
  return effectiveExcluded(events.filter((e) => !IS_RECORDER(e)), dir ? readAppChoice(dir) : null);
}

function actionTranscript(events, startedAtMs, screens) {
  const map = displayToScreen(screens);
  const scr = (d) => (d == null ? 'screen ?' : map.has(d) ? `screen ${map.get(d)}` : `macOS display ${d}`);
  const t = (ts) => `t+${(ts - startedAtMs / 1000).toFixed(1)}s`;
  const lines = [];
  for (const e of events) {
    if (!e?.type || ['start', 'stop', 'error'].includes(e.type) || IS_RECORDER(e)) continue;
    const where = `${scr(e.display)} · ${e.app || '?'}${e.window ? ` (${e.window})` : ''}`;
    if (e.type === 'app') lines.push(`${t(e.ts)} · ${where} · comes to the front`);
    else if (e.type === 'click') lines.push(`${t(e.ts)} · ${where} · ${e.double ? 'double-' : ''}${e.button === 'right' ? 'right-' : ''}click on ${e.element || 'an element'}`);
    else if (e.type === 'typing') lines.push(`${t(e.ts)}→${t(e.until).slice(2)} · ${where} · typing${e.keys ? ` (${e.keys} keys)` : ''} in ${e.element || 'the focused field'}`);
    else if (e.type === 'shortcut') lines.push(`${t(e.ts)} · ${where} · shortcut ${e.keys}`);
    else if (e.type === 'voice') lines.push(`${t(e.ts)}→${t(e.until).slice(2)} · 🎤 the user says: « ${String(e.text).replace(/\s+/g, ' ').trim()} »`);
    else if (e.type === 'key') lines.push(`${t(e.ts)} · ${where} · presses ${({ 'Entrée': 'Enter', 'Échap': 'Escape' })[e.keys] || e.keys}${e.element ? ` in ${e.element}` : ''}`);
  }
  let out = lines.join('\n');
  if (out.length > 15000) out = out.slice(0, 15000) + '\n[… journal tronqué]';
  return out;
}

// --- Voix : audio envoyé par la page (si « Capture vocale » est activée) puis transcrit en local par Whisper --------
const AUDIO_RE = /^audio\.(webm|m4a|ogg)$/;
const WHISPER_TIMEOUT_MS = parseInt(process.env.WHISPER_TIMEOUT_MS || '600000', 10); // 10 min
app.post('/api/audio', express.raw({ type: () => true, limit: '200mb' }), (req, res) => {
  try {
    const dir = /^[0-9A-Za-z-]+$/.test(String(req.query.session || '')) ? sessionDirById(String(req.query.session)) : null; // jamais « .. » ni le dossier racine des sessions
    const startedAt = Number(req.query.startedAt);
    if (!dir) return res.status(400).json({ error: 'session introuvable' });
    if (!Number.isFinite(startedAt)) return res.status(400).json({ error: 'heure de départ de l\'audio manquante' });
    if (!Buffer.isBuffer(req.body) || req.body.length < 1000) return res.status(400).json({ error: 'audio vide' });
    const mime = String(req.headers['content-type'] || '');
    const ext = /mp4|m4a/.test(mime) ? 'm4a' : /ogg/.test(mime) ? 'ogg' : 'webm';
    for (const f of fs.readdirSync(dir)) if (AUDIO_RE.test(f)) fs.rmSync(path.join(dir, f));
    fs.rmSync(path.join(dir, 'voice.json'), { force: true }); // un nouvel audio = une nouvelle transcription
    fs.writeFileSync(path.join(dir, `audio.${ext}`), req.body);
    fs.writeFileSync(path.join(dir, 'audio.json'), JSON.stringify({ startedAt, mime, bytes: req.body.length }));
    console.log(`Audio reçu : ${(req.body.length / 1024).toFixed(0)} Ko (${ext}) pour ${path.basename(dir)}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Transcription de la voix : 100 % locale (Whisper sur ce poste, l'audio ne le quitte pas) ----------------------
// Au lancement du serveur, si faster-whisper ou le modèle manquent, ils s'installent seuls en arrière-plan (voir plus bas).
const VOICE_VENV = path.join(REPO_ROOT, 'workflows', 'voice-venv'); // créé par le bouton d'installation si le projet n'a pas de .venv
const venvPy = (dir) => path.join(dir, 'bin', 'python');
// Python de la transcription locale, relu à chaque appel (l'installation à la volée peut le créer). On ne touche pas à
// PYTHON (OCR, journal d'actions, Holo) : un .venv minimal créé ici lui retirerait ses modules (Quartz…).
function voicePython() {
  for (const d of [path.join(REPO_ROOT, '.venv'), VOICE_VENV]) if (fs.existsSync(venvPy(d))) return venvPy(d);
  return 'python3';
}
const hfHub = () => path.join(process.env.HF_HOME || path.join(os.homedir(), '.cache', 'huggingface'), 'hub');
const modelDir = () => path.join(hfHub(), 'models--Systran--faster-whisper-small');
// Le modèle est « là » seulement si model.bin existe (un dossier à moitié téléchargé ne compte pas).
function modelPresent() {
  try {
    const snaps = path.join(modelDir(), 'snapshots');
    return fs.readdirSync(snaps).some((s) => fs.existsSync(path.join(snaps, s, 'model.bin')));
  } catch { return false; }
}
function dirSize(dir) {
  let n = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) n += dirSize(p); else if (e.isFile()) n += fs.statSync(p).size;
    }
  } catch { /* dossier absent */ }
  return n;
}

// Raison d'un échec de transcription, en une courte phrase pour l'employé (le détail technique reste dans `error` et la console).
function voiceReason(msg) {
  const m = String(msg || '');
  if (/faster-whisper n'est pas installé|No module named 'faster_whisper'/.test(m)) return 'faster-whisper n\'est pas installé sur cet ordinateur';
  if (/trop longue/.test(m)) return 'la transcription a pris trop de temps (modèle non téléchargé ou pas de réseau ?)';
  if (/EOF|Invalid data|av\.error|Errno/.test(m)) return 'l\'audio n\'a pas pu être lu';
  return 'erreur de transcription';
}

// Transcription locale possible sur CET ordinateur ? (faster-whisper et `av` < 16 installés ; le modèle « small », ~460 Mo,
// est présent ou à télécharger). La partie Python est vérifiée une fois par minute au plus ; le modèle, à chaque appel.
let localPyCache = { at: 0, value: null };
function localVoiceStatus(fresh = false) {
  return new Promise((resolve) => {
    const finish = (py) => resolve(py.ready ? { ready: true, needsDownload: !modelPresent() } : py);
    if (!fresh && localPyCache.value && Date.now() - localPyCache.at < 60_000) return finish(localPyCache.value);
    const done = (value) => { localPyCache = { at: Date.now(), value }; finish(value); };
    let out = '';
    const py = spawn(voicePython(), ['-c', 'import faster_whisper, av; print(av.__version__)']);
    const timer = setTimeout(() => py.kill('SIGKILL'), 15_000);
    py.stdout.on('data', (d) => (out += d));
    py.on('error', () => { clearTimeout(timer); done({ ready: false, reason: 'Python introuvable' }); });
    py.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return done({ ready: false, reason: 'la transcription locale n\'est pas encore installée' });
      if (parseInt(out, 10) >= 16) return done({ ready: false, reason: 'la bibliothèque « av » est trop récente (il faut une version < 16)' });
      done({ ready: true });
    });
  });
}

// État de la transcription locale pour la page (+ l'installation automatique en cours, s'il y en a une).
app.get('/api/audio/status', async (req, res) => {
  const local = await localVoiceStatus();
  // Prête = faster-whisper ET le modèle sont là ; un modèle à télécharger rend la voix indisponible le temps de l'installation.
  const ready = local.ready && !local.needsDownload;
  const reason = ready ? undefined : local.reason || (install.state === 'running' ? 'le modèle de transcription (~460 Mo) est en cours d\'installation' : 'le modèle de transcription n\'est pas encore téléchargé');
  res.json({ ready, reason, install: installView(), canChange: ownPageOnly(req) });
});

// Installation : cet ordinateur ET une page de Twiin elle-même (pas une autre page web ouverte dans le navigateur,
// qui pourrait envoyer la requête sans autorisation, ni un nom de domaine détourné vers 127.0.0.1).
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
const hostName = (h) => { try { return new URL(`http://${h}`).hostname; } catch { return ''; } };
function ownPageOnly(req) {
  if (!isLocal(req) || !LOCAL_HOSTS.includes(hostName(req.headers.host))) return false;
  const origin = req.headers.origin;
  if (!origin) return true; // outil en ligne de commande (curl)
  try { return LOCAL_HOSTS.includes(new URL(origin).hostname); } catch { return false; }
}

// Installation de la transcription locale (automatique au lancement ; le bouton « Réessayer » de la page la relance) : un seul travail à la fois, suivi par la page.
//   1. un .venv (ou workflows/voice-venv s'il n'y en a pas) ; 2. faster-whisper + av < 16 ; 3. le modèle « small » (~460 Mo).
const MODEL_MB = 460;
let install = { state: 'idle' };
const installView = () => (install.state === 'running' && install.step === 'model' ? { ...install, modelBytes: dirSize(modelDir()), modelTotalMb: MODEL_MB } : install);
function runCmd(cmd, args, timeoutMs) {
  const env = { ...process.env }; delete env.HF_TOKEN; delete env.HUGGING_FACE_HUB_TOKEN; // modèle public : inutile d'envoyer un jeton
  return new Promise((resolve, reject) => {
    let tail = '';
    const p = spawn(cmd, args, { env });
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('timeout')); }, timeoutMs);
    const keep = (d) => { tail = (tail + d).slice(-2000); };
    p.stdout.on('data', keep); p.stderr.on('data', keep);
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => { clearTimeout(timer); if (code === 0) resolve(tail); else reject(new Error(tail.trim().split('\n').slice(-3).join(' ').slice(0, 300) || `code ${code}`)); });
  });
}
function installReason(err) {
  const m = String(err?.message || err).replace(/\s+/g, ' ').trim();
  if (err?.user) return m;
  if (/^timeout$/.test(m)) return 'l\'installation a pris trop de temps : vérifie ta connexion puis réessaie';
  if (/Temporary failure|Max retries|Name or service|nodename|urlopen|offline|ConnectError|Network is unreachable|ConnectionError|Connection (reset|refused|aborted)|SSLError|getaddrinfo|Could not find a version|No matching distribution|CAS Client Error|error sending request|Request middleware/i.test(m)) return 'pas de réseau (ou accès bloqué) : vérifie ta connexion puis réessaie';
  if (/ENOENT/.test(m)) return 'Python est introuvable sur cet ordinateur';
  return `l'installation a échoué (${m.slice(0, 160)})`;
}
async function installVoice() {
  const step = (s, message) => { install = { ...install, state: 'running', step: s, message }; };
  try {
    step('python', 'Vérification de Python…');
    let py = voicePython();
    if (py === 'python3') {
      let ok = '';
      try { ok = await runCmd('python3', ['-c', 'import sys; print(int(sys.version_info >= (3, 10)))'], 15_000); } catch { /* introuvable */ }
      if (ok.trim() !== '1') throw Object.assign(new Error('Python 3.10 ou plus récent est nécessaire (python.org, ou « brew install python »)'), { user: true });
      step('venv', 'Création de l\'environnement Python…');
      await runCmd('python3', ['-m', 'venv', VOICE_VENV], 120_000);
      py = venvPy(VOICE_VENV);
    }
    step('packages', 'Installation de faster-whisper…');
    await runCmd(py, ['-m', 'pip', 'install', '--disable-pip-version-check', 'faster-whisper>=1.1', 'av<16'], 15 * 60_000);
    step('model', `Téléchargement du modèle (~${MODEL_MB} Mo)…`);
    await runCmd(py, ['-c', "from faster_whisper.utils import download_model; download_model('small')"], 40 * 60_000);
    const st = await localVoiceStatus(true);
    if (!st.ready) throw Object.assign(new Error(st.reason), { user: true });
    if (st.needsDownload) throw Object.assign(new Error('le modèle n\'est pas complet : relance l\'installation'), { user: true });
    install = { state: 'done', message: 'Transcription locale installée.' };
    console.log('Transcription locale installée.');
  } catch (err) {
    install = { state: 'error', message: installReason(err) };
    console.warn(`⚠️ Installation de la transcription locale : ${err.message}`);
  }
}
app.post('/api/audio/install', async (req, res) => {
  if (!ownPageOnly(req)) return res.status(403).json({ error: 'réservé à cet ordinateur' });
  if (install.state === 'running') return res.status(202).json(installView()); // double clic : une seule installation
  const st = await localVoiceStatus(true);
  if (st.ready && !st.needsDownload) { install = { state: 'done', message: 'Déjà installée.' }; return res.json(install); }
  if (install.state === 'running') return res.status(202).json(installView()); // une autre requête a démarré pendant la vérification
  install = { state: 'running', step: 'python', message: 'Vérification de Python…', startedAt: Date.now() };
  installVoice();
  res.status(202).json(installView());
});
app.get('/api/audio/install/status', (req, res) => res.json(installView()));

// Passages de voix déjà transcrits (voice.json), à heure absolue ; liste vide s'il n'y en a pas.
function readVoiceCache(dir) {
  try {
    const voice = JSON.parse(fs.readFileSync(path.join(dir, 'voice.json'), 'utf8'));
    const base = voice.audio_started_at_ms / 1000;
    return (voice.segments || []).map((s) => ({ type: 'voice', ts: base + s.start, until: base + s.end, text: s.text }));
  } catch { return []; }
}

// Transcrit l'audio de la session en local (une seule fois : voice.json sert de cache) et renvoie des événements « voice »
// à heure absolue (secondes), calés sur le même repère que le journal d'actions. Ne plante jamais l'analyse.
async function transcribeSession(dir) {
  const info = { status: 'none', segments: 0 };
  try {
    const audio = fs.readdirSync(dir).find((f) => AUDIO_RE.test(f));
    if (!audio) return { events: [], info };
    const voiceF = path.join(dir, 'voice.json');
    if (!fs.existsSync(voiceF)) {
      setPhase('transcription');
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'audio.json'), 'utf8'));
      const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'transcribe.py');
      const tmp = voiceF + '.tmp';
      await new Promise((resolve, reject) => {
        const py = spawn(voicePython(), [script, '--audio', path.join(dir, audio), '--out', tmp]);
        let err = '';
        // Garde-fou : premier usage sans réseau (téléchargement du modèle) ou audio énorme → on abandonne, l'analyse continue sans voix
        const timer = setTimeout(() => { py.kill('SIGKILL'); reject(new Error(`transcription trop longue (plus de ${Math.round(WHISPER_TIMEOUT_MS / 60000)} min)`)); }, WHISPER_TIMEOUT_MS);
        py.stderr.on('data', (d) => (err += d));
        py.on('error', (e) => { clearTimeout(timer); reject(e); });
        py.on('close', (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(err.trim().split('\n').slice(-2).join(' ').slice(0, 400) || `code ${code}`)); });
      });
      const out = JSON.parse(fs.readFileSync(tmp, 'utf8'));
      out.audio_started_at_ms = meta.startedAt;
      fs.writeFileSync(voiceF, JSON.stringify(out, null, 2));
      fs.rmSync(tmp, { force: true });
      console.log(`Transcription locale : ${out.segments.length} segment(s), ${out.audio_duration} s d'audio, ${out.elapsed} s de calcul`);
    }
    const events = readVoiceCache(dir);
    return { events, info: { status: events.length ? 'ok' : 'empty', segments: events.length } };
  } catch (err) {
    console.warn(`⚠️ Voix non transcrite, l'analyse continue sans elle : ${err.message}`);
    return { events: [], info: { status: 'failed', segments: 0, reason: voiceReason(err.message), error: String(err.message).slice(0, 200) } };
  }
}

// Images envoyées AU FIL DE L'EAU par la page (une requête par image) : si la page plante, rien n'est perdu.
function sessionDirById(id) {
  if (recorderSession?.id === id) return recorderSession.dir;
  const dir = path.join(SESSIONS_DIR, String(id || '').replace(/[^0-9A-Za-z-]/g, ''));
  return id && fs.existsSync(dir) ? dir : null;
}

function loadSessionFrames(dir) {
  const jl = path.join(dir, 'frames.jsonl');
  if (fs.existsSync(jl)) {
    const frames = fs.readFileSync(jl, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
      .sort((a, b) => a.index - b.index);
    const metaF = path.join(dir, 'session.json');
    const meta = fs.existsSync(metaF) ? JSON.parse(fs.readFileSync(metaF, 'utf8')) : {};
    const screens = [...new Map(frames.map((f) => [f.screen, { n: f.screen, label: f.screen_label || '' }])).values()];
    return { frames, startedAt: meta.startedAt || Date.parse(frames[0]?.timestamp), screens };
  }
  const old = path.join(dir, 'frames.json');
  if (fs.existsSync(old)) return JSON.parse(fs.readFileSync(old, 'utf8'));
  return { frames: [], startedAt: null, screens: [] };
}

// ── Données sensibles : repérées EN LOCAL dans le texte lu à l'écran (OCR), masquées SUR les images avant tout envoi ──
// Le masquage modifie les images de l'enregistrement elles-mêmes : l'analyse (Hugging Face), la découverte (jumeau) et
// les tutos n'utilisent plus que les images masquées. Les mêmes motifs sont masqués dans le texte et le journal envoyés.
const SENSIBLE = [
  ['e-mail', /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g],
  ['téléphone', /(?:\+33[\s.]?|\b0)[1-9](?:[\s.-]?\d{2}){4}\b/g],
  ['IBAN', /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,3})?\b/g],
  ['n° de sécurité sociale', /\b[12][\s.]?\d{2}[\s.]?\d{2}[\s.]?\d{2}[\s.]?\d{3}[\s.]?\d{3}(?:[\s.]?\d{2})?\b/g],
  ['carte bancaire', /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{1,7}\b/g],
  ['clé ou jeton', /\b(?:sk|pk|rk)[-_][\w-]{10,}|\bsb_[a-z]+_[\w-]{10,}|\bhf_\w{10,}|\bgh[pousr]_\w{10,}|\bxox[abp]-[\w-]{10,}|\beyJ[\w-]{10,}(?:\.[\w-]+){0,2}|\b(?=[\w-]*\d)(?=[\w-]*[A-Za-z])[\w-]{32,}\b/g],
  ['mot de passe', /(?:mot de passe|password|passcode|code secret|code pin)\s*[:=]?\s*\S*/gi],
];
const sensibleKinds = (text) => SENSIBLE.filter(([, re]) => { re.lastIndex = 0; return re.test(text); }).map(([k]) => k);
function masquerTexte(text) {
  let t = String(text || '');
  for (const [k, re] of SENSIBLE) { re.lastIndex = 0; t = t.replace(re, `[${k} masqué]`); }
  return t;
}
// Script Python du dossier recorder (stdin JSON → stdout JSON), sans fenêtre
function runScriptJson(script, input) {
  return new Promise((resolve, reject) => {
    const py = spawn(PYTHON, [path.join(path.dirname(fileURLToPath(import.meta.url)), script)], { windowsHide: true });
    let out = '', err = '';
    py.stdout.on('data', (d) => (out += d));
    py.stderr.on('data', (d) => (err += d));
    py.on('error', reject);
    py.stdin.on('error', () => {});
    py.on('close', (code) => { if (code) return reject(new Error(err.slice(0, 300) || `${script} : code ${code}`)); try { resolve(JSON.parse(out)); } catch (e) { reject(e); } });
    py.stdin.end(JSON.stringify(input));
  });
}
// Masque une fois pour toutes les données sensibles d'un enregistrement (images de frames.jsonl). Idempotent.
async function masquerSession(dir) {
  const metaF = path.join(dir, 'session.json');
  const meta = fs.existsSync(metaF) ? JSON.parse(fs.readFileSync(metaF, 'utf8')) : {};
  if (meta.masque) return meta.masque;
  const jl = path.join(dir, 'frames.jsonl');
  if (!fs.existsSync(jl)) return { zones: 0, types: {} };
  const { frames } = loadSessionFrames(dir);
  const ocr = await runOcr(frames);
  const byIndex = new Map(ocr.map((o) => [o.index, o.lines || []]));
  const types = {}, todo = [];
  let zones = 0;
  for (const f of frames) {
    const boxes = [];
    for (const l of byIndex.get(f.index) || []) {
      const kinds = sensibleKinds(l.text);
      if (!kinds.length || !l.box) continue;
      boxes.push(l.box); zones++;
      for (const k of kinds) types[k] = (types[k] || 0) + 1;
    }
    if (boxes.length) todo.push({ index: f.index, dataUrl: f.dataUrl, ocrUrl: f.ocrUrl, boxes });
  }
  if (todo.length) {
    const done = new Map((await runScriptJson('redact.py', todo)).map((d) => [d.index, d]));
    for (const f of frames) { const d = done.get(f.index); if (d) { f.dataUrl = d.dataUrl; if (d.ocrUrl) f.ocrUrl = d.ocrUrl; } }
    fs.writeFileSync(jl, frames.map((f) => JSON.stringify(f)).join('\n') + '\n');
  }
  meta.masque = { zones, images: todo.length, types, at: new Date().toISOString() };
  fs.writeFileSync(metaF, JSON.stringify(meta));
  console.log(`Masquage local : ${zones} zone(s) sensible(s) sur ${todo.length} image(s) ${JSON.stringify(types)}`);
  return meta.masque;
}
// Relecture AVANT envoi : les images de l'enregistrement, déjà masquées ; rien n'est encore parti de l'ordinateur.
app.get('/api/session/:id/review', async (req, res) => {
  const dir = sessionDirById(req.params.id);
  if (!dir) return res.status(404).json({ error: 'Enregistrement introuvable.' });
  try {
    setPhase('mask');
    const masque = await masquerSession(dir);
    const { frames } = loadSessionFrames(dir);
    res.json({ masque, frames: frames.map((f) => ({ index: f.index, seconds: f.seconds, screen: f.screen, src: f.dataUrl })) });
  } catch (e) {
    res.status(500).json({ error: `Masquage impossible : ${e.message}` });
  } finally { setPhase('idle'); }
});
// Retirer des images (elles sont effacées de l'ordinateur), ou tout l'enregistrement (all: true)
app.post('/api/session/:id/review', (req, res) => {
  const dir = sessionDirById(req.params.id);
  if (!dir) return res.status(404).json({ error: 'Enregistrement introuvable.' });
  if (req.body?.all) {
    if (recorderSession?.dir === dir) recorderSession = null;
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`Enregistrement ${path.basename(dir)} supprimé par l'employé`);
    return res.json({ ok: true, left: 0, deleted: true });
  }
  const jl = path.join(dir, 'frames.jsonl');
  if (!fs.existsSync(jl)) return res.status(400).json({ error: 'Images introuvables.' });
  const remove = new Set((req.body?.remove || []).map(Number));
  const keep = loadSessionFrames(dir).frames.filter((f) => !remove.has(f.index));
  fs.writeFileSync(jl, keep.map((f) => JSON.stringify(f)).join('\n') + (keep.length ? '\n' : ''));
  console.log(`Relecture : ${remove.size} image(s) retirée(s) par l'employé, ${keep.length} gardée(s)`);
  res.json({ ok: true, left: keep.length });
});

// ── Extension Chrome : elle se signale régulièrement ; l'onboarding de l'app coche « extension connectée » tout seul ──
let extensionSeen = null;
app.post('/api/extension/ping', (req, res) => {
  extensionSeen = { at: Date.now(), version: String(req.body?.version || '').slice(0, 20) };
  res.json({ ok: true });
});
app.get('/api/extension/status', (req, res) =>
  res.json({ connected: !!extensionSeen && Date.now() - extensionSeen.at < 90000, version: extensionSeen?.version || null }));

app.post('/api/frames', (req, res) => {
  try {
    const { session, frame } = req.body;
    const dir = sessionDirById(session);
    if (!dir || !frame) return res.status(400).json({ error: 'session ou image manquante' });
    if (recorderSession?.paused) return res.json({ ok: true, paused: true }); // pause : aucune capture gardée
    fs.appendFileSync(path.join(dir, 'frames.jsonl'), JSON.stringify(frame) + '\n');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/actions/start', (req, res) => {
  try {
    if (recorderSession?.proc) recorderSession.proc.kill('SIGTERM');
    const { id, dir } = newSessionDir();
    const proc = spawn(PYTHON, [path.join(path.dirname(fileURLToPath(import.meta.url)), ACTIONS_SCRIPT), '--out', path.join(dir, 'actions.jsonl')]);
    proc.on('error', (e) => console.warn('[journal] indisponible :', e.message));
    proc.stdin.on('error', () => {});
    proc.stderr.on('data', (d) => console.warn('[journal]', String(d).trim().slice(0, 300)));
    proc.on('close', (code) => console.log(`Journal d'actions arrêté (code ${code})`));
    recorderSession = { id, dir, proc, startedAt: req.body?.startedAt || Date.now() };
    // ajouterA : cet enregistrement complète une tâche déjà enregistrée (tâche oubliée), ses étapes y seront ajoutées
    recorderSession.ajouterA = req.body?.ajouterA || null;
    fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({ startedAt: recorderSession.startedAt, ajouterA: recorderSession.ajouterA }));
    console.log(`Journal d'actions démarré : ${dir}`);
    res.json({ session: id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/actions/stop', (req, res) => {
  if (recorderSession?.proc) recorderSession.proc.kill('SIGTERM');
  res.json({ ok: true });
});

// Pause pendant l'enregistrement : le journal ignore les clics et les touches, et les captures ne sont plus gardées.
app.post('/api/actions/pause', (req, res) => {
  if (!recorderSession?.proc) return res.status(409).json({ error: 'Aucun enregistrement en cours.' });
  recorderSession.paused = !recorderSession.paused;
  recorderSession.proc.kill('SIGUSR1');
  res.json({ paused: recorderSession.paused });
});

// L'interface demande au serveur s'il reste un journal ouvert (après un rechargement de la page).
app.get('/api/actions/status', (req, res) => {
  const running = !!(recorderSession?.proc && recorderSession.proc.exitCode === null && recorderSession.proc.signalCode === null);
  res.json({ running, paused: !!(running && recorderSession.paused), session: running ? recorderSession.id : null });
});

app.get('/api/actions', (req, res) => {
  const since = parseInt(req.query.since || '0', 10);
  if (!recorderSession) return res.json({ events: [], next: 0 });
  const all = readActions(recorderSession.dir);
  res.json({ events: all.slice(since).filter((e) => !IS_RECORDER(e)), next: all.length });
});

// Avancement de l'analyse en cours, lu par la page chaque seconde (étapes cochées pendant l'attente).
let analysisProgress = { phase: 'idle', at: Date.now() };
const setPhase = (phase) => { analysisProgress = { phase, at: Date.now() }; };
app.get('/api/analysis/progress', (req, res) => res.json(analysisProgress));

// Analyse commune : nouvel enregistrement (images + OCR) ou relance (images gardées, ou texte OCR seul).
async function analyze({ frames, transcript, actionLog = '', ocrLines = 0, screens = 1, textOnly = false, session = null, voice = null }) {
  const used = textOnly ? [] : sampleFrames(frames);
  const header = textOnly
    ? `No images are available for this session: only the OCR transcript of its ${frames?.length ?? 'several'} kept frames over ${screens} screen(s). Return the JSON described in the system prompt.`
    : `${frames.length} frames kept in total over ${screens} screen(s); ${used.length} of them are shown below, in time order. Return the JSON described in the system prompt.`;
  const content = [
    { type: 'text', text: header },
    ...used.flatMap((f) => [{ type: 'text', text: `Image ${f.index} · screen ${f.screen ?? 1} · t+${f.seconds ?? '?'}s` }, toImageBlock(f.dataUrl)]),
    { type: 'text', text: `ACTION LOG (recorded during the session: exact time, screen, app and clicked element; authoritative for ORDER and WHERE; lines starting with 🎤 are what the user said aloud):\n${actionLog || '(no action log)'}` },
    { type: 'text', text: `OCR TRANSCRIPT (exact text, authoritative for values):\n${transcript || '(no text read)'}` },
  ];

  setPhase('model');
  const { data: resp, response: httpResp } = await client.chat.completions.create({
    model: HF_MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    temperature: 0,
    reasoning_effort: REASONING_EFFORT,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT + '\n' + (RECORDER_MODE === 'daily' ? SYSTEM_PROMPT_REST : FAITHFUL_PROMPT) },
      { role: 'user', content },
    ],
  }).withResponse();

  const provider = httpResp.headers.get('x-inference-provider') || null;
  const usage = resp.usage || {};
  const price = provider && PRICING[provider];
  const cost_usd = typeof usage.cost === 'number' ? usage.cost
    : price ? ((usage.prompt_tokens || 0) * price.input + (usage.completion_tokens || 0) * price.output) / 1e6 : null;
  const meta = { mode: RECORDER_MODE, model: HF_MODEL, provider, screens, images_kept: frames?.length ?? null,
                 images_sent: used.length, text_only: textOnly, ocr_lines: ocrLines, ocr_chars: (transcript || '').length,
                 action_lines: actionLog ? actionLog.split('\n').length : 0,
                 voice, usage, cost_usd };
  console.log(`Modèle ${HF_MODEL} via ${provider ?? '?'} : ${usage.prompt_tokens ?? '?'} tokens entrée, ${usage.completion_tokens ?? '?'} sortie` +
              (cost_usd != null ? `, ≈ ${cost_usd.toFixed(4)} $` : ''));

  setPhase('parse');
  const choice = resp.choices?.[0];
  const raw = choice?.message?.content || '';
  if (!raw.trim() || (choice?.finish_reason === 'length' && !raw.includes('}'))) {
    throw new Error(`Réponse du modèle coupée ou vide (${usage.completion_tokens ?? '?'} tokens, dont ` +
      `${usage.completion_tokens_details?.reasoning_tokens ?? '?'} de raisonnement). Clique sur « Réanalyser le dernier enregistrement ».`);
  }
  const { result, repaired } = parseWorkflows(raw);
  meta.json_repaired = repaired;
  meta.session = session;
  for (const w of result.workflows || []) w.session = session; // la tâche garde le lien vers SON enregistrement
  // Filet de sécurité : les étapes qui ne concernent que Twiin (démarrer ou terminer l'enregistrement) ne font pas partie de la tâche
  const TWIIN_STEP = /(terminer et analyser|enregistrer ma t[âa]che|(panneau|page|fen[êe]tre|extension|bulle) twiin|twiin (panel|page|window))/i;
  for (const w of result.workflows || []) if (Array.isArray(w.steps)) w.steps = w.steps.filter((st) => !TWIIN_STEP.test(String(st)));
  if (sbUser()) {
    // Table d'équipe « taches » (fusion validée par Hanine) : une ligne par tâche, rattachée à l'entreprise de l'employé.
    // Plusieurs tâches dans un même enregistrement : source_session_id suffixé (#2, #3…) car il est unique par entreprise.
    const company = sbUser()?.company_id;
    const rows = company ? await sb('taches?on_conflict=company_id,source_session_id', {
      method: 'POST', prefer: 'resolution=merge-duplicates,return=representation',
      body: (result.workflows || []).map((w, i) => ({
        company_id: company, title: w.name || 'Tâche', summary: w.summary || null, why: w.why_daily || null,
        steps: w.steps || [], source_session_id: i ? `${session}#${i + 1}` : session, source: 'analyse', status: 'analysed',
        meta: { model: HF_MODEL, provider, tokens_in: usage.prompt_tokens, tokens_out: usage.completion_tokens, cost_usd,
                images_sent: used.length, ocr_lines: ocrLines, screens } })) }) : null;
    (rows || []).forEach((row, i) => { if (result.workflows[i]) result.workflows[i].task_id = row.id; });
  }
  if (!Array.isArray(result.workflows) || !result.workflows.length) {
    throw new Error('Le modèle n\'a renvoyé aucun workflow. Réponse brute : ' + raw.slice(0, 300));
  }

  fs.mkdirSync(path.dirname(CANDIDATES_PATH), { recursive: true });
  fs.writeFileSync(CANDIDATES_PATH, JSON.stringify(result, null, 2) + '\n');
  fs.writeFileSync(LAST_RUN_PATH, JSON.stringify({ meta, action_log: actionLog, ocr_transcript: transcript }, null, 2) + '\n');
  // chaque analyse est gardée dans SON enregistrement : l'historique « Mes enregistrements » la retrouve
  if (session && fs.existsSync(path.join(SESSIONS_DIR, path.basename(session)))) {
    fs.writeFileSync(path.join(SESSIONS_DIR, path.basename(session), 'analysis.json'),
      JSON.stringify({ analysedAt: new Date().toISOString(), meta, result }, null, 2) + '\n');
    // enregistrement d'ajout : ses étapes complètent la tâche d'origine
    const cible = lireJson(path.join(SESSIONS_DIR, path.basename(session), 'session.json'))?.ajouterA;
    if (cible) fusionnerAjout(path.join(SESSIONS_DIR, path.basename(cible)), path.basename(session), result);
  }
  console.log(`Wrote ${result.workflows.length} candidate workflow(s) to ${CANDIDATES_PATH}`);
  backLog('analyse', { model: HF_MODEL, provider, tokens_in: usage.prompt_tokens, tokens_out: usage.completion_tokens, cost_usd,
                       images_sent: meta.images_sent, ocr_lines: ocrLines, actions: meta.action_lines, json_repaired: repaired,
                       workflows: result.workflows.map((w) => `${w.name} (${(w.steps || []).length} étapes)`) });
  return { ...result, _meta: meta };
}

async function analyzeSessionDir(dir, { textOnly = false } = {}) {
  setPhase('mask');
  await masquerSession(dir); // jamais d'image non masquée vers l'analyse, même si la relecture a été sautée
  const { frames, startedAt, screens: shared } = loadSessionFrames(dir);
  if (!frames.length) throw new Error('Aucune image enregistrée pour cet enregistrement.');
  const voice = await transcribeSession(dir);
  const allEvents = mergeVoice(readActions(dir), voice.events);
  const excluded = excludedApps(dir, allEvents);
  const events = filterEvents(allEvents, excluded);
  let actionLog = actionTranscript(events, startedAt || Date.parse(frames[0]?.timestamp), shared);
  if (excluded.length) actionLog += `\n[NOTE: the user marked these apps as NOT part of the task (opened by mistake): ${excluded.join(', ')}. Ignore them in the screenshots too.]`;
  actionLog = masquerTexte(actionLog); // la voix transcrite et le journal passent aussi par le masquage local
  const t0 = Date.now();
  setPhase('ocr');
  const ocr = await runOcr(frames);
  const transcript = masquerTexte(ocrTranscript(frames, ocr));
  const ocrLines = ocr.reduce((n, o) => n + (o.lines?.length || 0), 0);
  console.log(`OCR local : ${ocr.length} image(s), ${ocrLines} lignes, ${transcript.length} caractères gardés, ${((Date.now() - t0) / 1000).toFixed(1)} s · journal : ${actionLog ? actionLog.split('\n').length : 0} action(s)`);
  const screens = new Set(frames.map((f) => f.screen ?? 1)).size;
  return analyze({ frames, transcript, actionLog, ocrLines, screens, textOnly, session: path.basename(dir), voice: voice.info });
}

app.post('/api/generate-workflows', async (req, res) => {
  try {
    const { frames, session, startedAt, screens: shared, textOnly } = req.body;
    if (recorderSession?.proc) recorderSession.proc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 600)); // laisse le journal écrire ses dernières lignes
    let dir = sessionDirById(session);
    if (frames?.length) { // ancien mode : toutes les images envoyées d'un coup à la fin
      dir = dir || newSessionDir().dir;
      fs.writeFileSync(path.join(dir, 'frames.json'), JSON.stringify({ frames, startedAt, screens: shared || [] }));
    }
    if (!dir) return res.status(400).json({ error: 'Enregistrement introuvable.' });
    const out = await analyzeSessionDir(dir, { textOnly: !!textOnly });
    // enregistrement d'ajout : on dit à l'écran à quelle tâche les étapes ont été ajoutées
    const cible = lireJson(path.join(dir, 'session.json'))?.ajouterA;
    let ajout = null;
    if (cible) {
      const cibleDir = path.join(SESSIONS_DIR, path.basename(cible));
      const an = lireJson(path.join(cibleDir, 'analysis.json'));
      ajout = {
        cible: path.basename(cible),
        titre: infoEnregistrement(cibleDir, path.basename(cible)).titre,
        etapes_ajoutees: (out?.workflows || []).flatMap((w) => w.steps || []).length,
        etapes_total: (an?.result?.workflows?.[0]?.steps || []).length,
      };
    }
    res.json({ ...out, ajout, _discovery: startDiscovery(dir) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    setPhase('idle');
  }
});

// Relance l'analyse du dernier enregistrement : avec ses images si elles ont été gardées, sinon avec son texte OCR seul.

// --- Découverte de la tâche + environnement de test interne (côté serveur uniquement) -------------------------
// À la fin de l'analyse, un worker Python (discovery/) envoie la tâche dans Supabase, construit un JUMEAU interne,
// le teste avec Holo, puis pose UNE question à l'employé : « Ai-je bien compris votre problème ? ».
// Le jumeau, les essais et la casse ne sont jamais montrés sur la page. Toujours active : seule l'absence des clés
// (Supabase, Holo) la saute, et la page affiche alors directement les étapes, comme avant.
let discovery = { dir: null, proc: null };
const discoveryState = (dir) => {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'discovery.json'), 'utf8')); } catch { return null; }
};
function runDiscovery(cmd, dir) {
  // Worker détaché, journal dans <session>/discovery.log : un redémarrage du serveur ne l'interrompt pas.
  const log = fs.openSync(path.join(dir, 'discovery.log'), 'a');
  const proc = spawn(PYTHON, ['-u', '-m', 'discovery.discovery', cmd, dir],
                     // Windows : pas « detached » (sinon une console s'ouvre malgré windowsHide) ; le journal en fichier suffit
                     // à ce que le worker survive à un redémarrage du serveur.
                     { cwd: REPO_ROOT, env: { ...process.env, PYTHONUTF8: '1' }, detached: !IS_WIN, stdio: ['ignore', log, log] });
  proc.on('error', (e) => console.warn('[découverte] impossible de lancer le worker :', e.message));
  proc.on('close', (code) => { console.log(`[découverte] ${cmd} terminé (code ${code})`); if (discovery.proc === proc) discovery.proc = null; });
  proc.unref();
  console.log(`[découverte] ${cmd} lancé (journal : ${path.join(dir, 'discovery.log')})`);
  discovery = { dir, proc };
}
// Un worker tourne-t-il encore pour ce dossier ? (survit aux redémarrages du serveur : on lit l'état écrit par le worker)
const workerBusy = (st) => !!st && (['upload', 'cadrage', 'answered', 'casse'].includes(st.phase)
  || (st.phase === 'awaiting_confirmation' && st.work !== 'ready'))
  && Date.now() - Date.parse(st.updated_at || 0) < 15 * 60 * 1000;
function startDiscovery(dir) {
  // Interrupteur TEMPORAIRE, pendant la phase de test seulement (À SUPPRIMER pour le rendu final) : DISCOVERY=off
  if ((process.env.DISCOVERY || 'on') === 'off') return false;
  const missing = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', ...(RELAIS ? [] : ['SUPABASE_EMAIL', 'SUPABASE_PASSWORD']), 'HAI_API_KEY'].filter((k) => !process.env[k]);
  if (missing.length) { console.warn(`[découverte] désactivée, variables manquantes : ${missing.join(', ')}`); return false; }
  const st = discoveryState(dir);
  if (workerBusy(st)) { console.log(`[découverte] déjà en cours pour ${path.basename(dir)} (${st.phase})`); discovery.dir = dir; return true; }
  try { fs.rmSync(path.join(dir, 'discovery.json'), { force: true }); } catch {}
  runDiscovery('discover', dir);
  return true;
}
// Au démarrage : si une découverte tourne encore (serveur relancé pendant la casse), on la reprend pour la page.
setTimeout(() => { try { const d = latestSessionDir(); if (d && workerBusy(discoveryState(d))) discovery.dir = d; } catch { /* rien */ } }, 0);
// La page ne reçoit que l'avancement et la question, jamais le détail interne.
app.get('/api/discovery', (req, res) => {
  const dir = discovery.dir; // seulement la découverte lancée depuis ce serveur (jamais un ancien résultat)
  const st = dir ? discoveryState(dir) : null;
  if (!st) return res.json({ phase: 'idle' });
  res.json({ phase: st.phase, question: st.phase === 'awaiting_confirmation' ? st.question : null,
             progress: st.phase === 'casse' ? st.progress || null : null,
             solution: st.phase === 'done' ? st.solution || null : null });
});
app.post('/api/discovery/answer', (req, res) => {
  const dir = discovery.dir || latestSessionDir();
  const st = dir ? discoveryState(dir) : null;
  if (!st || st.phase !== 'awaiting_confirmation') return res.status(409).json({ error: 'Aucune question en attente.' });
  st.answer = { ok: !!req.body?.ok, correction: String(req.body?.correction || '').slice(0, 2000) };
  st.phase = 'answered';
  fs.writeFileSync(path.join(dir, 'discovery.json'), JSON.stringify(st, null, 1));
  // Jumeau encore en construction : le worker lira la réponse à la fin. Sinon on lance la suite tout de suite.
  if (st.work === 'ready') runDiscovery('answer', dir);
  res.json({ ok: true });
});
// Détail interne (équipe Twiin seulement, non relié à la page) : jumeau, test dev, casse.
app.get('/api/discovery/internal', (req, res) => {
  const dir = discovery.dir || latestSessionDir();
  res.json(dir ? discoveryState(dir) || {} : {});
});

app.post('/api/reanalyze', async (req, res) => {
  try {
    const hasFrames = (d) => ['frames.jsonl', 'frames.json'].some((f) => fs.existsSync(path.join(SESSIONS_DIR, d, f)));
    let dirs = fs.existsSync(SESSIONS_DIR) ? fs.readdirSync(SESSIONS_DIR).filter(hasFrames).sort() : [];
    const wanted = String(req.body?.session || '').split('#')[0].replace(/[^0-9A-Za-z-]/g, '');
    if (wanted && dirs.includes(wanted)) dirs = [...dirs.filter((d) => d !== wanted), wanted]; // « Réanalyser » une tâche précise
    else if (wanted) return res.status(404).json({ error: 'Cet enregistrement n\'est plus sur ce poste (images supprimées).' });
    if (dirs.length) {
      if (recorderSession?.proc && recorderSession.id === dirs.at(-1)) recorderSession.proc.kill('SIGTERM');
      console.log(`Relance sur ${dirs.at(-1)}`);
      const result = await analyzeSessionDir(path.join(SESSIONS_DIR, dirs.at(-1)));
      return res.json({ ...result, _discovery: startDiscovery(path.join(SESSIONS_DIR, dirs.at(-1))) });
    }
    if (!fs.existsSync(LAST_RUN_PATH)) return res.status(404).json({ error: 'Aucun enregistrement à relancer.' });
    const last = JSON.parse(fs.readFileSync(LAST_RUN_PATH, 'utf8'));
    console.log('Relance sur le texte OCR du dernier enregistrement (images non gardées)');
    res.json(await analyze({ frames: Array.from({ length: last.meta?.images_kept || 0 }), transcript: last.ocr_transcript,
                             actionLog: last.action_log || '', ocrLines: last.meta?.ocr_lines || 0,
                             screens: last.meta?.screens || 1, textOnly: true, session: last.meta?.session || null }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    setPhase('idle');
  }
});

// --- Améliorer un workflow (fiabilité pour Holo + process optimisé), modifiable avant le rejeu ---------------
const IMPROVE_PROMPT = `You improve a recorded computer workflow before an AI agent (Holo, a computer-use agent that sees the
screen and uses mouse and keyboard on the employee's computer, Mac or Windows, possibly with several monitors) replays it. Improve it in TWO ways:

1. RELIABILITY for the agent:
   - group the steps by application and goal (typically 3 to 6 steps); each step must be self-contained;
   - be explicit about the UI: which app, which tab or page, which cell or field, click before typing, and the keys
     that move between fields (e.g. in a OneNote page the cursor starts in the TITLE: type the title, then press Enter
     to reach the body before pasting);
   - keep every EXACT value (names, numbers, dates, cells, page titles, URLs) from the original steps, the action
     log and the OCR text; never invent a value. When a value the agent needs is NOT known (e.g. text the user typed
     that is not visible in the OCR, an unknown date), write « ⚠️ À compléter : <what is missing> » in the step instead
     of a vague instruction like « type the notes » or « type a date »;
   - add a short check at the end of a step when a mistake is easy (e.g. « check the title contains only X »);
   - safety: never send, publish, delete, follow, connect, pay or submit anything; never modify other cells, pages
     or files than the ones the task writes to.
2. PROCESS optimisation:
   - remove useless or duplicated actions (e.g. reading a page twice, opening something not used afterwards);
   - use shorter paths when they are visible in the OCR or action log (e.g. a direct URL instead of searching);
   - do NOT change what the task produces (same data, same destination).

Return ONLY a JSON object, no prose, no markdown fences. Inside string values never use straight double quotes
(use « » instead). Shape:
{"name":"short French title, 2 to 5 words, no app or tool names","summary":"one sentence","steps":["step 1","step 2"],
 "changes":[{"kind":"fiabilité|process","what":"what changed, in French, one sentence"}]}
Write the steps in English (the agent works best in English) and the "changes" in French.`;

// Dernier workflow analysé (affiché au chargement de la page, pour l'améliorer ou le rejouer sans réenregistrer)
app.get('/api/candidates', async (req, res) => {
  if (sbUser() && !SB_SERVICE) { // connecté : SES dernières tâches analysées
    const me = sbUser()?.id;
    const rows = await sb(`taches?select=*&source=eq.analyse&recorded_by=eq.${me}&order=created_at.desc&limit=20`);
    return res.json({ workflows: (rows || []).map((t) => ({ task_id: t.id, name: t.title, summary: t.summary, why_daily: t.why,
      created_at: t.created_at, status: t.status, has_images: fs.existsSync(path.join(SESSIONS_DIR, String(t.source_session_id || '').split('#')[0])),
      steps: (t.steps || []).map((x) => (typeof x === 'string' ? x : x.instruction || '')),
      session: String(t.source_session_id || '').split('#')[0] })) });
  }
  res.json(fs.existsSync(CANDIDATES_PATH) ? JSON.parse(fs.readFileSync(CANDIDATES_PATH, 'utf8')) : { workflows: [] });
});

app.post('/api/improve', async (req, res) => {
  try {
    const wf = req.body?.workflow;
    if (!wf?.steps?.length) return res.status(400).json({ error: 'workflow vide' });
    const last = fs.existsSync(LAST_RUN_PATH) ? JSON.parse(fs.readFileSync(LAST_RUN_PATH, 'utf8')) : {};
    const user = [
      `ORIGINAL WORKFLOW\nName: ${wf.name || ''}\nSummary: ${wf.summary || ''}\nSteps:\n` +
        wf.steps.map((st, i) => `${i + 1}. ${st}`).join('\n'),
      `ACTION LOG of the recording (exact order, screens, apps, clicked elements):\n${(last.action_log || '(none)').slice(0, 12000)}`,
      `OCR TEXT of the recording (exact values):\n${(last.ocr_transcript || '(none)').slice(0, 12000)}`,
    ].join('\n\n');
    const { data: resp } = await client.chat.completions.create({
      model: HF_MODEL, max_tokens: MAX_OUTPUT_TOKENS, temperature: 0, reasoning_effort: REASONING_EFFORT,
      messages: [{ role: 'system', content: IMPROVE_PROMPT }, { role: 'user', content: user }],
    }).withResponse();
    const raw = resp.choices?.[0]?.message?.content || '';
    if (!raw.trim()) throw new Error('Réponse vide du modèle : réessaie.');
    const { result } = parseWorkflows(raw);
    if (!Array.isArray(result.steps) || !result.steps.length) throw new Error('Le modèle n\'a pas renvoyé d\'étapes.');
    console.log(`Amélioration : ${wf.steps.length} → ${result.steps.length} étapes, ${result.changes?.length ?? 0} changement(s), ≈ ${(resp.usage?.cost ?? 0).toFixed(4)} $`);
    res.json({ workflow: { name: result.name || wf.name, summary: result.summary || wf.summary, steps: result.steps },
               changes: result.changes || [], cost_usd: resp.usage?.cost ?? null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- 💡 Améliorer mon process : bilan chiffré + recommandations POUR L'EMPLOYÉ (ne touche pas aux étapes) -------
// L'enregistrement d'une tâche : celui noté dans la tâche ; à défaut (anciennes tâches), le dernier enregistrement.
// Tuto d'une tâche complétée par des ajouts : on rassemble les images et le journal de l'enregistrement d'origine
// et de ses ajouts, sur une même ligne de temps (le temps de chaque ajout est décalé de son départ).
function sessionAvecAjouts(dir) {
  const an = lireJson(path.join(dir, 'analysis.json'));
  const segs = (an?.segments || []).map((s) => path.join(SESSIONS_DIR, path.basename(s.id))).filter((d) => fs.existsSync(d));
  if (!segs.length) return dir;
  const lignes = (d, f) => (fs.existsSync(path.join(d, f)) ? fs.readFileSync(path.join(d, f), 'utf8').split('\n').filter(Boolean) : []);
  const depart = lireJson(path.join(dir, 'session.json'))?.startedAt || 0;
  let frames = lignes(dir, 'frames.jsonl').map((l) => JSON.parse(l));
  let actions = lignes(dir, 'actions.jsonl').map((l) => JSON.parse(l));
  // chaque ajout se place à la suite de ce qui précède (pas de vide entre les deux, même si l'ajout a été fait plus tard)
  for (const sd of segs) {
    const debutSeg = (lireJson(path.join(sd, 'session.json'))?.startedAt || depart) / 1000;
    const base = frames.reduce((m, f) => Math.max(m, f.seconds || 0), 0) + 2;
    frames = frames.concat(lignes(sd, 'frames.jsonl').map((l) => { const f = JSON.parse(l); return { ...f, seconds: base + (f.seconds || 0) }; }));
    actions = actions.concat(lignes(sd, 'actions.jsonl').map((l) => { const a = JSON.parse(l); return a.ts ? { ...a, ts: depart / 1000 + base + (a.ts - debutSeg) } : a; }));
  }
  frames.sort((a, b) => (a.seconds || 0) - (b.seconds || 0));
  frames = frames.map((f, i) => ({ ...f, index: i }));
  actions.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const out = path.join(REPO_ROOT, 'workflows', 'tuto-sessions', path.basename(dir));
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'frames.jsonl'), frames.map((f) => JSON.stringify(f)).join('\n') + '\n');
  fs.writeFileSync(path.join(out, 'actions.jsonl'), actions.map((a) => JSON.stringify(a)).join('\n') + '\n');
  fs.writeFileSync(path.join(out, 'session.json'), JSON.stringify({ startedAt: depart }));
  return out;
}
function sessionDirFor(wf) {
  if (wf?.session) {
    const id = String(wf.session);
    if (!/^[0-9A-Za-z-]+$/.test(id)) return null; // jamais « .. », « . » ni un chemin : on reste dans un dossier de session
    const dir = path.join(SESSIONS_DIR, id);
    return fs.existsSync(dir) ? dir : null; // enregistrement absent (autre Mac) : pas de mesures plutôt que de fausses
  }
  return latestSessionDir();
}
function taskContext(wf) {
  const dir = sessionDirFor(wf);
  const allEvents = dir ? readActions(dir) : [];
  const excluded = excludedApps(dir, allEvents);       // applis ouvertes par erreur : choix de l'employé, sinon suggestions automatiques
  const events = filterEvents(allEvents, excluded);
  const last = fs.existsSync(LAST_RUN_PATH) ? JSON.parse(fs.readFileSync(LAST_RUN_PATH, 'utf8')) : {};
  const same = dir && last.meta?.session === path.basename(dir);
  // le journal gardé à la dernière analyse ne tient pas compte d'un choix fait depuis : avec des applis exclues, on le refait
  let actionLog = same && !excluded.length ? last.action_log : '';
  if (!actionLog && dir && events.length) { try { actionLog = sessionActionLog(dir, events); } catch { actionLog = ''; } }
  return { dir, allEvents, events, excluded, actionLog: actionLog || '', ocr: same ? last.ocr_transcript || '' : '' };
}

function latestSessionDir() {
  if (!fs.existsSync(SESSIONS_DIR)) return null;
  const hasFrames = (d) => ['frames.jsonl', 'frames.json'].some((f) => fs.existsSync(path.join(SESSIONS_DIR, d, f)));
  const dirs = fs.readdirSync(SESSIONS_DIR).filter(hasFrames).sort();
  return dirs.length ? path.join(SESSIONS_DIR, dirs.at(-1)) : null;
}

// Journal d'actions texte d'une session, sans les applis exclues (même format que celui de l'analyse).
function sessionActionLog(dir, events) {
  const { frames, startedAt, screens } = loadSessionFrames(dir);
  const t0 = startedAt || Date.parse(frames[0]?.timestamp) || (events[0]?.ts || 0) * 1000;
  const voice = mergeVoice(events, readVoiceCache(dir));
  return actionTranscript(voice, t0, screens);
}

// Événements du journal d'une session, sans ceux de la page elle-même.
const sessionEvents = (dir) => readActions(dir).filter((e) => !IS_RECORDER(e));

// Liste des applis vues dans le dernier enregistrement, avec le choix en cours (page : cases « fait partie de la tâche ? »).
// `stale` : le choix a été fait après la dernière analyse, donc les étapes affichées n'en tiennent pas compte.
// ?session=… : l'enregistrement de la tâche affichée (une tâche plus ancienne a ses propres applis) ; sans lui, le dernier.
const appsDir = (id) => (id ? sessionDirFor({ session: id }) : latestSessionDir());
app.get('/api/apps', (req, res) => {
  const dir = appsDir(req.query.session);
  if (!dir) return res.json({ apps: [] });
  const events = sessionEvents(dir);
  const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
  res.json({
    excluded: effectiveExcluded(events, readAppChoice(dir)), apps: appReport(events),
    stale: mtime(path.join(dir, APPS_FILE)) > mtime(CANDIDATES_PATH),
  });
});

app.post('/api/apps', (req, res) => {
  const dir = appsDir(req.body?.session);
  if (!dir) return res.status(404).json({ error: 'Aucun enregistrement.' });
  const seen = new Set(appReport(sessionEvents(dir)).map((a) => a.app));
  const list = Array.isArray(req.body?.excluded) ? req.body.excluded : null;
  if (!list) return res.status(400).json({ error: 'Liste « excluded » manquante.' });
  const excluded = [...new Set(list.map(String).filter((a) => seen.has(a)))];
  fs.writeFileSync(path.join(dir, APPS_FILE), JSON.stringify({ excluded }, null, 2) + '\n');
  res.json({ excluded });
});

// Mesures objectives tirées du journal d'actions : durée, temps par appli, allers-retours, copier-coller, saisies.
function processStats(allEvents, excluded = []) {
  const events = filterEvents(allEvents, excluded);
  const ev = events.filter((e) => e?.type && !['start', 'stop', 'error'].includes(e.type) && !IS_RECORDER(e));
  if (!ev.length) return null;
  const all = allEvents.filter((e) => e?.type && !['start', 'stop', 'error'].includes(e.type) && !IS_RECORDER(e));
  const t0 = all[0].ts, t1 = Math.max(...all.map((e) => e.until || e.ts));
  // temps mesuré sur le journal complet, puis on ôte les applis exclues (voir excludedTime)
  const perApp = { ...timePerApp(all).perApp };
  for (const a of excluded) delete perApp[a];
  let switches = 0, prevApp = null;
  for (const e of ev) {
    if (e.app && prevApp && e.app !== prevApp) switches++;
    if (e.app) prevApp = e.app;
  }
  const count = (f) => ev.filter(f).length;
  return {
    duration_s: Math.round(t1 - t0 - excludedTime(all, excluded)),
    time_per_app_s: Object.fromEntries(Object.entries(perApp).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round(v)])),
    app_switches: switches,
    clicks: count((e) => e.type === 'click'),
    copies: count(isCopy),
    pastes: count(isPaste),
    typing_s: Math.round(ev.filter((e) => e.type === 'typing').reduce((n, e) => n + (e.until - e.ts), 0)),
    keystrokes: ev.filter((e) => e.type === 'typing').reduce((n, e) => n + (e.keys || 0), 0),
  };
}

const ADVICE_PROMPT = `You are a process-improvement coach for office workers. You receive a task the employee really did on
their computer: the recorded steps, objective measures from an action log (duration, time per app, app switches, clicks,
copy-pastes, typing), the timed action log itself and the OCR text of the screens.
Help the EMPLOYEE see where THEIR process can be improved. Be concrete and grounded in what was observed (cite times,
counts, apps); never invent facts. Typical levers: fewer back-and-forths between apps, batching copy-pastes, direct URLs or
bookmarks instead of searching, templates (Excel row, OneNote page), keyboard shortcuts, built-in features (Excel paste
values, data import, LinkedIn export), removing useless steps, and which parts are repetitive enough to delegate to Twiin
(an AI agent that replays the task). Say clearly when a step is already efficient.
WRITING FOR THE EMPLOYEE (not for an engineer): plain, friendly French (tutoiement), short sentences, no jargon
(never « API », « n8n », « webhook », « JSON », « rule-based », « microsoft-graph », « script »). At most 3 recommendations,
the most useful first. headline ≤ 25 words; observed ≤ 20 words; suggestion ≤ 30 words.
Return ONLY a JSON object, no prose, no markdown fences; in string values use « » instead of straight double quotes. French.
Shape: {"headline":"one sentence summary of the main opportunity",
 "recommendations":[{"title":"short","observed":"what was observed, with numbers","suggestion":"what to do instead",
   "gain":"estimated time saved per run, e.g. « ~30 s »","kind":"à faire soi-même|outil existant|à automatiser avec Twiin"}],
 "automation_potential":"one sentence: which part Twiin could take over and why"}`;

app.post('/api/process-advice', async (req, res) => {
  try {
    const wf = req.body?.workflow || {};
    const ctx = taskContext(wf);
    const excluded = ctx.excluded; // applis ouvertes par erreur (choix de l'employé), déjà retirées du journal et des chiffres
    const stats = processStats(ctx.allEvents, excluded);
    const last = { action_log: ctx.actionLog, ocr_transcript: ctx.ocr };
    const actionLog = ctx.actionLog;
    const user = [
      `TASK\nName: ${wf.name || ''}\nSummary: ${wf.summary || ''}\nSteps:\n` + (wf.steps || []).map((st, i) => `${i + 1}. ${st}`).join('\n'),
      `MEASURES (from the action log)\n${stats ? JSON.stringify(stats, null, 1) : '(no action log)'}`,
      `ACTION LOG\n${(actionLog || '(none)').slice(0, 12000)}`,
      excluded.length ? `NOT PART OF THE TASK (opened by mistake, already removed from the measures and the log): ${excluded.join(', ')}` : '',
      `OCR TEXT\n${(last.ocr_transcript || '(none)').slice(0, 8000)}`,
      profileContext(),
    ].filter(Boolean).join('\n\n');
    const { data: resp } = await client.chat.completions.create({
      model: HF_MODEL, max_tokens: MAX_OUTPUT_TOKENS, temperature: 0, reasoning_effort: REASONING_EFFORT,
      messages: [{ role: 'system', content: ADVICE_PROMPT }, { role: 'user', content: user }],
    }).withResponse();
    const raw = resp.choices?.[0]?.message?.content || '';
    if (!raw.trim()) throw new Error('Réponse vide du modèle : réessaie.');
    const { result } = parseWorkflows(raw);
    console.log(`Conseils process : ${result.recommendations?.length ?? 0} recommandation(s), ≈ ${(resp.usage?.cost ?? 0).toFixed(4)} $`);
    backLog('conseils', { model: HF_MODEL, cost_usd: resp.usage?.cost ?? null, recommendations: result.recommendations?.length ?? 0, task: wf.name });
    res.json({ stats, ...result, cost_usd: resp.usage?.cost ?? null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/recommendations', async (req, res) => {
  const { task_id, verdict: v = {}, advice: a = {} } = req.body || {};
  if (!task_id) return res.json({ ok: false, id: null }); // la table d'équipe rattache toujours une recommandation à une tâche
  const kind = /automat/i.test(v.verdict || '') ? 'automate' : 'accelerate';
  const conf = ({ haute: 'high', high: 'high', moyenne: 'medium', medium: 'medium', faible: 'low', basse: 'low', low: 'low' })[
    String(v.confidence || '').toLowerCase()] || null;
  const row = await sb('recommendations', { method: 'POST', prefer: 'return=representation', body: {
    task_id, kind, verdict: v.verdict || null, confidence: conf, reasons: Array.isArray(v.reasons) ? v.reasons.map(String) : [],
    frequency_hint: v.frequency_hint || null, time_saved: v.time_saved || null, plan: v.plan || [],
    advice: { headline: a.headline, recommendations: a.recommendations }, stats: a.stats || null } });
  res.json({ ok: !!row, id: row?.[0]?.id || null });
});

// --- 🧭 Verdict : « accélérer » (tuto) ou « automatiser » (n8n + Holo) — Twiin recommande, l'employé valide ---------
const REGISTRY_PATH = path.join(REPO_ROOT, '..', 'capture', 'backend', 'app', 'known_tools.json'); // registre de l'audit Twiin
function loadRegistry() {
  try { return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8')).tools || []; } catch { return []; }
}

// Applis et sites utilisés pendant l'enregistrement, classés avec le registre : API (n8n) ou pas d'API (Holo).
function toolsUsed(events, ocrText) {
  const reg = loadRegistry();
  const apps = [...new Set(events.filter((e) => e.app && !IS_RECORDER(e)).map((e) => e.app))]
    .filter((a) => !/^(Code|Finder|Dock|Window Server)$/i.test(a));
  // seulement les adresses vues dans une vraie URL (avec un chemin) : pas les favoris ni les mentions dans un texte
  const hosts = [...new Set([...(ocrText || '').toLowerCase().matchAll(/\b((?:[a-z0-9-]+\.)+(?:com|fr|io|ai|net|org|so|app))\/[a-z0-9_\-]/g)].map((m) => m[1]))]
    .filter((h) => !/localhost|hcompany|huggingface/.test(h)).slice(0, 15);
  const matchApp = (name) => reg.find((t) => (t.apps || []).some((a) => !a.endsWith('.') && a.toLowerCase() === name.toLowerCase()));
  const matchHost = (h) => reg.find((t) => (t.domains || []).some((d) => h === d || h.endsWith('.' + d)));
  const out = [];
  for (const a of apps) {
    const t = matchApp(a);
    out.push({ name: a, kind: 'appli', known: !!t, api: !!t?.api, tool: t?.name || null, connector: t?.connector || null });
  }
  for (const h of hosts) {
    const t = matchHost(h);
    if (out.some((o) => o.tool && t && o.tool === t.name)) continue;
    out.push({ name: h, kind: 'site', known: !!t, api: !!t?.api, tool: t?.name || null, connector: t?.connector || null });
  }
  return out;
}

const VERDICT_PROMPT = `You decide what Twiin should propose for a task an employee recorded on their computer:
- "accélérer": the task is short, rare, needs human judgment, or automating it would cost more than it saves → Twiin
  will make a VIDEO TUTORIAL showing the improved manual process;
- "automatiser": the task is repetitive, rule-based, frequent enough and the value is in doing it unattended → Twiin
  will build an n8n automation: n8n nodes for the tools that have an API, and a Holo agent (computer-use AI that works
  on screen) for the tools WITHOUT an API.
You receive the steps, measures from the action log and the list of tools used, each marked with/without API (from
Twiin's tool registry). Be concrete, cite the measures. French. Never invent facts.
The "reasons", "frequency_hint", "time_saved" and "plan[].what" fields are SHOWN TO THE EMPLOYEE: plain, friendly French
(tutoiement), no jargon (never « API », « n8n », « webhook », « rule-based », « microsoft-graph », « connecteur »): say
« Twiin s'en charge » or « Twiin remplit ton fichier Excel » instead. At most 3 reasons, each ≤ 20 words; frequency_hint
and time_saved ≤ 15 words each; plan[].what ≤ 15 words. The "how" field stays technical (API n8n|Holo|manuel): it is not shown.
Return ONLY a JSON object, no prose, no fences, using « » instead of straight double quotes inside strings:
{"verdict":"accélérer|automatiser","confidence":"élevée|moyenne|faible","reasons":["…","…"],
 "frequency_hint":"how often such a task is probably done, and that the employee should confirm",
 "time_saved":"estimated time saved per run or per month",
 "plan":[{"tool":"name","how":"API n8n|Holo|manuel","what":"what this tool does in the automated or improved version"}]}`;

app.post('/api/verdict', async (req, res) => {
  try {
    const wf = req.body?.workflow || {};
    const ctx = taskContext(wf);
    const excluded = ctx.excluded;
    const stats = processStats(ctx.allEvents, excluded);
    const tools = toolsUsed(ctx.events, ctx.ocr);
    const user = [
      `TASK\nName: ${wf.name || ''}\nSteps:\n` + (wf.steps || []).map((st, i) => `${i + 1}. ${st}`).join('\n'),
      `MEASURES\n${stats ? JSON.stringify(stats) : '(no action log)'}`,
      `TOOLS USED (from Twiin registry)\n${tools.map((t) => `- ${t.name} (${t.kind}) : ${t.known ? `${t.tool}, ${t.api ? `API (${t.connector})` : 'pas d\'API'}` : 'inconnu du registre, pas d\'API connue'}`).join('\n') || '(none)'}`,
      profileContext(),
    ].filter(Boolean).join('\n\n');
    const { data: resp } = await client.chat.completions.create({
      model: HF_MODEL, max_tokens: MAX_OUTPUT_TOKENS, temperature: 0, reasoning_effort: REASONING_EFFORT,
      messages: [{ role: 'system', content: VERDICT_PROMPT }, { role: 'user', content: user }],
    }).withResponse();
    const raw = resp.choices?.[0]?.message?.content || '';
    if (!raw.trim()) throw new Error('Réponse vide du modèle : réessaie.');
    const { result } = parseWorkflows(raw);
    console.log(`Verdict : ${result.verdict} (${result.confidence}), ≈ ${(resp.usage?.cost ?? 0).toFixed(4)} $`);
    backLog('recommandation', { model: HF_MODEL, cost_usd: resp.usage?.cost ?? null, verdict: result.verdict, confidence: result.confidence,
                                tools: tools.map((t) => `${t.name}${t.api ? ' (API)' : ''}`), task: wf.name });
    res.json({ ...result, tools, stats, cost_usd: resp.usage?.cost ?? null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- ⚡ Créer l'automatisation n8n : plan (modèle) → compilation → import dans n8n → test une fois -------------------
const N8N_PLANS = path.join(REPO_ROOT, 'automation', 'plans');
const N8N_GEN = path.join(REPO_ROOT, 'automation', 'n8n_twiin.py');
let n8nRun = null; // { proc, events, running }

const PLAN_PROMPT = `You design an n8n automation for a task an employee recorded. Tools WITH an API are handled by normal
n8n nodes; tools WITHOUT an API (LinkedIn pages, OneNote, internal software such as comptarex) are handled by a Holo block
(a computer-use agent that works on the employee's computer, Mac or Windows). Use ONLY these block types, in order:
- {"type":"holo","name":"Holo — <verb> <tool>","env":"cloud|mac","steps":["one precise instruction in English"],"expect":{"key":"what to read"}}
   "env": "cloud" for a public website reachable on the internet (Holo uses H's own cloud browser: the employee keeps using
   their computer); "mac" for an installed desktop app (OneNote, Excel desktop…), a local site (127.0.0.1) or a page that
   needs the employee's logged-in session. In cloud steps, give the full https:// address and never mention Chrome.
   Holo reads or does things on screen; with "expect" it returns the values it READ as data.<key>. Ask it to copy values
   EXACTLY as written. Reference values from a previous Holo block in later steps or fields as {{<block name>.<key>}}.
- {"type":"row","name":"Préparer la ligne","fields":{"<Column>":"text with {{<block name>.<key>}}, {{today}}, {{execution}}"}}
- {"type":"verify","name":"Vérifier les valeurs","rules":{"<Column>":{"required":true,"pattern":"regex","forbid":["…"]}}}
   ALWAYS add a verify block before writing data, with format rules for every important value.
- {"type":"sheets_append","name":"Ajouter la ligne (Google Sheets)","sheet":"veille|factures","columns":[…]}
- {"type":"http","name":"…","method":"GET","url":"…","auth":"comptarex"}
AVAILABLE RESOURCES:
- Google Sheet "veille" columns: Entreprise, Secteur, Siège, Taille, Abonnés, Date, Source, Exécution n8n, Vérification
- Google Sheet "factures" columns: Facture, Fournisseur, Numéro, Date, Total HT, TVA, Total TTC, Statut comptarex, Vérification, Exécution n8n
- comptarex (fake accounting software, http://127.0.0.1:8042, NO public API for entering invoices → Holo), but a read-only
  admin API GET http://127.0.0.1:8042/api/invoices (auth "comptarex") lists saved invoices for checking.
SAFETY: never send, publish, pay, validate, delete, follow or message anything; in accounting software always stop at
« Enregistrer le brouillon ». Only write to the resources above or to new pages.
Return ONLY JSON, no fences: {"name":"short French title, 2 to 5 words, no tool names, keep the subject (e.g. Veille concurrence L'Oréal)","schedule_cron":"cron or null","blocks":[…]}.
Use « » instead of straight double quotes inside strings. Example of a good plan:
`;

// n8n tourne sur le Mac de l'employé, et c'est Twiin qui le démarre au besoin : l'employé n'a rien à lancer.
const N8N_URL = process.env.N8N_LOCAL_URL || 'http://localhost:5678';
const N8N_START = path.join(REPO_ROOT, 'automation', 'n8n-runtime', 'start.sh');
async function n8nUp() {
  try { return (await fetch(`${N8N_URL}/healthz`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; }
}
async function ensureN8n() {
  if (await n8nUp()) return;
  console.log('n8n arrêté : Twiin le démarre…');
  const logFd = fs.openSync(path.join(WORKFLOWS_DIR, 'n8n.log'), 'a');
  const opts = { cwd: path.dirname(N8N_START), detached: true, stdio: ['ignore', logFd, logFd] };
  if (!IS_WIN && fs.existsSync(path.join(REPO_ROOT, 'automation', 'n8n-runtime', 'node_modules', '.bin', 'n8n'))) {
    spawn('bash', [N8N_START], opts).unref();             // Mac : n8n isolé du projet (Node 24 copié)
  } else {
    // Windows (ou n8n isolé absent) : n8n installé globalement, sinon la version fixée via npx
    spawn(IS_WIN ? 'cmd.exe' : 'sh', IS_WIN ? ['/c', 'n8n start || npx -y n8n@2.48.5 start'] : ['-c', 'n8n start || npx -y n8n@2.48.5 start'],
          { ...opts, env: { ...process.env, N8N_SECURE_COOKIE: 'false' } }).unref();
  }
  for (let i = 0; i < 60; i++) { // n8n met 10 à 30 s à démarrer
    await new Promise((r) => setTimeout(r, 1500));
    if (await n8nUp()) return console.log('n8n démarré.');
  }
  throw new Error('n8n ne démarre pas : voir twiin/workflows/n8n.log');
}
app.get('/api/n8n/status', async (req, res) => res.json({ up: await n8nUp(), url: N8N_URL }));
app.post('/api/n8n/start', async (req, res) => {
  try { await ensureN8n(); res.json({ up: true }); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/n8n/create', async (req, res) => {
  try {
    if (n8nRun?.running) return res.status(409).json({ error: 'Une automatisation est déjà en cours de création.' });
    if (replay?.running) return res.status(409).json({ error: 'Holo est occupé par un rejeu.' });
    if (!req.body?.dryRun) await ensureN8n();
    const wf = req.body?.workflow || {};
    const example = fs.readFileSync(path.join(N8N_PLANS, 'veille-loreal.json'), 'utf8');
    const user = `TASK\nName: ${wf.name || ''}\nSummary: ${wf.summary || ''}\nSteps:\n` +
      (wf.steps || []).map((x, i) => `${i + 1}. ${x}`).join('\n') +
      (req.body?.verdict ? `\n\nTWIIN ANALYSIS\n${JSON.stringify(req.body.verdict).slice(0, 3000)}` : '');
    const { data: resp } = await client.chat.completions.create({
      model: HF_MODEL, max_tokens: MAX_OUTPUT_TOKENS, temperature: 0, reasoning_effort: REASONING_EFFORT,
      messages: [{ role: 'system', content: PLAN_PROMPT + example }, { role: 'user', content: user }],
    }).withResponse();
    const raw = resp.choices?.[0]?.message?.content || '';
    const { result: plan } = parseWorkflows(raw);
    if (!Array.isArray(plan.blocks) || !plan.blocks.length) throw new Error('Plan vide : réessaie.');
    const known = ['holo', 'row', 'verify', 'sheets_append', 'http'];
    const bad = plan.blocks.filter((b) => !known.includes(b.type));
    if (bad.length) throw new Error(`Bloc inconnu dans le plan : ${bad.map((b) => b.type).join(', ')}`);
    plan.id = ('twiin' + slugify(plan.name || wf.name).replace(/-/g, '')).slice(0, 16);
    if (req.body?.dryRun) return res.json({ plan, cost_usd: resp.usage?.cost ?? null }); // plan seulement (tests)
    fs.mkdirSync(N8N_PLANS, { recursive: true });
    const planFile = path.join(N8N_PLANS, `${slugify(plan.name || wf.name)}.json`);
    fs.writeFileSync(planFile, JSON.stringify(plan, null, 2));
    const events = path.join(REPO_ROOT, 'workflows', 'runs', `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-n8n-create.jsonl`);
    fs.mkdirSync(path.dirname(events), { recursive: true });
    fs.writeFileSync(events, JSON.stringify({ type: 'plan', plan, cost_usd: resp.usage?.cost ?? null }) + '\n');
    const proc = spawn(PYTHON, ['-u', N8N_GEN, planFile, '--events', events], { cwd: REPO_ROOT });
    let genErr = '';
    proc.stderr.on('data', (d) => { genErr += d; process.stderr.write(`[n8n] ${d}`); });
    // Si la création échoue avant la fin (ex. connexion Google Sheets absente), la page reçoit l'erreur au lieu d'attendre.
    proc.on('close', () => {
      const evs0 = readJsonl(events);
      if (evs0.some((e) => e.type === 'imported')) forgetFailed(plan.id);
      else rememberFailed({ id: plan.id, name: plan.name || wf.name, planFile, blocks: plan.blocks,
                            error: (genErr.trim().split(/\r?\n/).filter(Boolean).at(-1) || 'création interrompue').replace(/^\[n8n\]\s*/, '') });
      if (!evs0.some((e) => e.type === 'done')) {
        const why = genErr.trim().split(/\r?\n/).filter(Boolean).at(-1) || 'création interrompue';
        fs.appendFileSync(events, JSON.stringify({ type: 'done', ok: false, status: why.replace(/^\[n8n\]\s*/, '').slice(0, 300) }) + String.fromCharCode(10));
      }
    });
    n8nRun = { proc, events, running: true };
    proc.on('close', keepUser(async () => {
      n8nRun.running = false;
      spawnMac(['-e', 'tell application "Google Chrome" to activate']);
      const evs = readJsonl(events);
      const imported = evs.find((e) => e.type === 'imported');
      if (imported) await sb('automations?on_conflict=user_id,n8n_id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
        body: { task_id: wf.task_id || null, n8n_id: imported.id, name: plan.name || wf.name, blocks: plan.blocks, freq: 'manual', active: false } });
      if (imported) modeleDe(imported.id).catch((e) => console.warn(`Personnalisation ${imported.id} : ${e.message}`)); // rubrique prête à l'ouverture
    }));
    console.log(`Automatisation n8n : ${plan.name} (${plan.blocks.length} blocs)`);
    res.json({ plan, file: path.basename(planFile) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/n8n/events', (req, res) => {
  if (!n8nRun) return res.json({ events: [], next: 0, running: false });
  const since = parseInt(req.query.since || '0', 10);
  const all = fs.readFileSync(n8nRun.events, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  // pendant un nœud Holo, on relaie aussi les étapes de Holo (pont n8n → Holo)
  let holo = [];
  if (replay?.events && fs.existsSync(replay.events)) {
    holo = fs.readFileSync(replay.events, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
      .filter((e) => ['step_start', 'step_end', 'stalled', 'restart'].includes(e.type)).slice(-3);
  }
  res.json({ events: all.slice(since), next: all.length, running: n8nRun.running, holo, holoRunning: !!replay?.running, holoEnv: replay?.env || 'mac' });
});

// --- Rejouer un workflow sur ce Mac avec Holo (scripts/run_live.py), suivi en direct par la page ----------------
const SKILLS_PATH = path.join(REPO_ROOT, 'workflows', 'skills.json');
const RUN_LIVE = path.join(REPO_ROOT, 'scripts', 'run_live.py');
let replay = null; // { proc, events, id, running }

const slugify = (n) => (n || 'workflow').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'workflow';

function saveSkill(wf) {
  const all = fs.existsSync(SKILLS_PATH) ? JSON.parse(fs.readFileSync(SKILLS_PATH, 'utf8')) : [];
  const id = slugify(wf.name);
  const entry = { id, name: wf.name || id, description: wf.summary || '', steps: wf.steps };
  const i = all.findIndex((x) => x.id === id);
  if (i >= 0) all[i] = entry; else all.push(entry);
  all.sort((a, b) => a.id.localeCompare(b.id));
  fs.writeFileSync(SKILLS_PATH, JSON.stringify(all, null, 2) + '\n');
  return id;
}

app.post('/api/replay', (req, res) => {
  try {
    if (replay?.running) return res.status(409).json({ error: 'Un rejeu est déjà en cours.' });
    const wf = req.body?.workflow;
    const steps = (wf?.steps || []).map((x) => String(x).trim()).filter(Boolean);
    if (!steps.length) return res.status(400).json({ error: 'Aucune étape à rejouer.' });
    const todo = steps.map((x, i) => (/à compléter/i.test(x) ? i + 1 : null)).filter(Boolean);
    if (todo.length) return res.status(400).json({ error: `Complète d'abord les étapes ${todo.join(', ')} (« ⚠️ À compléter »).` });
    const id = saveSkill({ ...wf, steps });
    const dir = path.join(REPO_ROOT, 'workflows', 'runs');
    fs.mkdirSync(dir, { recursive: true });
    const events = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-events.jsonl`);
    fs.writeFileSync(events, '');
    // VS Code masqué pendant le rejeu (Holo ne doit pas lire la conversation ni s'y perdre)
    spawnMac( ['-e', 'tell application "System Events" to set visible of process "Code" to false']);
    const proc = spawn(PYTHON, ['-u', RUN_LIVE, id, '--no-open', '--events', events], { cwd: REPO_ROOT });
    proc.stdout.on('data', (d) => process.stdout.write(`[rejeu] ${d}`));
    proc.stderr.on('data', (d) => process.stderr.write(`[rejeu] ${d}`));
    replay = { proc, events, id, running: true };
    proc.on('close', (code) => {
      replay.running = false;
      console.log(`Rejeu terminé (code ${code})`);
      spawnMac( ['-e', 'tell application "Google Chrome" to activate']); // retour sur la page ImproveMe
    });
    console.log(`Rejeu lancé : ${id} (${steps.length} étape(s))`);
    res.json({ id, steps: steps.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Où Holo travaille pour un bloc : « cloud » = navigateur hébergé chez H (l'employé garde son Mac), « mac » = ce Mac.
// Un logiciel installé ou un site local (127.0.0.1, comptarex) ne sont pas joignables depuis le cloud : ils restent sur le Mac.
const HOLO_DESKTOP = /\b(onenote|excel|word|powerpoint|outlook|keynote|numbers|pages|finder|comptarex|desktop app|application de bureau|logiciel install)/i;
const HOLO_LOCAL = /(localhost|127\.0\.0\.1|0\.0\.0\.0|\.local\b)/i;
const HOLO_WEB = /(https?:\/\/|www\.|\.com\b|\.fr\b|linkedin|website|web page|site web|portail|portal)/i;
function holoEnv(steps, asked) {
  const text = steps.join(' ');
  if (HOLO_LOCAL.test(text) || HOLO_DESKTOP.test(text)) return 'mac'; // même si on demande le cloud : il ne pourrait pas
  if (asked === 'mac' || asked === 'cloud') return asked;
  return HOLO_WEB.test(text) ? 'cloud' : 'mac';
}

// --- Pont n8n → Holo : n8n envoie des étapes, Holo les fait (cloud ou Mac), la réponse revient à n8n -------------
// Appel SYNCHRONE (n8n attend la fin). Réservé aux appels locaux portant le jeton TWIIN_LOCAL_TOKEN.
// --- Ponts n8n → Twiin « sans gêner l'employé » ------------------------------------------------------------------
// /api/holo/web : Holo lit une page web dans un navigateur INVISIBLE (la souris et le clavier restent à l'employé).
// /api/excel/write : ajoute des lignes dans un classeur Excel du poste, par le fichier, sans Holo.
const localBridge = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
  && process.env.TWIIN_LOCAL_TOKEN && req.get('x-twiin-token') === process.env.TWIIN_LOCAL_TOKEN;
const webRuns = new Set(); // lectures en cours (arrêtées par « Arrêter l'automatisation »)
function runPyJson(mod, input, { timeout = 600000, track } = {}) {
  return new Promise((resolve) => {
    const proc = spawn(PYTHON, ['-u', '-m', mod], { cwd: REPO_ROOT, env: { ...process.env, PYTHONUTF8: '1' } });
    track?.add(proc);
    let out = '', err = '';
    const timer = setTimeout(() => killTree(proc), timeout);
    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (err += d));
    proc.on('close', () => {
      clearTimeout(timer);
      track?.delete(proc);
      const line = out.trim().split('\n').filter((l) => l.startsWith('{')).at(-1);
      try { resolve(JSON.parse(line)); } catch { resolve({ ok: false, error: (err.trim().split('\n').at(-1) || 'échec').slice(0, 300) }); }
    });
    proc.stdin.end(JSON.stringify(input));
  });
}
app.post('/api/holo/web', async (req, res) => {
  if (!localBridge(req)) return res.status(403).json({ error: 'Accès refusé (appel local avec jeton Twiin uniquement).' });
  const { url, label, columns } = req.body || {};
  console.log(`n8n → Holo (navigateur invisible) : ${label || url}`);
  const r = await runPyJson('discovery.web_read', { url, label, columns }, { track: webRuns });
  console.log(`   → ${r.ok ? 'lu' : 'échec'} en ${Math.round(r.seconds || 0)} s : ${JSON.stringify(r.data || r.error).slice(0, 160)}`);
  res.json(r);
});
// /api/source/read : lit le document à saisir (PDF…) le plus récent d'un dossier du poste, sans Holo.
// /api/holo/fill : Holo saisit dans un logiciel web sans API, navigateur INVISIBLE ; connexion par le coffre local.
app.post('/api/source/read', async (req, res) => {
  if (!localBridge(req)) return res.status(403).json({ error: 'Accès refusé (appel local avec jeton Twiin uniquement).' });
  const r = await runPyJson('discovery.source_read', req.body || {}, { timeout: 120000 });
  console.log(`n8n → document : ${r.file || r.info || r.error}`);
  res.status(r.ok ? 200 : 409).json(r);
});
app.post('/api/holo/fill', async (req, res) => {
  if (!localBridge(req)) return res.status(403).json({ error: 'Accès refusé (appel local avec jeton Twiin uniquement).' });
  const { url, label, values } = req.body || {};
  console.log(`n8n → Holo saisit (navigateur invisible) : ${label || url}`);
  const r = await runPyJson('discovery.web_fill', { url, label, values }, { track: webRuns, timeout: 900000 });
  console.log(`   → ${r.ok ? 'saisi et vérifié' : `échec : ${r.error || `manque ${(r.check?.missing || []).join(', ')}`}`}`);
  res.status(r.ok ? 200 : 409).json(r);
});
app.post('/api/excel/write', async (req, res) => {
  if (!localBridge(req)) return res.status(403).json({ error: 'Accès refusé (appel local avec jeton Twiin uniquement).' });
  const r = await runPyJson('discovery.excel_write', req.body || {}, { timeout: 60000 });
  console.log(`n8n → Excel : ${r.ok ? `${r.added} ligne(s) ajoutée(s) dans ${r.path}` : r.error}`);
  res.status(r.ok ? 200 : 409).json(r);
});

// Créer l'automatisation à partir de la solution trouvée par la découverte (au lieu d'un plan réécrit de zéro).
app.post('/api/automations/from-discovery', async (req, res) => {
  const dir = discovery.dir || latestSessionDir();
  if (!dir || !discoveryState(dir)?.solution) return res.status(409).json({ error: 'Pas encore de solution trouvée pour cette tâche.' });
  try { await ensureN8n(); } catch (e) { return res.status(500).json({ error: e.message }); }
  const build = await new Promise((resolve) => {
    const p = spawn(PYTHON, ['-u', '-m', 'discovery.build_automation', dir], { cwd: REPO_ROOT, env: { ...process.env, PYTHONUTF8: '1' } });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => resolve(code === 0 ? { plan: out.trim().split('\n').at(-1) } : { error: err.trim().split('\n').at(-1) }));
  });
  if (build.error) return res.status(500).json({ error: `Plan impossible : ${build.error}` });
  const plan = JSON.parse(fs.readFileSync(build.plan, 'utf8'));
  const imp = await new Promise((resolve) => {
    const p = spawn(PYTHON, ['-u', N8N_GEN, build.plan, '--no-run'], { cwd: REPO_ROOT, env: { ...process.env, PYTHONUTF8: '1' } });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('close', () => resolve(out.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((e) => e?.type === 'imported')));
  });
  if (!imp) return res.status(500).json({ error: 'Import dans n8n impossible (voir le journal du serveur).' });
  const st = discoveryState(dir);
  await sb('automations?on_conflict=user_id,n8n_id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
    body: { task_id: st?.task_id || null, n8n_id: imp.id, name: plan.name, blocks: plan.blocks, freq: 'manual', active: false } });
  console.log(`Automatisation créée depuis la découverte : ${plan.name} (${plan.blocks.length} blocs, sans Holo à l'écran)`);
  res.json({ ok: true, id: imp.id, name: plan.name, blocks: plan.blocks.map((b) => b.name) });
});

app.post('/api/holo/run', async (req, res) => {
  try {
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
    if (!local || !process.env.TWIIN_LOCAL_TOKEN || req.get('x-twiin-token') !== process.env.TWIIN_LOCAL_TOKEN) {
      return res.status(403).json({ error: 'Accès refusé (appel local avec jeton Twiin uniquement).' });
    }
    if (replay?.running) return res.status(409).json({ error: 'Holo est déjà occupé par un autre rejeu.' });
    const { name, steps: raw, expect, env: asked } = req.body || {};
    let steps = (raw || []).map((x) => String(x).trim()).filter(Boolean);
    if (!steps.length) return res.status(400).json({ error: 'Aucune étape.' });
    const env = holoEnv(steps, asked);
    if (env === 'cloud') steps = steps.map((x) => x.replace(/^(in|dans)\s+(google\s+)?chrome\s*,\s*/i, '')); // le cloud a son propre navigateur
    if (expect && Object.keys(expect).length) {
      // la dernière étape demande à Holo de rendre les valeurs lues sous forme de JSON, exploitable par n8n
      steps[steps.length - 1] += ' Then answer ONLY with a JSON object with exactly these keys, filled with the values you READ ON SCREEN '
        + '(write « non trouvé » if a value is not visible): ' + JSON.stringify(expect);
    }
    const id = saveSkill({ name: `n8n ${name || 'tâche Holo'}`, summary: 'Étape lancée par n8n', steps });
    const dir = path.join(REPO_ROOT, 'workflows', 'runs');
    fs.mkdirSync(dir, { recursive: true });
    const events = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-n8n-events.jsonl`);
    fs.writeFileSync(events, '');
    if (env === 'mac') spawnMac(['-e', 'tell application "System Events" to set visible of process "Code" to false']);
    const pontEnPause = env === 'mac' && telecommande?.pause(); // le bureau du Mac à Holo seul, le temps de l'étape
    if (pontEnPause) await new Promise((r) => setTimeout(r, 1500));
    const t0 = Date.now();
    const proc = spawn(PYTHON, ['-u', RUN_LIVE, id, '--no-open', '--events', events, ...(env === 'cloud' ? ['--remote'] : [])], { cwd: REPO_ROOT });
    proc.stdout.on('data', (d) => process.stdout.write(`[n8n→holo] ${d}`));
    proc.stderr.on('data', (d) => process.stderr.write(`[n8n→holo] ${d}`));
    replay = { proc, events, id, running: true, env, name: name || 'Holo' };
    console.log(`n8n → Holo : ${id} (${steps.length} étape(s), ${env === 'cloud' ? 'navigateur cloud de H' : 'sur ce Mac'})`);
    await new Promise((resolve) => proc.on('close', resolve));
    if (pontEnPause) telecommande.reprendre(); // le téléphone reprend la main sur le Mac
    replay.running = false;
    const evs = fs.readFileSync(events, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const end = evs.find((e) => e.type === 'end') || {};
    const answers = evs.filter((e) => e.type === 'step_end').map((e) => e.answer || '');
    let data = null;
    const last = answers.at(-1) || '';
    const a = last.indexOf('{'), b = last.lastIndexOf('}');
    if (expect && a >= 0 && b > a) {
      try { data = JSON.parse(jsonrepair(last.slice(a, b + 1))); } catch { data = null; }
    }
    backLog('holo-bloc', { name, env, ok: !!end.ok, seconds: Math.round((Date.now() - t0) / 1000), usage: end.usage || {} });
    res.json({ ok: !!end.ok, status: end.status || 'inconnu', seconds: Math.round((Date.now() - t0) / 1000), env,
               answers, data, usage: end.usage || {}, restarts: end.restarts || 0 });
  } catch (err) {
    if (replay) replay.running = false;
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/replay/events', (req, res) => {
  if (!replay) return res.json({ events: [], next: 0, running: false });
  const since = parseInt(req.query.since || '0', 10);
  const all = fs.readFileSync(replay.events, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  res.json({ events: all.slice(since), next: all.length, running: replay.running });
});

app.post('/api/replay/stop', (req, res) => {
  if (replay?.running) killTree(replay.proc);
  res.json({ ok: true });
});

// Tâche oubliée : les étapes d'un enregistrement d'ajout sont ajoutées à la fin de la tâche d'origine.
function fusionnerAjout(cibleDir, segmentId, result) {
  const file = path.join(cibleDir, 'analysis.json');
  if (!fs.existsSync(cibleDir)) return;
  const nouvelles = (result?.workflows || []).flatMap((w) => w.steps || []);
  if (!nouvelles.length) return;
  const an = lireJson(file) || { meta: {}, result: { workflows: [] } };
  an.result = an.result || { workflows: [] };
  if (!an.result.workflows?.length) an.result.workflows = [{ name: 'Tâche', summary: null, steps: [] }];
  an.result.workflows[0].steps = [...(an.result.workflows[0].steps || []), ...nouvelles];
  an.segments = [...(an.segments || []), { id: segmentId, ajouteLe: new Date().toISOString(), etapes: nouvelles.length }];
  an.analysedAt = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(an, null, 2) + '\n');
}

// --- Mes enregistrements : historique, analyse à la demande (coûteuse), corbeille ------------------------------
// Une analyse n'est refaite que sur demande : les anciens enregistrements gardent leurs images, sans appel à Holo.
const CORBEILLE_DIR = path.join(REPO_ROOT, 'workflows', 'corbeille');
const lireJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
// Titre court pour retrouver un enregistrement : l'application la plus utilisée et sa fenêtre (sinon « Enregistrement »).
function titreAuto(dir) {
  try {
    const ev = fs.readFileSync(path.join(dir, 'actions.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const compte = {};
    let fenetre = {};
    for (const e of ev) {
      if (!e.app || /^Twiin|Enregistrement/.test(e.window || '')) continue;
      compte[e.app] = (compte[e.app] || 0) + 1;
      if (e.window && !fenetre[e.app]) fenetre[e.app] = e.window;
    }
    const top = Object.entries(compte).sort((a, b) => b[1] - a[1])[0];
    if (!top) return 'Enregistrement';
    const fen = fenetre[top[0]] ? ` · ${fenetre[top[0]].slice(0, 50)}` : '';
    return `${top[0]}${fen}`;
  } catch {
    return 'Enregistrement';
  }
}
function infoEnregistrement(dir, id) {
  const an = lireJson(path.join(dir, 'analysis.json'));
  const sess = lireJson(path.join(dir, 'session.json'));
  const wfs = an?.result?.workflows || [];
  return {
    titre: wfs[0]?.name || titreAuto(dir),
    id,
    startedAt: sess?.startedAt ? new Date(sess.startedAt).toISOString() : null,
    analyse: !!an,
    analysedAt: an?.analysedAt || null,
    nom: wfs[0]?.name || null,
    nb_taches: wfs.length,
    nb_etapes: wfs.reduce((n, w) => n + (w.steps || []).length, 0),
    supprime_le: lireJson(path.join(dir, 'corbeille.json'))?.deletedAt || null,
    ajout_de: sess?.ajouterA || null, // enregistrement d'une tâche oubliée : rangé dans la tâche d'origine
    source: sess?.source || null, // « telecommande » : tâche faite par Holo, demandée depuis le téléphone
  };
}
const listeDossiers = (base) => (fs.existsSync(base)
  ? fs.readdirSync(base).filter((d) => fs.statSync(path.join(base, d)).isDirectory()).sort().reverse() : []);

app.get('/api/sessions', (req, res) => {
  const tous = listeDossiers(SESSIONS_DIR).map((id) => infoEnregistrement(path.join(SESSIONS_DIR, id), id));
  // les ajouts ne sont pas des tâches à part : ils apparaissent comme « N ajout(s) » sur la tâche d'origine
  const ajouts = {};
  for (const e of tous) if (e.ajout_de) ajouts[e.ajout_de] = (ajouts[e.ajout_de] || 0) + 1;
  res.json({ sessions: tous.filter((e) => !e.ajout_de).map((e) => ({ ...e, ajouts: ajouts[e.id] || 0 })) });
});

app.get('/api/sessions/:id', (req, res) => {
  const dir = path.join(SESSIONS_DIR, path.basename(req.params.id));
  if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Enregistrement introuvable.' });
  res.json({ ...infoEnregistrement(dir, req.params.id), analyse_complete: lireJson(path.join(dir, 'analysis.json')) });
});

app.post('/api/sessions/:id/analyze', async (req, res) => {
  try {
    const id = path.basename(req.params.id);
    if (recorderSession?.id === id && recorderSession.proc?.exitCode === null) return res.status(409).json({ error: 'Cet enregistrement est en cours.' });
    if (analysisProgress.phase !== 'idle' && Date.now() - analysisProgress.at < 600000) return res.status(409).json({ error: 'Une analyse est déjà en cours.' });
    const dir = path.join(SESSIONS_DIR, id);
    if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Enregistrement introuvable.' });
    await analyzeSessionDir(dir);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Supprimer = mettre à la corbeille (récupérable). Rien n'est effacé définitivement sans « Vider la corbeille ».
app.delete('/api/sessions/:id', (req, res) => {
  const id = path.basename(req.params.id);
  const dir = path.join(SESSIONS_DIR, id);
  if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Enregistrement introuvable.' });
  if (recorderSession?.id === id && recorderSession.proc?.exitCode === null) return res.status(409).json({ error: 'Arrête l\'enregistrement avant de le supprimer.' });
  fs.mkdirSync(CORBEILLE_DIR, { recursive: true });
  const dest = path.join(CORBEILLE_DIR, id);
  if (fs.existsSync(dest)) return res.status(409).json({ error: 'Déjà dans la corbeille.' });
  fs.renameSync(dir, dest);
  fs.writeFileSync(path.join(dest, 'corbeille.json'), JSON.stringify({ deletedAt: new Date().toISOString() }) + '\n');
  res.json({ ok: true });
});

// La corbeille garde un enregistrement 30 jours, puis le supprime définitivement.
const JOURS_CORBEILLE = 30;
function viderCorbeilleExpiree() {
  const maintenant = Date.now();
  for (const id of listeDossiers(CORBEILLE_DIR)) {
    const supprime = Date.parse(lireJson(path.join(CORBEILLE_DIR, id, 'corbeille.json'))?.deletedAt || '');
    if (supprime && maintenant - supprime > JOURS_CORBEILLE * 86400000) fs.rmSync(path.join(CORBEILLE_DIR, id), { recursive: true, force: true });
  }
}
app.get('/api/corbeille', (req, res) => {
  viderCorbeilleExpiree();
  const maintenant = Date.now();
  res.json({ jours: JOURS_CORBEILLE, items: listeDossiers(CORBEILLE_DIR).map((id) => {
    const info = infoEnregistrement(path.join(CORBEILLE_DIR, id), id);
    const supprime = Date.parse(info.supprime_le || '');
    return { ...info, jours_restants: supprime ? Math.max(0, Math.ceil(JOURS_CORBEILLE - (maintenant - supprime) / 86400000)) : JOURS_CORBEILLE };
  }) });
});

// Modifications d'une tâche d'un enregistrement (étapes, nom, résumé) : sauvegardées dans son analysis.json.
app.put('/api/sessions/:id/analysis/workflows/:idx', (req, res) => {
  const file = path.join(SESSIONS_DIR, path.basename(req.params.id), 'analysis.json');
  const an = lireJson(file);
  const i = Number(req.params.idx);
  const wfs = an?.result?.workflows;
  if (!wfs?.[i]) return res.status(404).json({ error: 'Tâche introuvable dans cet enregistrement.' });
  const b = req.body || {};
  wfs[i] = { ...wfs[i],
    name: typeof b.name === 'string' ? b.name : wfs[i].name,
    summary: typeof b.summary === 'string' ? b.summary : wfs[i].summary,
    steps: Array.isArray(b.steps) ? b.steps.map(String) : wfs[i].steps,
    modifie_le: new Date().toISOString() };
  fs.writeFileSync(file, JSON.stringify(an, null, 2) + '\n');
  res.json({ ok: true });
});

app.post('/api/corbeille/:id/restaurer', (req, res) => {
  const id = path.basename(req.params.id);
  const src = path.join(CORBEILLE_DIR, id);
  if (!fs.existsSync(src)) return res.status(404).json({ error: 'Introuvable dans la corbeille.' });
  const dest = path.join(SESSIONS_DIR, id);
  if (fs.existsSync(dest)) return res.status(409).json({ error: 'Un enregistrement avec ce nom existe déjà.' });
  fs.renameSync(src, dest);
  fs.rmSync(path.join(dest, 'corbeille.json'), { force: true });
  res.json({ ok: true });
});

app.delete('/api/corbeille/:id', (req, res) => {
  const src = path.join(CORBEILLE_DIR, path.basename(req.params.id));
  if (!fs.existsSync(src)) return res.status(404).json({ error: 'Introuvable dans la corbeille.' });
  fs.rmSync(src, { recursive: true, force: true }); // suppression définitive
  res.json({ ok: true });
});

app.post('/api/corbeille/vider', (req, res) => {
  const ids = listeDossiers(CORBEILLE_DIR);
  for (const id of ids) fs.rmSync(path.join(CORBEILLE_DIR, id), { recursive: true, force: true });
  res.json({ ok: true, supprimes: ids.length });
});

const PORT = process.env.PORT || 3000;
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// ÉTAPE 1 · AUDIT : « Présente-toi » (accueil vocal) + « Les logiciels de ton poste » (scan de l'ordinateur)
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const WORKFLOWS_DIR = path.join(REPO_ROOT, 'workflows');
const PROFILE_PATH = path.join(WORKFLOWS_DIR, 'profile.json');       // fiche employé (reste sur le Mac, exclue de git)
const AUDIT_DIR = path.join(WORKFLOWS_DIR, 'audit');                 // résultats du scan (exclus de git)
const VOICE_CACHE = path.join(WORKFLOWS_DIR, 'voice-cache');         // phrases de Twiin déjà dites (évite de repayer la voix)
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;
// Voix de l'audit : Lucie (française native, ton de conseillère, qualité studio). ELEVENLABS_AUDIT_VOICE_ID pour en changer.
const ELEVEN_VOICE = process.env.ELEVENLABS_AUDIT_VOICE_ID || 'YxrwjAKoUKULGd0g8K9Y';
// Voix des jumeaux (bibliothèque ElevenLabs) : Iris = « Victoria », Ilo = « Corentin »
// Ilo est réglé plus posé (plus stable, moins expressif) pour ne pas couvrir Iris ; le volume est ensuite égalisé dans la page.
const JUMEAUX = {
  iris: { id: 'O31r762Gb3WFygrEOGh0', reglages: { stability: 0.4, similarity_boost: 0.8, style: 0.5, use_speaker_boost: true } }, // « Victoria »
  ilo: { id: 'IHngRooVccHyPqB4uQkG', reglages: { stability: 0.6, similarity_boost: 0.8, style: 0.15, use_speaker_boost: false } },
};
const voixEnCours = new Map(); // une seule génération à la fois par phrase (deux demandes simultanées ne s'écrasent plus)
const ELEVEN_STT_MODEL = process.env.ELEVENLABS_STT_MODEL || 'scribe_v2';

// La voix et la transcription coûtent des crédits ElevenLabs : réservées à ce Mac (pas aux autres postes du réseau).
const isLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const telecommande = mountTelecommande(app, { isLocal, root: REPO_ROOT, port: PORT, analyser: (dir) => { // tâche faite depuis le téléphone : masquage + analyse
  if (analysisProgress.phase !== 'idle' && Date.now() - analysisProgress.at < 600000) return false;
  analyzeSessionDir(dir).catch((e) => console.error('Analyse (télécommande) :', e.message)).finally(() => setPhase('idle'));
  return true;
} }); // piloter ce Mac depuis son téléphone (voir telecommande.js)

// Dictionnaire de l'accueil vocal (lexicon.json, relu à chaque réponse : l'équipe peut le compléter sans redémarrer).
const LEXICON_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lexicon.json');
function lexicon() {
  try { return JSON.parse(fs.readFileSync(LEXICON_PATH, 'utf8')); } catch { return { services: [], postes: [], logiciels: [], corrections: [], mots_parasites: [] }; }
}
// Mots que la transcription doit privilégier, selon la question (jamais pour le nom : un dictionnaire le déformerait).
function keytermsFor(qid) {
  const L = lexicon();
  const pick = { poste: [...L.postes, ...L.services], service: L.services, taches: L.logiciels, tache_prioritaire: L.logiciels,
                 outils: L.logiciels, attentes: L.logiciels }[qid] || [];
  return [...new Set(pick)].filter((w) => w.length <= 40).slice(0, 100);
}
const escRe = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Nettoyage d'une réponse transcrite : mots parasites, corrections connues, répétitions. Renvoie aussi ce qui a changé.
function cleanAnswer(text, qid) {
  const L = lexicon();
  const changes = [];
  let t = ` ${text} `;
  for (const f of L.mots_parasites || []) t = t.replace(new RegExp(`[\\s,]*\\b${escRe(f)}\\b[\\s,.…]*`, 'giu'), ' ');
  for (const c of L.corrections || []) {
    if (c.questions && !c.questions.includes(qid)) continue;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escRe(c.entendu)}(?=$|[^\\p{L}\\p{N}])`, 'giu');
    if (re.test(t)) { t = t.replace(re, `$1${c.corrige}`); changes.push({ entendu: c.entendu, corrige: c.corrige }); }
  }
  // Répétitions : une phrase déjà dite (ou contenue dans une phrase précédente) n'est gardée qu'une fois.
  const kept = [];
  const norm = (x) => x.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();
  for (const sentence of t.split(/(?<=[.!?])\s+/)) {
    const n = norm(sentence);
    if (!n) continue;
    if (kept.some((k) => norm(k).includes(n))) { changes.push({ entendu: sentence.trim(), corrige: '(répétition retirée)' }); continue; }
    kept.push(sentence.trim());
  }
  t = kept.join(' ').replace(/\s+([,.!?])/g, '$1').replace(/,{2,}/g, ',').replace(/^[\s,.]+/, '').replace(/\s{2,}/g, ' ').trim();
  if (t) t = t[0].toUpperCase() + t.slice(1);
  return { text: t, changes };
}

// Questions d'accueil : chaque réponse remplit un champ de la fiche employé.
const ONBOARDING = {
  hello: "Bonjour, je suis Twiin, ton assistant automatisation. Avant de commencer, j'aimerais mieux connaître ton travail. "
       + "Je vais te poser huit questions rapides. Tu peux répondre à voix haute, ou par écrit si tu préfères.",
  questions: [
    // Les noms propres sont souvent mal entendus (« Amine Benjab ») : l'employé vérifie l'orthographe avant de continuer.
    { id: 'identite', text: "Pour commencer, quels sont ton prénom et ton nom ?", confirm: "Vérifie l'orthographe de ton nom à l'écran, puis valide." },
    { id: 'poste', text: "Quel est ton poste ?" },
    { id: 'service', text: "Dans quel service ou quelle équipe travailles-tu ?" },
    { id: 'anciennete', text: "Depuis combien de temps travailles-tu ici ?" },
    { id: 'taches', text: "Quelles sont les tâches que tu fais le plus souvent ?" },
    { id: 'tache_prioritaire', text: "Laquelle te prend le plus de temps, ou t'ennuie le plus ? Et tu la fais tous les combien ?" },
    { id: 'outils', text: "Quels logiciels utilises-tu au quotidien ?" },
    { id: 'attentes', text: "Enfin, qu'est-ce que tu attends de Twiin ?" },
  ],
  bye: "Merci ! J'ai tout noté. Maintenant, je peux regarder quels logiciels sont installés sur ton ordinateur : "
     + "seulement leur nom, jamais tes fichiers.",
};
app.get('/api/onboarding/voix-v1', (req, res) => res.json(ONBOARDING)); // ancien accueil vocal (8 questions)

// Voix gratuite de secours : les voix françaises intégrées à macOS (Amélie pour Iris, Thomas pour Ilo et les autres).
// Sans compte ni clé, hors ligne. Utilisée quand ElevenLabs est absent ou refuse la demande (clé désactivée, quota).
function voixMac(text, qui, file) {
  return new Promise((ok, ko) => {
    const p = spawnRaw('say', ['-v', qui === 'iris' ? 'Amélie' : 'Thomas', '-r', '185', '--file-format=m4af', '--data-format=aac', '-o', file, text]);
    p.on('error', ko);
    p.on('close', (code) => (code === 0 ? ok() : ko(new Error(`voix du Mac : code ${code}`))));
  });
}

// Twiin parle : texte → voix (ElevenLabs, sinon voix gratuite du Mac), gardée en cache sur le disque.
app.get('/api/voice/say', async (req, res) => {
  try {
    if (!isLocal(req)) return res.status(403).end();
    const text = String(req.query.text || '').trim().slice(0, 600);
    if (!text) return res.status(400).end();
    fs.mkdirSync(VOICE_CACHE, { recursive: true });
    // Iris et Ilo posent les questions de l'audit avec leurs propres voix (les mêmes que sur la page d'ouverture)
    const voix = JUMEAUX[req.query.voix] || null;
    const voiceId = voix?.id || ELEVEN_VOICE;
    const cle = crypto.createHash('sha1').update(`${voiceId}|${voix ? 'v5' : ''}|${text}`).digest('hex');
    const file = path.join(VOICE_CACHE, cle + '.mp3');
    const fileMac = path.join(VOICE_CACHE, cle + '.mac.m4a');
    if (fs.existsSync(file)) return res.type('audio/mpeg').sendFile(file);
    if (voixEnCours.has(file)) await voixEnCours.get(file);
    if (fs.existsSync(file)) return res.type('audio/mpeg').sendFile(file);
    let fini; voixEnCours.set(file, new Promise((ok) => { fini = ok; }));
    try {
      if (ELEVEN_KEY) {
        try {
          const r = await fetch(`${ELEVEN_BASE}/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
            method: 'POST', headers: { 'xi-api-key': ELEVEN_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', ...(voix ? { language_code: 'fr', voice_settings: voix.reglages } : {}) }),
          });
          if (!r.ok) throw new Error(`ElevenLabs (voix) : ${r.status} ${(await r.text()).slice(0, 120)}`);
          const tmp = `${file}.${process.pid}.tmp`; // écrit d'un bloc : jamais de fichier à moitié servi
          fs.writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
          fs.renameSync(tmp, file);
          return res.type('audio/mpeg').sendFile(file);
        } catch (e) { console.warn(`${e.message} : voix gratuite du Mac à la place`); }
      }
      if (!fs.existsSync(fileMac)) {
        const tmp = `${fileMac}.${process.pid}.tmp.m4a`;
        await voixMac(text, req.query.voix, tmp);
        fs.renameSync(tmp, fileMac);
      }
      res.type('audio/mp4').sendFile(fileMac);
    } finally { voixEnCours.delete(file); fini(); }
  } catch (err) {
    console.error(err.message);
    res.status(502).json({ error: err.message });
  }
});

// L'employé répond : audio (enregistré par le navigateur) → texte (ElevenLabs Scribe). L'audio n'est pas gardé.
app.post('/api/voice/transcribe', express.raw({ type: '*/*', limit: '25mb' }), async (req, res) => {
  try {
    if (!isLocal(req)) return res.status(403).end();
    if (!ELEVEN_KEY) return res.status(503).json({ error: 'ELEVENLABS_API_KEY manquante dans .env' });
    if (!req.body?.length) return res.status(400).json({ error: 'Aucun son reçu.' });
    const form = new FormData();
    form.append('model_id', ELEVEN_STT_MODEL);
    form.append('language_code', 'fra');
    form.append('tag_audio_events', 'false');
    const qid = String(req.query.q || '');
    for (const k of keytermsFor(qid)) form.append('keyterms', k);
    form.append('file', new Blob([req.body], { type: req.headers['content-type'] || 'audio/webm' }), 'reponse.webm');
    let r = await fetch(`${ELEVEN_BASE}/v1/speech-to-text`, { method: 'POST', headers: { 'xi-api-key': ELEVEN_KEY }, body: form });
    if (!r.ok && form.has('keyterms')) { // liste de mots refusée : on retranscrit sans elle plutôt que d'échouer
      form.delete('keyterms');
      r = await fetch(`${ELEVEN_BASE}/v1/speech-to-text`, { method: 'POST', headers: { 'xi-api-key': ELEVEN_KEY }, body: form });
    }
    const d = await r.json();
    if (!r.ok) throw new Error(`ElevenLabs (transcription) : ${r.status} ${JSON.stringify(d).slice(0, 200)}`);
    const raw = (d.text || '').trim();
    const { text, changes } = cleanAnswer(raw, qid);
    res.json({ text, raw, changes });
  } catch (err) {
    console.error(err.message);
    res.status(502).json({ error: err.message });
  }
});

// Fiche employé : les réponses (orales ou écrites) mises au propre par le modèle, gardées sur le Mac.
const PROFILE_PROMPT = `You turn the answers of an employee's onboarding interview (in French) into a clean profile.
The answers were SPOKEN then transcribed automatically: they may contain filler words, repetitions and mis-heard words.
Use ONLY what the employee said; never invent. Unknown → null (or [] for lists).
Clean-up rules:
- remove filler words (euh, bah, hum…) and repetitions: a job title said three times is written once;
- write departments, job titles and software with the canonical spelling of the DICTIONARY given in the user message
  (« informatique » → « IT », « power point » → « PowerPoint »);
- a word that makes no sense in context but SOUNDS like a dictionary entry was probably mis-heard: correct it
  (« Haïti » as a department → « IT »). If you are not sure, keep what was said. List every correction in "corrections";
- keep the employee's own words for tasks, shortened to a few words each; never translate job titles.
Return ONLY a JSON object, no prose, no markdown fences, never straight double quotes inside strings (use « »):
{"prenom":null,"nom":null,"poste":null,"service":null,"anciennete":"as said, e.g. « 3 ans »",
 "taches_frequentes":["…"],"tache_prioritaire":{"tache":null,"frequence":null,"pourquoi":null},
 "outils_declares":["software names as said"],"attentes":null,
 "resume":"one friendly French sentence addressed to the employee (tutoiement) summing up their job",
 "corrections":[{"entendu":"what was transcribed","corrige":"what you wrote instead"}]}`;
app.post('/api/onboarding/profile', async (req, res) => {
  try {
    // réponses nettoyées (mots parasites, répétitions, erreurs d'écoute connues) : c'est ce qui s'affiche et ce qui est gardé
    const answers = (req.body?.answers || []).filter((a) => a && a.question)
      .map((a) => ({ ...a, answer: cleanAnswer(a.answer || '', a.id).text }));
    if (!answers.length) return res.status(400).json({ error: 'Aucune réponse.' });
    const L = lexicon();
    const user = `DICTIONARY\nDepartments: ${L.services.join(', ')}\nJob titles: ${L.postes.join(', ')}\nSoftware: ${L.logiciels.join(', ')}\n\nINTERVIEW\n`
      + answers.map((a) => `Q: ${a.question}\nA: ${a.answer || '(pas de réponse)'}`).join('\n\n');
    const { data: resp } = await client.chat.completions.create({
      model: HF_MODEL, max_tokens: 4000, temperature: 0, reasoning_effort: REASONING_EFFORT,
      messages: [{ role: 'system', content: PROFILE_PROMPT }, { role: 'user', content: user }],
    }).withResponse();
    const raw = resp.choices?.[0]?.message?.content || '';
    if (!raw.trim()) throw new Error('Réponse vide du modèle : réessaie.');
    const { result } = parseWorkflows(raw);
    const profile = { ...result, answers, updated_at: new Date().toISOString() };
    fs.mkdirSync(WORKFLOWS_DIR, { recursive: true });
    fs.writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2) + '\n');
    if (sbUser()) {
      profileCache.set(sbUser().id, result);
      const tp = result.tache_prioritaire || null;
      await sb('profiles', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: {
        id: sbUser().id, prenom: result.prenom || null, nom: result.nom || null, poste: result.poste || null, service: result.service || null,
        anciennete: result.anciennete || null, taches_frequentes: result.taches_frequentes || [], tache_prioritaire: tp,
        outils_declares: result.outils_declares || [], attentes: result.attentes || null, resume: result.resume || null,
        answers, corrections: result.corrections || [], updated_at: profile.updated_at } });
    }
    console.log(`Fiche employé enregistrée (${answers.length} réponses), ≈ ${(resp.usage?.cost ?? 0).toFixed(4)} $`);
    backLog('fiche', { model: HF_MODEL, cost_usd: resp.usage?.cost ?? null, corrections: result.corrections || [] });
    res.json({ profile, cost_usd: resp.usage?.cost ?? null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});
app.get('/api/onboarding/profile', async (req, res) => {
  if (sbUser() && !SB_SERVICE) { // connecté : SA fiche (plusieurs collègues peuvent passer sur le même Mac)
    const rows = await sb(`profiles?id=eq.${sbUser().id}&select=*`);
    if (rows?.[0]) profileCache.set(sbUser().id, rows[0]);
    return res.json({ profile: rows?.[0] || null });
  }
  res.json({ profile: fs.existsSync(PROFILE_PATH) ? JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8')) : null });
});
// La fiche, en quelques lignes, pour les conseils et la recommandation (rôle, fréquence, attentes)
let profileCache = new Map(); // fiche de l'employé connecté, pour les conseils et la recommandation
function profileContext() {
  try {
    const p = (sbUser() && profileCache.get(sbUser().id)) || JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8'));
    return `EMPLOYEE PROFILE (from the onboarding interview)\nJob: ${p.poste || '?'} · Team: ${p.service || '?'} · Seniority: ${p.anciennete || '?'}\n`
      + `Frequent tasks: ${(p.taches_frequentes || []).join('; ') || '?'}\n`
      + `Most painful task: ${p.tache_prioritaire?.tache || '?'} (frequency: ${p.tache_prioritaire?.frequence || '?'})\n`
      + `Expectations: ${p.attentes || '?'}`;
  } catch { return ''; }
}

// Scan du poste : la liste des outils installés (noms, versions, catégories) — ni fichiers, ni historique.
// « usage » (choix de l'employé) : ajoute pour chaque appli « ouverte ces 30 derniers jours » oui / non.
const AUDIT_SCRIPT = path.join(REPO_ROOT, '..', 'capture', 'scripts', 'audit_poste.py');
app.post('/api/audit/scan', (req, res) => {
  const out = path.join(AUDIT_DIR, new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
  const args = [AUDIT_SCRIPT, '--out', out, ...(req.body?.usage ? ['--usage'] : [])];
  const t0 = Date.now();
  const proc = spawn(PYTHON, args);
  let err = '';
  proc.stderr.on('data', (d) => { err += d; });
  proc.on('close', (code) => {
    try {
      if (code !== 0) throw new Error(err.trim().split('\n').at(-1) || `code ${code}`);
      const audit = JSON.parse(fs.readFileSync(path.join(out, 'audit_poste.json'), 'utf8'));
      console.log(`Audit du poste : ${audit.summary.outils} outils en ${((Date.now() - t0) / 1000).toFixed(1)} s` + (req.body?.usage ? ' (avec ouverture récente)' : ''));
      backLog('scan', { seconds: (Date.now() - t0) / 1000, usage: !!req.body?.usage, ...audit.summary });
      sb('audits', { method: 'POST', prefer: 'return=minimal', body: { with_usage: !!req.body?.usage, scope: audit.scope, summary: audit.summary, tools: audit.tools } });
      res.json({ audit, seconds: (Date.now() - t0) / 1000 });
    } catch (e) {
      res.status(500).json({ error: `Scan impossible : ${e.message}` });
    }
  });
});
app.get('/api/audit/latest', async (req, res) => {
  if (sbUser() && !SB_SERVICE) { // connecté : SON dernier scan
    const rows = await sb('audits?select=*&order=created_at.desc&limit=1');
    const a = rows?.[0];
    return res.json({ audit: a ? { schema: 'twiin/audit-poste@1', generated_at: a.created_at, scope: a.scope, summary: a.summary, tools: a.tools,
                                   excluded_personal: [], extensions: {} } : null });
  }
  const dirs = fs.existsSync(AUDIT_DIR) ? fs.readdirSync(AUDIT_DIR).sort() : [];
  const f = dirs.length ? path.join(AUDIT_DIR, dirs.at(-1), 'audit_poste.json') : null;
  res.json({ audit: f && fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 🎬 TUTO VIDÉO (étape 4 · Reco « accélérer ») : images de l'enregistrement + voix off ElevenLabs + montage Remotion.
// La vidéo s'affiche ensuite directement dans la page Twiin.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const TUTO_SCRIPT = path.join(REPO_ROOT, 'tuto', 'build_tuto.py');
const VIDEO_DIR = path.join(REPO_ROOT, 'tuto', 'video');
const VIDEO_OUT = path.join(VIDEO_DIR, 'out');
app.use('/tutos-video', express.static(VIDEO_OUT));
let tutoJob = null; // { name, phase, percent, log, url, error, running, startedAt }

function runStep(cmd, args, cwd, onLine) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd });
    let tail = '';
    const feed = (d) => { tail = (tail + d).slice(-4000); String(d).split(/[\r\n]+/).forEach((l) => l.trim() && onLine(l.trim())); };
    p.stdout.on('data', feed);
    p.stderr.on('data', feed);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(tail.trim().split('\n').at(-1) || `code ${code}`))));
  });
}

app.post('/api/tuto/create', async (req, res) => {
  if (tutoJob?.running) return res.status(409).json({ error: 'Un tuto est déjà en cours de fabrication.' });
  const wf = req.body?.workflow || {};
  const example = !!req.body?.example;
  const name = example ? 'veille-loreal' : `${slugify(wf.name).slice(0, 40)}-${new Date().toISOString().slice(5, 16).replace(/[-:T]/g, '')}`;
  const props = path.join(VIDEO_DIR, 'public', 'tutos', name, 'props.json');
  const mp4 = path.join(VIDEO_OUT, `${name}.mp4`);
  const job = tutoJob = { name, phase: 'images', percent: 0, log: [], url: null, error: null, running: true, startedAt: Date.now() };
  res.json({ ok: true, name });
  const log = (l) => { job.log.push(l); job.log = job.log.slice(-30); };
  try {
    if (!(example && fs.existsSync(props))) {
      // l'exemple réutilise son tuto déjà fait ; une vraie tâche part de son enregistrement
      const dir0 = sessionDirFor(wf);
      if (!dir0) throw new Error('L\'enregistrement de cette tâche n\'est pas sur ce Mac : enregistre-la d\'abord (étape 2).');
      const dir = sessionAvecAjouts(dir0); // images et journal des ajouts (tâches oubliées) inclus dans la vidéo
      if (!(wf.steps || []).length) throw new Error('La tâche n\'a pas d\'étapes.');
      const wfFile = path.join(WORKFLOWS_DIR, 'tuto-workflow.json');
      fs.writeFileSync(wfFile, JSON.stringify({ name: wf.name, steps: wf.steps }));
      await runStep(PYTHON, [TUTO_SCRIPT, '--session', dir, '--workflow', wfFile, '--name', name], REPO_ROOT, (l) => {
        log(l);
        if (/^voix off/.test(l)) job.phase = 'voice';
      });
    }
    if (!(example && fs.existsSync(mp4))) {
      job.phase = 'render';
      try { // la couverture affiche le titre court (les logos et la voix disent le reste)
        const pr = JSON.parse(fs.readFileSync(props, 'utf8'));
        const court = (await raccourcir([pr.title]))[pr.title];
        if (court && court !== pr.title) { pr.titre_long = pr.title; pr.title = court; fs.writeFileSync(props, JSON.stringify(pr)); }
        preparerCouverture(name);
      } catch (e) { console.warn('Couverture du tuto :', e.message); }
      await runStep('npx', ['remotion', 'render', 'TwiinTuto', `out/${name}.mp4`, `--props=${JSON.stringify({ dataFile: `tutos/${name}/props.json` })}`],
        VIDEO_DIR, (l) => {
          const m = l.match(/(\d+)\s*\/\s*(\d+)/);
          if (m && Number(m[2]) > 0) job.percent = Math.min(100, Math.round((100 * Number(m[1])) / Number(m[2])));
        });
    }
    await miniature(name).catch((e) => console.warn('Miniature :', e.message));
    if (membreDe(req)) { const e = equipe(); e.proprietaires = { ...(e.proprietaires || {}), [name]: membreDe(req).id }; ecrireEquipe(e); }
    job.phase = 'done';
    job.percent = 100;
    job.url = `/tutos-video/${name}.mp4?v=${Date.now()}`;
    console.log(`Tuto vidéo prêt : ${mp4} (${((Date.now() - job.startedAt) / 1000).toFixed(0)} s)`);
    backLog('tuto', { name, seconds: Math.round((Date.now() - job.startedAt) / 1000), log: job.log.slice(-20) });
    try {
      const pr = JSON.parse(fs.readFileSync(props, 'utf8'));
      const frames = pr.introFrames + pr.outroFrames + pr.scenes.reduce((n, sc) => n + sc.durationInFrames, 0);
      await sb('tutos', { method: 'POST', prefer: 'return=minimal', body: { task_id: wf.task_id || null, name, title: pr.title,
        seconds: Math.round(frames / 30), steps: pr.scenes.map((sc) => ({ title: sc.title, narration: sc.narration, tip: sc.tip })) } });
    } catch { /* données du tuto illisibles : la vidéo reste quand même */ }
  } catch (e) {
    job.error = e.message;
    console.error('Tuto vidéo :', e.message);
    backLog('tuto-erreur', { name, error: e.message, log: job.log.slice(-20) });
  } finally {
    job.running = false;
  }
});
// Couverture d'un tuto : les logos des applis utilisées (comme une miniature YouTube), copiés à côté de ses données.
// Les mots trop courants (Mail, Notes, Home…) ne comptent pas : seulement des noms d'applis sans ambiguïté.
const ICI_SERVEUR = path.dirname(fileURLToPath(import.meta.url));
const ICONES_COMMUNES = new Set(['home', 'apps', 'mail', 'maps', 'news', 'tips', 'tv', 'clock', 'games', 'music', 'notes', 'phone', 'books', 'photos', 'preview',
  'console', 'calendar', 'contacts', 'messages', 'journal', 'weather', 'stocks', 'siri', 'pages', 'numbers', 'chess', 'screenshot', 'magnifier', 'passwords',
  'reminders', 'shortcuts', 'automator', 'dictionary', 'calculator', 'cursor', 'safari', 'teleparty-for-safari', 'parallels-desktop']);
function logosDuTuto(props) {
  let reg = [];
  try { reg = JSON.parse(fs.readFileSync(path.join(ICI_SERVEUR, 'public', 'icons', 'icons.json'), 'utf8')).icons || []; } catch { return []; }
  const texte = [props.titre_long || props.title, props.intro, ...(props.scenes || []).flatMap((sc) => [sc.title, sc.narration, ...(sc.shots || []).map((x) => x.action)])].join(' \n ');
  const trouves = [];
  for (const e of reg) {
    if (ICONES_COMMUNES.has(e.key)) continue;
    let pos = -1;
    for (const a of e.aliases) {
      if (a.length < 3 || /^com\./.test(a)) continue;
      const m = new RegExp(`(^|[^\\p{L}\\p{N}])${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`, 'iu').exec(texte);
      if (m && (pos < 0 || m.index < pos)) pos = m.index;
    }
    if (pos >= 0) trouves.push({ e, pos });
  }
  return trouves.sort((a, b) => a.pos - b.pos).slice(0, 4).map((x) => x.e);
}
function preparerCouverture(name) {
  const dir = path.join(VIDEO_DIR, 'public', 'tutos', name), f = path.join(dir, 'props.json');
  const pr = JSON.parse(fs.readFileSync(f, 'utf8'));
  pr.title = String(pr.title || '').replace(/\s+en\s+\d+\s+étapes?$/i, ''); // la pastille « Tuto · N étapes » le dit déjà
  const logos = logosDuTuto(pr);
  fs.mkdirSync(path.join(dir, 'logos'), { recursive: true });
  pr.logos = logos.map((e) => { fs.copyFileSync(path.join(ICI_SERVEUR, 'public', 'icons', e.file), path.join(dir, 'logos', e.file)); return `tutos/${name}/logos/${e.file}`; });
  fs.writeFileSync(f, JSON.stringify(pr));
  return pr.logos;
}
app.post('/api/tutos/:name/couverture', (req, res) => { // (re)prépare les logos de la couverture d'un tuto existant
  try { res.json({ logos: preparerCouverture(path.basename(req.params.name)) }); } catch (e) { res.status(500).json({ error: e.message }); }
});

// Miniature d'un tuto : l'image fixe de sa couverture (DA Twiin), comme une miniature YouTube
function miniature(name) {
  return runStep('npx', ['remotion', 'still', 'TwiinTuto', `out/${name}.jpg`, '--frame=45', '--image-format=jpeg', '--jpeg-quality=85', '--scale=0.5',
    `--props=${JSON.stringify({ dataFile: `tutos/${name}/props.json` })}`], VIDEO_DIR, () => {});
}
app.get('/api/tuto/status', (req, res) => res.json(tutoJob || { phase: 'idle' }));

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Pages « Mes vidéos » et « Mes automatisations »
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Catégorie de chaque tuto (classée une fois par le petit modèle, gardée sur le poste) : la page Mes vidéos les regroupe
const CATEGORIES_TUTOS = ['Veille', 'Communication', 'Voyages', 'Design', 'Données', 'Recherche', 'Administratif', 'Autre'];
const CATEGORIES_FICHIER = path.join(REPO_ROOT, 'workflows', 'categories-tutos.json');
async function categoriser(tutos) {
  const cache = readJson(CATEGORIES_FICHIER, {});
  const manquants = tutos.filter((t) => !cache[t.name]);
  if (manquants.length) {
    try {
      const r = await client.chat.completions.create({
        model: HF_MODEL, max_tokens: 1500, temperature: 0, reasoning_effort: REASONING_EFFORT,
        messages: [{ role: 'user', content: `Classify each French tutorial into exactly one category among: ${CATEGORIES_TUTOS.join(', ')}.\n` +
          `Return ONLY JSON: {"categories": ["...", ...]} in the same order.\n\n${manquants.map((t, i) => `${i + 1}. ${t.title} — ${t.steps.map((x) => x.title).join(', ')}`).join('\n')}` }],
      });
      const out = parseWorkflows(r.choices?.[0]?.message?.content || '').result?.categories || [];
      manquants.forEach((t, i) => { cache[t.name] = CATEGORIES_TUTOS.includes(out[i]) ? out[i] : 'Autre'; });
      fs.writeFileSync(CATEGORIES_FICHIER, JSON.stringify(cache, null, 1));
    } catch (e) { console.warn('Catégories des tutos :', e.message); }
  }
  return tutos.map((t) => ({ ...t, categorie: cache[t.name] || 'Autre' }));
}
app.get('/api/tutos', async (req, res) => {
  const list = (fs.existsSync(VIDEO_OUT) ? fs.readdirSync(VIDEO_OUT) : []).filter((f) => f.endsWith('.mp4')).map((f) => {
    const name = f.replace(/\.mp4$/, '');
    const st = fs.statSync(path.join(VIDEO_OUT, f));
    let props = null;
    try { props = JSON.parse(fs.readFileSync(path.join(VIDEO_DIR, 'public', 'tutos', name, 'props.json'), 'utf8')); } catch { /* sans données */ }
    const frames = props ? props.introFrames + props.outroFrames + props.scenes.reduce((n, sc) => n + sc.durationInFrames, 0) : null;
    return {
      name, url: `/tutos-video/${f}?v=${Math.round(st.mtimeMs)}`, created: st.mtime, size_mb: +(st.size / 1e6).toFixed(1),
      title: props?.title || name, intro: props?.intro || '', seconds: frames ? Math.round(frames / 30) : null,
      steps: (props?.scenes || []).map((sc) => ({ title: sc.title, narration: sc.narration, tip: sc.tip })),
      thumb: fs.existsSync(path.join(VIDEO_OUT, `${name}.jpg`)) ? `/tutos-video/${name}.jpg?v=${Math.round(fs.statSync(path.join(VIDEO_OUT, `${name}.jpg`)).mtimeMs)}`
        : props?.scenes?.[0]?.shots?.[0]?.src ? `/tutos-media/${props.scenes[0].shots[0].src.replace(/^tutos\//, '')}` : null,
    };
  }).sort((a, b) => new Date(b.created) - new Date(a.created));
  const e = equipe(), prenom = (id) => e.membres.find((m) => m.id === id)?.prenom || null;
  const avecEquipe = list.map((t) => {
    const pa = e.partages.find((x) => x.type === 'tuto' && x.ref === t.name);
    return { ...t, auteur: prenom(e.proprietaires?.[t.name]), partage: pa ? { par: prenom(pa.par), le: pa.le } : null };
  });
  res.json({ tutos: await categoriser(avecEquipe), categories: CATEGORIES_TUTOS, equipe: e.nom });
});
app.use('/tutos-media', express.static(path.join(VIDEO_DIR, 'public', 'tutos')));

// n8n piloté depuis Twiin (API publique de n8n) : l'employé n'a pas besoin d'ouvrir n8n.
async function n8nApi(pathname, opts = {}) {
  const r = await fetch(`${N8N_URL}/api/v1${pathname}`, {
    ...opts, headers: { 'X-N8N-API-KEY': process.env.N8N_LOCAL_API_KEY || '', 'Content-Type': 'application/json', ...(opts.headers || {}) },
    signal: AbortSignal.timeout(15000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`n8n : ${r.status} ${d.message || ''}`.trim());
  return d;
}
const FREQS = { manual: null, daily: '0 9 * * *', weekly: '0 9 * * 1', monthly: '0 9 1 * *' };
const FREQ_LABEL = { manual: 'Manuelle', daily: 'Chaque jour à 9 h', weekly: 'Chaque lundi à 9 h', monthly: 'Le 1er du mois à 9 h' };
const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
// Planification lisible <-> expression cron (minute heure jour-du-mois mois jour-de-semaine), heure de Paris.
function scheduleToCron(sc) {
  const m = [0, 15, 30, 45].includes(+sc.minute) ? +sc.minute : 0;
  const h = Math.min(Math.max(parseInt(sc.hour, 10) || 0, 0), 23);
  if (sc.type === 'daily') return `${m} ${h} * * *`;
  if (sc.type === 'weekly') {
    const days = [...new Set((sc.days || []).map(Number).filter((d) => d >= 0 && d <= 6))].sort();
    if (!days.length) throw new Error('Choisis au moins un jour de la semaine.');
    return `${m} ${h} * * ${days.join(',')}`;
  }
  if (sc.type === 'monthly') return `${m} ${h} ${Math.min(Math.max(parseInt(sc.monthday, 10) || 1, 1), 31)} * *`;
  return null;
}
function cronToSchedule(cron) {
  const p = String(cron || '').trim().split(/\s+/);
  if (p.length !== 5) return { type: 'manual' };
  const [m, h, dom, , dow] = p;
  const base = { minute: +m || 0, hour: +h || 0 };
  if (dom !== '*') return { type: 'monthly', monthday: +dom, ...base };
  if (dow !== '*') return { type: 'weekly', days: dow.split(',').map(Number), ...base };
  return { type: 'daily', ...base };
}
function scheduleLabel(sc) {
  if (!sc || sc.type === 'manual') return 'Manuelle';
  const at = `à ${sc.hour} h${sc.minute ? String(sc.minute).padStart(2, '0') : ''}`;
  if (sc.type === 'daily') return `Chaque jour ${at}`;
  if (sc.type === 'weekly') return `Chaque ${sc.days.map((d) => DAYS[d]).join(', ')} ${at}`;
  return `Le ${sc.monthday === 1 ? '1er' : sc.monthday} du mois ${at}` + (sc.monthday > 28 ? ' (seulement les mois qui ont ce jour)' : '');
}
const BLOCK_KIND = (n) => (/api\/holo\/run/.test(n.parameters?.url || '') ? 'holo' : n.type.endsWith('.googleSheets') ? 'sheets'
  : n.type.endsWith('.code') ? (/Vérification|rules/.test(n.parameters?.jsCode || '') ? 'verify' : 'code') : n.type.endsWith('.httpRequest') ? 'http' : 'other');
let automationRun = null; // { id, proc, startedAt }

async function automationSummary(w) {
  const sched = w.nodes.find((n) => n.type.endsWith('.scheduleTrigger'));
  const cron = sched && !sched.disabled ? sched.parameters?.rule?.interval?.[0]?.expression : null;
  const freq = Object.keys(FREQS).find((k) => FREQS[k] && FREQS[k] === cron) || (cron ? 'custom' : 'manual');
  const schedule = cron ? cronToSchedule(cron) : { type: 'manual' };
  const sheetNode = w.nodes.find((n) => n.type.endsWith('.googleSheets'));
  const sheetId = sheetNode?.parameters?.documentId?.value;
  const gid = sheetNode?.parameters?.sheetName?.value;
  let execs = [];
  try { execs = (await n8nApi(`/executions?workflowId=${encodeURIComponent(w.id)}&limit=20`)).data || []; } catch { /* historique indisponible */ }
  const done = execs.filter((e) => e.stoppedAt);
  const dur = done.map((e) => (new Date(e.stoppedAt) - new Date(e.startedAt)) / 1000);
  const a = {
    id: w.id, name: w.name.replace(/^Twiin — /, ''), active: w.active, freq, freq_label: cron ? scheduleLabel(schedule) : 'Manuelle', cron, schedule,
    blocks: w.nodes.filter((n) => !/(webhook|scheduleTrigger|manualTrigger)$/i.test(n.type)).map((n) => {
      const kind = BLOCK_KIND(n);
      if (kind !== 'holo') return { name: n.name, kind };
      const body = String(n.parameters?.jsonBody || '');
      const asked = (body.match(/env:\s*"(cloud|mac)"/) || [])[1];
      return { name: n.name, kind, env: holoEnv([body.replace(/\\"/g, '"')], asked) };
    }),
    sheet: sheetId ? { id: sheetId, url: `https://docs.google.com/spreadsheets/d/${sheetId}/edit${gid ? `#gid=${gid}` : ''}` } : null,
    executions: execs.map((e) => ({ id: e.id, status: e.status, mode: e.mode, startedAt: e.startedAt, stoppedAt: e.stoppedAt,
                                    url: `${N8N_URL}/workflow/${w.id}/executions/${e.id}` })),
    stats: { total: execs.length, success: execs.filter((e) => e.status === 'success').length,
             avg_s: dur.length ? Math.round(dur.reduce((a, b) => a + b, 0) / dur.length) : null, last: execs[0]?.startedAt || null },
    running: automationRun?.id === w.id,
    plan: lirePlans().find((p) => p.id === w.id)?.at || null,
    n8n_url: `${N8N_URL}/workflow/${w.id}`, created: w.createdAt, updated: w.updatedAt,
  };
  a.gain = gainDe(a, execs);
  return a;
}
// Temps gagné : la durée d'une exécution (Holo refait les gestes de l'employé) × le nombre de passages par semaine
// (d'après l'horaire si elle est programmée, sinon ses lancements des 4 dernières semaines). En minutes.
function gainDe(a, execs) {
  const parLancement = Math.round(estimation(a) / 60);
  const sc = a.active ? a.schedule : null;
  const parSemaine = sc?.type === 'daily' ? 7 : sc?.type === 'weekly' ? (sc.days || []).length : sc?.type === 'monthly' ? 12 / 52
    : execs.filter((e) => e.status === 'success' && Date.now() - new Date(e.startedAt) < 28 * 864e5).length / 4;
  return { minutes_par_lancement: parLancement, lancements_semaine: +parSemaine.toFixed(2), minutes_semaine: Math.round(parLancement * parSemaine) };
}

// Automatisations dont la création a échoué (ex. connexion n8n manquante) : gardées pour « Mes automatisations ».
const FAILED_PATH = path.join(REPO_ROOT, 'workflows', 'runs', 'automations_failed.json');
const readFailed = () => { try { return JSON.parse(fs.readFileSync(FAILED_PATH, 'utf8')); } catch { return []; } };
function rememberFailed(f) {
  const list = readFailed().filter((x) => x.id !== f.id);
  list.unshift({ ...f, at: new Date().toISOString() });
  fs.mkdirSync(path.dirname(FAILED_PATH), { recursive: true });
  fs.writeFileSync(FAILED_PATH, JSON.stringify(list.slice(0, 50), null, 1));
}
function forgetFailed(id) {
  const list = readFailed();
  if (list.some((x) => x.id === id)) fs.writeFileSync(FAILED_PATH, JSON.stringify(list.filter((x) => x.id !== id), null, 1));
}
const failedSummary = (f) => ({
  id: f.id, name: f.name, failed: true, error: f.error, active: false, running: false, freq: 'manual', freq_label: 'Pas créée',
  blocks: (f.blocks || []).map((b) => ({ name: b.name, kind: b.type === 'holo' ? 'holo' : b.type === 'sheets_append' ? 'sheets' : 'other' })),
  executions: [], stats: { total: 0, success: 0, avg_s: null, last: f.at }, updated: f.at,
  fix_url: /google sheets|credential|connexion/i.test(f.error || '') ? `${N8N_URL}/home/credentials` : `${N8N_URL}/home/workflows`,
});

app.get('/api/automations', async (req, res) => {
  if (!(await n8nUp())) return res.json({ up: false, automations: [] });
  try {
    const all = (await n8nApi('/workflows?limit=100')).data || [];
    const mine = all.filter((w) => w.id.startsWith('twiin') && !/\(outil\)/.test(w.name));
    const list = await Promise.all(mine.map(automationSummary));
    for (const f of readFailed()) if (!list.some((a) => a.id === f.id)) list.push(failedSummary(f)); // échecs de création
    const runs = list.flatMap((a) => a.executions.map((e) => ({ n8n_id: a.id, n8n_execution_id: String(e.id), status: e.status, mode: e.mode,
                                                                  started_at: e.startedAt, stopped_at: e.stoppedAt })));
    if (runs.length) sb('automation_runs?on_conflict=user_id,n8n_execution_id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: runs });
    // les automatisations elles-mêmes (y compris celles créées avant la connexion à Supabase)
    const autos = list.filter((a) => !a.failed).map((a) => ({ n8n_id: a.id, name: a.name, blocks: a.blocks, freq: a.freq, active: !!a.active }));
    if (autos.length) sb('automations?on_conflict=user_id,n8n_id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: autos });
    res.json({ up: true, n8n_url: N8N_URL, automations: list });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.get('/api/automations/:id', async (req, res, next) => {
  if (req.params.id === 'etat') return next(); // route du bandeau, déclarée plus bas
  try { res.json(await automationSummary(await n8nApi(`/workflows/${encodeURIComponent(req.params.id)}`))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Fréquence : on règle le déclencheur planifié du workflow, puis on l'active (ou on le met en pause si « manuelle »).
app.post('/api/automations/:id/schedule', async (req, res) => {
  try {
    // Nouveau format : { schedule: { type: manual|daily|weekly|monthly, days, monthday, hour, minute } } ; l'ancien « freq » reste accepté
    const sc = req.body?.schedule || (req.body?.freq in FREQS ? cronToSchedule(FREQS[req.body.freq] || '') : null);
    if (!sc) return res.status(400).json({ error: 'Planification inconnue.' });
    res.json(await planifier(req.params.id, sc));
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: e.message });
  }
});
async function planifier(brut, sc) {
  {
    const cron = sc.type === 'manual' ? null : scheduleToCron(sc);
    const id = encodeURIComponent(brut);
    const w = await n8nApi(`/workflows/${id}`);
    let sched = w.nodes.find((n) => n.type.endsWith('.scheduleTrigger'));
    if (!sched && cron) { // pas de déclencheur planifié : on en ajoute un, branché comme le déclencheur manuel
      const start = w.nodes.find((n) => /(webhook|manualTrigger)$/i.test(n.type));
      sched = { id: crypto.randomUUID(), name: 'Planification', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2,
                position: [(start?.position?.[0] ?? 0), (start?.position?.[1] ?? 0) + 200], parameters: {} };
      w.nodes.push(sched);
      if (start && w.connections[start.name]) w.connections[sched.name] = JSON.parse(JSON.stringify(w.connections[start.name]));
    }
    if (sched) {
      sched.disabled = !cron;
      if (cron) sched.parameters = { rule: { interval: [{ field: 'cronExpression', expression: cron }] } };
    }
    const keep = ['executionOrder', 'timezone', 'saveDataErrorExecution', 'saveDataSuccessExecution', 'saveManualExecutions',
                  'saveExecutionProgress', 'executionTimeout', 'errorWorkflow', 'callerPolicy'];
    const settings = { timezone: 'Europe/Paris', ...Object.fromEntries(Object.entries(w.settings || {}).filter(([k]) => keep.includes(k))) };
    await n8nApi(`/workflows/${id}`, { method: 'PUT', body: JSON.stringify({ name: w.name, nodes: w.nodes, connections: w.connections, settings }) });
    await n8nApi(`/workflows/${id}/${cron ? 'activate' : 'deactivate'}`, { method: 'POST' });
    console.log(`Automatisation ${w.id} : ${scheduleLabel(sc)}`);
    const freq = cron ? (Object.keys(FREQS).find((k) => FREQS[k] === cron) || 'custom') : 'manual';
    await sb(`automations?n8n_id=eq.${encodeURIComponent(w.id)}`, { method: 'PATCH', prefer: 'return=minimal', body: { freq, active: !!cron } });
    return automationSummary(await n8nApi(`/workflows/${id}`));
  }
}

// --- Mise en service (DSI) : les autorisations à donner UNE fois pour toute l'entreprise, déduites des audits des postes --
const SETUP_FAMILIES = [
  { key: 'microsoft', label: 'Microsoft 365', match: /microsoft 365|office|excel|word|outlook|onedrive|teams|sharepoint|microsoft-graph/i,
    how: 'Une application dans Entra ID (annuaire Microsoft) + « consentement administrateur », une seule fois pour toute l\'entreprise.',
    covers: 'Excel, Outlook, Teams, OneDrive, SharePoint', types: /^microsoft/i },
  { key: 'google', label: 'Google Workspace', match: /google workspace|google drive|gmail|google sheets|google docs|google agenda|google-workspace/i,
    how: 'Un compte de service avec « délégation à l\'échelle du domaine », autorisé une fois par l\'admin Google.',
    covers: 'Sheets, Gmail, Drive, Agenda', types: /^google/i },
];
const NOT_BUSINESS = /chrome|edge|firefox|safari|navigateur|python|node\.js|visual studio|vs code|cursor|docker|sql server|odbc|ole db|driver|nvidia|mcafee|webadvisor|installer|launcher|compatibility|photos|steam|game|jeu/i;
app.get('/api/setup', async (req, res) => {
  try {
    const dirs = fs.existsSync(AUDIT_DIR) ? fs.readdirSync(AUDIT_DIR).sort() : [];
    const audit = dirs.length ? readJson(path.join(AUDIT_DIR, dirs.at(-1), 'audit_poste.json')) : null;
    if (!audit) return res.json({ audit: null });
    let creds = [];
    try { creds = (await n8nApi('/credentials?limit=100')).data || []; } catch { /* n8n arrêté */ }
    const tools = audit.tools.map((t) => ({ name: t.app, connector: t.connector, api: t.api === 'oui', category: t.category,
                                            label: `${t.app} ${t.connector || ''} ${(t.components || []).map((c) => c.name).join(' ')}` }));
    const families = SETUP_FAMILIES.map((f) => {
      const found = tools.filter((t) => f.match.test(t.label));
      const ok = creds.filter((c) => f.types.test(c.type || ''));
      return { key: f.key, label: f.label, how: f.how, covers: f.covers, tools: found.map((t) => t.name), connected: ok.length > 0,
               credentials: ok.map((c) => c.name) };
    }).filter((f) => f.tools.length);
    const inFamily = (t) => SETUP_FAMILIES.some((f) => f.match.test(t.label));
    const others = tools.filter((t) => t.api && t.connector && !inFamily(t) && !NOT_BUSINESS.test(t.label) && t.connector !== 'n8n')
      .map((t) => ({ name: t.name, connector: t.connector, connected: creds.some((c) => (c.type || '').toLowerCase().includes(t.connector.split('-')[0])) }));
    const screen = tools.filter((t) => !t.api && !inFamily(t) && !NOT_BUSINESS.test(t.label)).map((t) => t.name);
    const total = families.reduce((n, f) => n + f.tools.length, 0) + others.length;
    res.json({ audit: { at: audit.generated_at, outils: audit.summary.outils }, families, others, screen,
               coverage: total ? Math.round((100 * families.reduce((n, f) => n + f.tools.length, 0)) / total) : 0,
               n8n_credentials_url: `${N8N_URL}/home/credentials`, credentials: creds.map((c) => ({ name: c.name, type: c.type })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Réessayer la création d'une automatisation qui avait échoué (après avoir ajouté la connexion dans n8n, par exemple).
app.post('/api/automations/:id/retry', async (req, res) => {
  const f = readFailed().find((x) => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: 'Rien à réessayer.' });
  try { await ensureN8n(); } catch (e) { return res.status(500).json({ error: e.message }); }
  const r = await new Promise((resolve) => {
    const p = spawn(PYTHON, ['-u', N8N_GEN, f.planFile, '--no-run'], { cwd: REPO_ROOT, env: { ...process.env, PYTHONUTF8: '1' } });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    p.on('close', () => resolve({ ok: /"type": "imported"/.test(out), err: err.trim().split(/\r?\n/).filter(Boolean).at(-1) || '' }));
  });
  if (!r.ok) { rememberFailed({ ...f, error: r.err || f.error }); return res.status(500).json({ error: r.err || 'création impossible' }); }
  forgetFailed(f.id);
  await sb('automations?on_conflict=user_id,n8n_id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
    body: { n8n_id: f.id, name: f.name, blocks: f.blocks, freq: 'manual', active: false } });
  res.json({ ok: true, id: f.id });
});

// Supprimer une automatisation : le flow dans n8n, son lancement programmé, sa trace dans le compte (si comptes activés).
// Refusé pendant qu'elle tourne : il faut d'abord l'arrêter.
app.delete('/api/automations/:id', async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[\w-]{1,80}$/.test(id)) return res.status(400).json({ error: 'Identifiant invalide.' });
  if (automationRun?.id === id) return res.status(409).json({ error: 'Elle tourne en ce moment : arrête-la d\'abord.' });
  try {
    if (readFailed().some((x) => x.id === id)) forgetFailed(id); // pas créée dans n8n : seulement l'oublier
    else {
      try {
        const en = (await n8nApi(`/executions?workflowId=${encodeURIComponent(id)}&status=running&limit=5`)).data || [];
        if (en.length) return res.status(409).json({ error: 'Elle tourne en ce moment : arrête-la d\'abord.' });
      } catch { /* historique indisponible : on continue */ }
      // déjà supprimée dans n8n (404) : il ne reste qu'à la retirer de Twiin
      await n8nApi(`/workflows/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch((e) => { if (!/404/.test(e.message)) throw e; });
    }
    ecrirePlans(lirePlans().filter((p) => p.id !== id));
    await sb(`automations?n8n_id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', prefer: 'return=minimal' });
    console.log(`Automatisation supprimée : ${id}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: `Suppression impossible : ${e.message}` });
  }
});

// Arrêter : l'exécution en cours (Twiin), le rejeu Holo qu'elle a lancé (souris et clavier rendus) et l'exécution dans n8n.
app.post('/api/automations/:id/stop', async (req, res) => {
  const id = req.params.id;
  const stopped = [];
  if (automationRun) { automationRun.stopped = true; killTree(automationRun.proc); automationRun = null; stopped.push('lancement'); } // notification « arrêtée »
  if (replay?.running) { killTree(replay.proc); replay.running = false; stopped.push('Holo'); }
  for (const p of webRuns) { killTree(p); stopped.push('lecture web'); }
  webRuns.clear();
  try {
    const execs = (await n8nApi(`/executions?workflowId=${encodeURIComponent(id)}&status=running&limit=20`)).data || [];
    for (const e of execs) { try { await n8nApi(`/executions/${e.id}/stop`, { method: 'POST' }); stopped.push(`n8n #${e.id}`); } catch { /* déjà fini */ } }
  } catch { /* n8n injoignable : Holo est quand même arrêté */ }
  console.log(`Automatisation ${id} arrêtée : ${stopped.join(', ') || 'rien ne tournait'}`);
  res.json({ ok: true, stopped });
});
// Arrêt d'urgence : tout ce qui pilote la souris et le clavier (rejeu Holo, automatisation lancée depuis Twiin).
app.post('/api/stop-all', (req, res) => {
  if (automationRun) { killTree(automationRun.proc); automationRun = null; }
  if (replay?.running) { killTree(replay.proc); replay.running = false; }
  res.json({ ok: true });
});

// Lancer maintenant (une exécution de test, comme à la création). Les blocs Holo prennent la souris du Mac.
// Notification macOS (Centre de notifications) : l'employé est prévenu même s'il n'est pas sur la page Twiin.
function notifier(titre, texte) {
  const q = (x) => String(x).replace(/["\\]/g, ' ');
  spawn('osascript', ['-e', `display notification "${q(texte)}" with title "${q(titre)}" sound name "Glass"`]);
}
// Durée estimée : la moyenne des exécutions passées, sinon ~2 min 30 par bloc Holo sur le Mac
const estimation = (a) => a.stats?.avg_s || Math.max(60, a.blocks.filter((b) => b.kind === 'holo').length * 150);

async function lancerAutomatisation(id, origine = 'à la main') {
  if (automationRun || n8nRun?.running) throw new Error('Une automatisation tourne déjà.');
  if (replay?.running) throw new Error('Holo est occupé par un rejeu.');
  await ensureN8n();
  const a = await automationSummary(await n8nApi(`/workflows/${encodeURIComponent(id)}`));
  const surMac = a.blocks.filter((b) => b.kind === 'holo' && b.env !== 'cloud').length;
  const est = estimation(a);
  const proc = spawn(PYTHON, ['-u', N8N_GEN, '--run', id], { cwd: REPO_ROOT });
  proc.stderr.on('data', (d) => process.stderr.write(`[n8n] ${d}`));
  const me = automationRun = { id, name: a.name, proc, startedAt: Date.now(), estimate_s: est, sur_mac: surMac, stopped: false, noeuds: [] };
  proc.stdout.on('data', (d) => String(d).split('\n').forEach((l) => { // étapes n8n terminées (pour les jumeaux guides)
    try { const e = JSON.parse(l); if (e.type === 'node') me.noeuds.push({ nom: e.name, ok: !e.error && e.status !== 'error' }); } catch { /* ligne de journal */ }
  }));
  if (origine !== 'jury') notifier('Twiin', surMac
    ? `« ${a.name} » utilise ton Mac pendant environ ${Math.ceil(est / 60)} min. Ne touche à rien, double Échap pour arrêter.`
    : `« ${a.name} » tourne en arrière-plan : tu peux continuer à travailler.`);
  proc.on('close', (code) => {
    const run = me; // sa propre référence : l'arrêt (route de Lucas) a pu vider automationRun avant
    if (automationRun === me) automationRun = null;
    const ok = code === 0 && !run?.stopped;
    console.log(`Automatisation ${id} (${origine}) : ${run?.stopped ? 'arrêtée' : ok ? 'succès' : 'échec'}`);
    backLog('automatisation', { id, origine, ok, arretee: !!run?.stopped, seconds: Math.round((Date.now() - (run?.startedAt || Date.now())) / 1000) });
    if (origine !== 'jury') notifier('Twiin', run?.stopped ? `« ${a.name} » arrêtée.` : ok ? `« ${a.name} » terminée. Ton Mac est libre.`
      : `« ${a.name} » n'a pas abouti. Détails dans Mes automatisations.`);
  });
  return automationRun;
}
app.post('/api/automations/:id/run', async (req, res) => {
  // lancée par un juré (lien public) : la notification s'affiche dans SON navigateur, pas sur le Mac de l'équipe
  try { await lancerAutomatisation(req.params.id, estVisiteur(req) ? 'jury' : 'à la main'); res.json({ ok: true }); }
  catch (e) { res.status(409).json({ error: e.message }); }
});

// --- Équipe : un espace partagé (vidéos partagées, comme un SharePoint) et un espace perso par membre ------------------
// Chaque navigateur choisit son membre (en-tête x-twiin-membre, envoyé par espace.js). Gardé sur ce poste : workflows/equipe.json.
const EQUIPE_FILE = path.join(REPO_ROOT, 'workflows', 'equipe.json');
const EQUIPE_DEFAUT = { nom: 'Équipe Twiin', membres: ['JC', 'Noah', 'Baudouin', 'Stéphane', 'Jules', 'Mathieu', 'Nolwenn'].map((p) => ({ id: slugify(p), prenom: p })), partages: [] };
const equipe = () => readJson(EQUIPE_FILE, null) || EQUIPE_DEFAUT;
const ecrireEquipe = (e) => fs.writeFileSync(EQUIPE_FILE, JSON.stringify(e, null, 1));
const membreDe = (req) => { const id = String(req.get('x-twiin-membre') || ''); return equipe().membres.find((m) => m.id === id) || null; };
app.get('/api/equipe', (req, res) => res.json({ ...equipe(), moi: membreDe(req)?.id || null }));
app.post('/api/equipe/membres', (req, res) => {
  const prenom = String(req.body?.prenom || '').trim().slice(0, 40);
  if (!prenom) return res.status(400).json({ error: 'Prénom manquant.' });
  const e = equipe();
  let id = slugify(prenom), n = 2;
  while (e.membres.some((m) => m.id === id)) id = `${slugify(prenom)}-${n++}`;
  e.membres.push({ id, prenom });
  ecrireEquipe(e);
  res.json({ id, prenom });
});
app.delete('/api/equipe/membres/:id', (req, res) => {
  const e = equipe();
  e.membres = e.membres.filter((m) => m.id !== req.params.id);
  ecrireEquipe(e);
  res.json({ ok: true });
});
app.post('/api/equipe/nom', (req, res) => { const e = equipe(); e.nom = String(req.body?.nom || '').trim().slice(0, 60) || e.nom; ecrireEquipe(e); res.json({ nom: e.nom }); });
// Partager une vidéo avec l'équipe (ou retirer le partage)
app.post('/api/equipe/partages', (req, res) => {
  const ref = path.basename(String(req.body?.ref || ''));
  if (!fs.existsSync(path.join(VIDEO_OUT, `${ref}.mp4`))) return res.status(404).json({ error: 'Vidéo introuvable.' });
  const e = equipe();
  if (!e.partages.some((x) => x.type === 'tuto' && x.ref === ref)) e.partages.unshift({ type: 'tuto', ref, par: membreDe(req)?.id || null, le: new Date().toISOString() });
  ecrireEquipe(e);
  res.json({ ok: true });
});
app.delete('/api/equipe/partages/:ref', (req, res) => {
  const e = equipe();
  e.partages = e.partages.filter((x) => x.ref !== req.params.ref);
  ecrireEquipe(e);
  res.json({ ok: true });
});

// --- Connexions aux comptes (Google : Gmail, Sheets, Drive) depuis Twiin, sans configurer n8n à la main ---------------
// Une fois pour l'entreprise : la DSI crée une « application OAuth » Google et colle son identifiant dans Mise en service
// (gardé sur le poste, workflows/connexions.json, jamais renvoyé à la page). Ensuite chaque employé clique « Connecter Google » :
// Google demande son accord, Twiin reçoit les jetons et crée les connexions Gmail, Google Sheets et Google Drive dans n8n.
const CONNEXIONS_FILE = path.join(REPO_ROOT, 'workflows', 'connexions.json');
const N8N_CONNEXIONS = path.join(REPO_ROOT, 'automation', 'n8n_connexions.py');
const GOOGLE_TYPES = [
  ['gmailOAuth2', 'Gmail', ['https://www.googleapis.com/auth/gmail.labels', 'https://www.googleapis.com/auth/gmail.addons.current.action.compose',
    'https://www.googleapis.com/auth/gmail.addons.current.message.action', 'https://mail.google.com/', 'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.compose']],
  ['googleSheetsOAuth2Api', 'Google Sheets', ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/spreadsheets']],
  ['googleDriveOAuth2Api', 'Google Drive', ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/drive.appdata',
    'https://www.googleapis.com/auth/drive.photos.readonly']],
];
const googleApp = () => readJson(CONNEXIONS_FILE, {})?.google || null;
const googleRetour = (req) => `${req.protocol}://${req.get('host')}/api/google/retour`;
const etatsOAuth = new Map(); // state → expiration (10 min)
app.get('/api/connexions', async (req, res) => {
  let creds = [];
  try { creds = (await n8nApi('/credentials?limit=100')).data || []; } catch { /* n8n arrêté */ }
  const g = googleApp();
  res.json({
    google: { app_configuree: !!(g?.client_id && g?.client_secret), client_id_fin: g?.client_id ? g.client_id.slice(-24) : null, retour: googleRetour(req),
      services: GOOGLE_TYPES.map(([type, label]) => ({ type, label, connexions: creds.filter((c) => c.type === type).map((c) => c.name) })) },
  });
});
app.post('/api/connexions/google/app', (req, res) => {
  const id = String(req.body?.client_id || '').trim(), secret = String(req.body?.client_secret || '').trim();
  if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(id) || secret.length < 10) return res.status(400).json({ error: 'Identifiant ou secret Google invalide.' });
  const c = readJson(CONNEXIONS_FILE, {});
  c.google = { client_id: id, client_secret: secret };
  fs.writeFileSync(CONNEXIONS_FILE, JSON.stringify(c), { mode: 0o600 });
  res.json({ ok: true });
});
app.get('/api/google/connecter', (req, res) => {
  const g = googleApp();
  if (!g) return res.redirect('/mise-en-service.html#connexions');
  const state = crypto.randomBytes(18).toString('base64url');
  etatsOAuth.set(state, Date.now() + 10 * 60e3);
  const scopes = ['openid', 'email', ...new Set(GOOGLE_TYPES.flatMap(([, , s]) => s))];
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  Object.entries({ client_id: g.client_id, redirect_uri: googleRetour(req), response_type: 'code', scope: scopes.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state }).forEach(([k, v]) => u.searchParams.set(k, v));
  res.redirect(u.toString());
});
app.get('/api/google/retour', async (req, res) => {
  const fin = (q) => res.redirect(`/mise-en-service.html?${q}#connexions`);
  try {
    const { code, state, error } = req.query;
    if (error) return fin(`google=refus`);
    if (!state || !(etatsOAuth.get(state) > Date.now())) return fin('google=expire');
    etatsOAuth.delete(state);
    const g = googleApp();
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: g.client_id, client_secret: g.client_secret, redirect_uri: googleRetour(req), grant_type: 'authorization_code' }) });
    const jetons = await r.json();
    if (!r.ok || !jetons.refresh_token) throw new Error(jetons.error_description || jetons.error || 'pas de jeton de rafraîchissement');
    let email = '';
    try { email = JSON.parse(Buffer.from(String(jetons.id_token || '').split('.')[1] || '', 'base64url').toString()).email || ''; } catch { /* sans adresse */ }
    const nom = `Google${email ? ` · ${email}` : ''}`;
    const { id_token, ...tokenData } = jetons; // le jeton d'identité ne sert pas à n8n
    const demandes = GOOGLE_TYPES.map(([type]) => ({ type, name: nom, data: { clientId: g.client_id, clientSecret: g.client_secret, oauthTokenData: tokenData } }));
    const out = await new Promise((resolve) => {
      const p = spawn(PYTHON, ['-u', N8N_CONNEXIONS], { cwd: REPO_ROOT, env: { ...process.env, PYTHONUTF8: '1' } });
      let o = ''; p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', () => {});
      p.on('close', (c) => resolve({ ok: c === 0, o }));
      p.stdin.end(JSON.stringify(demandes));
    });
    if (!out.ok) throw new Error((() => { try { return JSON.parse(out.o.trim().split('\n').at(-1)).error; } catch { return 'import dans n8n impossible'; } })());
    console.log(`Connexions Google créées dans n8n (${GOOGLE_TYPES.map(([, l]) => l).join(', ')})`);
    fin('google=ok');
  } catch (e) {
    console.error('Connexion Google :', e.message);
    fin(`google=erreur&detail=${encodeURIComponent(String(e.message).slice(0, 160))}`);
  }
});

// --- Marque de l'entreprise cliente : nom, logo et couleur, appliqués au SaaS (shell.js) et aux vidéos de formation.
// Tout reste sur le poste (workflows/marque.json) ; copié dans tuto/video/public/ pour le rendu Remotion.
const MARQUE_FILE = path.join(REPO_ROOT, 'workflows', 'marque.json');
const MARQUE_LOGOS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg', 'image/webp': 'webp' };
const marqueLue = () => readJson(MARQUE_FILE, null);
// Charte : couleur principale (boutons, liens), secondaire (fonds, puces), police (Google Fonts, liste fermée), formes (arrondis)
const MARQUE_POLICES = ['Google Sans Flex', 'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins', 'DM Sans', 'Work Sans', 'IBM Plex Sans', 'Source Sans 3', 'Noto Sans', 'Manrope', 'Figtree'];
const MARQUE_FORMES = ['carre', 'doux', 'arrondi'];
const marquePublique = (m) => ({ nom: m?.nom || '', couleur: m?.couleur || null, couleur2: m?.couleur2 || null, police: m?.police || null, forme: m?.forme || null,
  logo: m?.logo ? `/marque/logo?v=${m.v || 0}` : null });
function marqueVersVideo(m) {
  const pub = path.join(VIDEO_DIR, 'public');
  for (const f of fs.readdirSync(pub).filter((x) => /^marque(-logo\.\w+)?\.json$|^marque-logo\.\w+$/.test(x))) fs.rmSync(path.join(pub, f));
  if (!m) return;
  if (m.logo) fs.copyFileSync(path.join(REPO_ROOT, 'workflows', m.logo), path.join(pub, m.logo));
  fs.writeFileSync(path.join(pub, 'marque.json'), JSON.stringify({ nom: m.nom || '', couleur: m.couleur || null, couleur2: m.couleur2 || null, police: m.police || null, logo: m.logo || null }));
}
app.get('/api/marque', (req, res) => res.json({ ...marquePublique(marqueLue()), polices: MARQUE_POLICES }));
app.get('/marque/logo', (req, res) => {
  const m = marqueLue();
  if (!m?.logo) return res.status(404).end();
  res.sendFile(path.join(REPO_ROOT, 'workflows', m.logo));
});
app.post('/api/marque', express.json({ limit: '3mb' }), (req, res) => {
  try {
    const b = req.body || {};
    if (b.effacer) {
      const m = marqueLue();
      if (m?.logo) fs.rmSync(path.join(REPO_ROOT, 'workflows', m.logo), { force: true });
      fs.rmSync(MARQUE_FILE, { force: true });
      marqueVersVideo(null);
      return res.json(marquePublique(null));
    }
    const avant = marqueLue() || {};
    const hexa = (k) => (k in b ? (/^#[0-9a-f]{6}$/i.test(b[k] || '') ? b[k].toLowerCase() : null) : avant[k] || null);
    const m = { nom: String(b.nom ?? avant.nom ?? '').trim().slice(0, 60), couleur: hexa('couleur'), couleur2: hexa('couleur2'),
      police: 'police' in b ? (MARQUE_POLICES.includes(b.police) ? b.police : null) : avant.police || null,
      forme: 'forme' in b ? (MARQUE_FORMES.includes(b.forme) ? b.forme : null) : avant.forme || null, logo: avant.logo || null, v: Date.now() };
    if (typeof b.logo === 'string' && b.logo.startsWith('data:')) {
      const [, type, b64] = b.logo.match(/^data:([\w/+.-]+);base64,(.+)$/) || [];
      if (!MARQUE_LOGOS[type]) return res.status(400).json({ error: 'Logo en PNG, JPG, SVG ou WebP.' });
      const buf = Buffer.from(b64, 'base64');
      if (buf.length > 2e6) return res.status(400).json({ error: 'Logo trop lourd (2 Mo au plus).' });
      if (avant.logo) fs.rmSync(path.join(REPO_ROOT, 'workflows', avant.logo), { force: true });
      m.logo = `marque-logo.${MARQUE_LOGOS[type]}`;
      fs.writeFileSync(path.join(REPO_ROOT, 'workflows', m.logo), buf);
    } else if (b.logo === null) {
      if (avant.logo) fs.rmSync(path.join(REPO_ROOT, 'workflows', avant.logo), { force: true });
      m.logo = null;
    }
    fs.writeFileSync(MARQUE_FILE, JSON.stringify(m, null, 1));
    marqueVersVideo(m);
    console.log(`Marque : ${m.nom || '(sans nom)'} ${m.couleur || ''}${m.logo ? ' + logo' : ''}`);
    res.json(marquePublique(m));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Titres courts : les titres longs déjà enregistrés (« Analyser un cas Awwwards avec Claude et… ») passent une fois par
// le petit modèle ; le résultat est gardé sur le poste. Les pages l'affichent, le titre complet reste au survol.
const TITRES_FICHIER = path.join(REPO_ROOT, 'workflows', 'titres-courts.json');
const TITRE_DEJA_COURT = (t) => t.split(/\s+/).length <= 5 && !/\(|\bavec\b|\bvia\b|\bsur (?:google|chrome|excel)/i.test(t);
let titresEnCours = null;
app.post('/api/titres-courts', async (req, res) => {
  try { res.json({ titres: await raccourcir(req.body?.titres || []) }); } catch (e) { res.status(500).json({ error: e.message }); }
});
async function raccourcir(titres) {
  {
    const cache = readJson(TITRES_FICHIER, {});
    const demandes = [...new Set(titres.map((t) => String(t).trim().slice(0, 300)).filter(Boolean))].slice(0, 40);
    const manquants = demandes.filter((t) => !(t in cache) && !TITRE_DEJA_COURT(t));
    if (manquants.length) {
      while (titresEnCours) await titresEnCours.catch(() => {}); // une seule requête au modèle à la fois
      const encore = manquants.filter((t) => !(t in readJson(TITRES_FICHIER, {})));
      if (encore.length) {
        titresEnCours = client.chat.completions.create({
          model: HF_MODEL, max_tokens: 3000, temperature: 0, reasoning_effort: REASONING_EFFORT,
          messages: [{ role: 'user', content: `Rewrite each French title below as a SHORT, explicit French title: 2 to 5 words, no app or tool names ` +
            `(Claude, Chrome, Excel, Google Sheets, LinkedIn… are shown as logos), no parentheses, no final period. Keep the real subject ` +
            `(company, client, topic). Examples: « Analyser un cas Awwwards avec Claude et demander des inspirations de design » → « Inspirations design Awwwards » ; ` +
            `« Veille concurrence L'Oréal (LinkedIn → Google Sheets → OneNote) » → « Veille concurrence L'Oréal ».\n` +
            `Return ONLY JSON: {"titres": ["...", ...]} in the same order.\n\n${encore.map((t, i) => `${i + 1}. ${t}`).join('\n')}` }],
        });
        try {
          const r = await titresEnCours;
          const out = parseWorkflows(r.choices?.[0]?.message?.content || '').result?.titres || [];
          const c = readJson(TITRES_FICHIER, {});
          encore.forEach((t, i) => { const v = String(out[i] || '').trim().replace(/[.。]$/, ''); if (v && v.length < t.length) c[t] = v.slice(0, 60); else c[t] = t; });
          fs.writeFileSync(TITRES_FICHIER, JSON.stringify(c, null, 1));
        } finally { titresEnCours = null; }
      }
    }
    const c = readJson(TITRES_FICHIER, {});
    return Object.fromEntries(demandes.map((t) => [t, c[t] || t]));
  }
}

// --- Personnaliser une automatisation : changer ce sur quoi elle travaille ---------------------------------------------
// Une automatisation est créée à partir d'UNE tâche filmée (ex. la veille sur L'Oréal). On en tire une fois un modèle
// général où le sujet devient {{cible}} (le petit modèle, peu cher), puis l'employé choisit ses cibles (« LVMH, Kering… »
// ou « le luxe », que Twiin transforme en liste). Le workflow n8n est reconstruit avec une chaîne d'étapes par cible.
// Le plan d'origine n'est jamais modifié (veille-loreal.json sert aussi d'exemple au modèle) : tout vit dans automation/cibles/.
const CIBLES_DIR = path.join(REPO_ROOT, 'automation', 'cibles');
const MAX_CIBLES = 8;
function planDe(id) {
  for (const f of fs.existsSync(N8N_PLANS) ? fs.readdirSync(N8N_PLANS).filter((x) => x.endsWith('.json')) : []) {
    const p = readJson(path.join(N8N_PLANS, f));
    if (p && (p.id || ('twiin' + slugify(p.name || '').replace(/-/g, '')).slice(0, 16)) === id) return p;
  }
  return null;
}
const ciblesFichier = (id) => path.join(CIBLES_DIR, `${id.replace(/[^\w-]/g, '')}.json`);
const GENERALISER = `You receive an automation plan (JSON) that was recorded for ONE specific subject: a company, a brand, a person, a product, a city, a website… Your job: make it reusable for ANY subject of the same kind.
Return ONLY a JSON object:
{"valeur": "<the specific subject, as written, e.g. L'Oréal>", "type": "<the kind of subject in French, singular, lowercase, e.g. entreprise>",
 "label": "<short French label for the list of subjects, e.g. Entreprises suivies>", "nom": "<the plan name in French without the subject and without parentheses, e.g. Veille concurrence>",
 "exemple": "<a French example of a group of such subjects, e.g. le luxe>", "blocks": [ ...the same blocks... ]}
Rules for "blocks": keep EXACTLY the same blocks, order, types, names, fields and references like {{Holo — lire LinkedIn.entreprise}}. Only replace every mention of the subject with the placeholder {{cible}}.
If a URL is specific to the subject (e.g. https://www.linkedin.com/company/loreal/about/), replace it with an instruction to find that page for {{cible}} (e.g. "search LinkedIn for the official company page of {{cible}} and open its « À propos » tab").
In "verify" rules, a pattern that checks the subject becomes "{{cible}}". Do not translate, do not add or remove steps.
If the plan is not about one specific subject, return {"valeur": null}.`;
async function modeleDe(id) {
  const f = ciblesFichier(id);
  const deja = readJson(f);
  if (deja?.modele) return deja;
  const plan = planDe(id);
  if (!plan) return { modele: { valeur: null } };
  const { data: resp } = await client.chat.completions.create({
    model: HF_MODEL, max_tokens: MAX_OUTPUT_TOKENS, temperature: 0, reasoning_effort: REASONING_EFFORT,
    messages: [{ role: 'system', content: GENERALISER }, { role: 'user', content: JSON.stringify({ name: plan.name, blocks: plan.blocks }) }],
  }).withResponse();
  const m = parseWorkflows(resp.choices?.[0]?.message?.content || '').result || {};
  const ok = m.valeur && Array.isArray(m.blocks) && m.blocks.length === plan.blocks.length && JSON.stringify(m.blocks).includes('{{cible}}');
  const modele = ok ? { valeur: m.valeur, type: m.type || 'cible', label: m.label || 'Cibles', nom: m.nom || plan.name, exemple: m.exemple || '', blocks: m.blocks }
                    : { valeur: null };
  const res = { modele, cibles: ok ? [m.valeur] : [] };
  fs.mkdirSync(CIBLES_DIR, { recursive: true });
  fs.writeFileSync(f, JSON.stringify(res, null, 2));
  console.log(`Personnalisation ${id} : ${ok ? `sujet « ${m.valeur} » (${modele.type})` : 'pas de sujet unique'} · ${resp.usage?.cost ?? '?'} $`);
  return res;
}
// Une chaîne d'étapes par cible ; avec plusieurs cibles, chaque étape prend le nom « … · cible » et ses références suivent.
function deroulerPlan(id, modele, cibles, plan) {
  const echapper = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/['’]/g, "['’]"); // LinkedIn écrit souvent L’Oréal
  const blocks = cibles.flatMap((v) => {
    const suffixe = cibles.length > 1 ? ` · ${v}` : '';
    const noms = modele.blocks.map((b) => b.name);
    const remplacer = (x) => {
      if (typeof x !== 'string') return x;
      let t = x.replaceAll('{{cible}}', v);
      if (suffixe) for (const n of noms) { t = t.replaceAll(`{{${n}.`, `{{${n}${suffixe}.`); if (t === n) t = n + suffixe; }
      return t;
    };
    return modele.blocks.map((b0) => {
      const b = JSON.parse(JSON.stringify(b0), (k, x) => (k === 'pattern' && typeof x === 'string' ? x.replaceAll('{{cible}}', echapper(v)) : x));
      const out = JSON.parse(JSON.stringify(b), (k, x) => remplacer(x));
      // plusieurs cibles : une branche n8n par cible ; une valeur douteuse écarte CETTE cible seulement, les autres continuent
      if (cibles.length > 1) { out.branche = v; if (out.type === 'verify') out.on_problem = 'skip'; }
      return out;
    });
  });
  const nom = `${modele.nom} — ${cibles.length <= 2 ? cibles.join(' et ') : `${cibles.length} ${modele.type}s`}`;
  return { ...plan, id, name: nom, blocks };
}
app.get('/api/automations/:id/cibles', async (req, res) => {
  try {
    const { modele, cibles } = await modeleDe(req.params.id);
    res.json(modele.valeur ? { type: modele.type, label: modele.label, exemple: modele.exemple, cibles } : { cibles: null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// « le luxe » → une liste de cibles proposées, que l'employé garde ou retire
app.post('/api/automations/:id/cibles/proposer', async (req, res) => {
  try {
    const groupe = String(req.body?.groupe || '').slice(0, 120).trim();
    if (!groupe) return res.status(400).json({ error: 'Écris un groupe, par exemple « le luxe ».' });
    const { modele } = await modeleDe(req.params.id);
    const { data: resp } = await client.chat.completions.create({
      model: HF_MODEL, max_tokens: 2000, temperature: 0, reasoning_effort: REASONING_EFFORT,
      messages: [{ role: 'user', content: `List the ${MAX_CIBLES} most important ${modele.type || 'items'} (French context) matching: « ${groupe} ». ` +
        `Use their usual short public names. Return ONLY JSON: {"valeurs": ["...", "..."]}` }],
    }).withResponse();
    const v = parseWorkflows(resp.choices?.[0]?.message?.content || '').result?.valeurs;
    res.json({ valeurs: (Array.isArray(v) ? v : []).map((x) => String(x).trim()).filter(Boolean).slice(0, MAX_CIBLES) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Enregistrer les cibles : reconstruit le workflow (même id, même horaire)
app.post('/api/automations/:id/cibles', async (req, res) => {
  const id = String(req.params.id || '');
  try {
    if (automationRun?.id === id) return res.status(409).json({ error: 'Elle tourne : arrête-la avant de la modifier.' });
    const cibles = [...new Set((req.body?.cibles || []).map((x) => String(x).trim().slice(0, 80)).filter(Boolean))].slice(0, MAX_CIBLES);
    if (!cibles.length) return res.status(400).json({ error: 'Garde au moins une cible.' });
    const { modele } = await modeleDe(id);
    if (!modele.valeur) return res.status(400).json({ error: 'Cette automatisation ne se personnalise pas.' });
    await ensureN8n();
    const avant = await automationSummary(await n8nApi(`/workflows/${encodeURIComponent(id)}`));
    const plan = deroulerPlan(id, modele, cibles, planDe(id));
    const planFile = path.join(CIBLES_DIR, `${id.replace(/[^\w-]/g, '')}.plan.json`);
    fs.writeFileSync(planFile, JSON.stringify(plan, null, 2));
    const r = await new Promise((resolve) => {
      const p = spawn(PYTHON, ['-u', N8N_GEN, planFile, '--no-run'], { cwd: REPO_ROOT, env: { ...process.env, PYTHONUTF8: '1' } });
      let out = '', err = '';
      p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
      p.on('close', () => resolve({ ok: /"type": "imported"/.test(out), err: err.trim().split(/\r?\n/).filter(Boolean).at(-1) || '' }));
    });
    if (!r.ok) return res.status(500).json({ error: r.err || 'reconstruction impossible' });
    fs.writeFileSync(ciblesFichier(id), JSON.stringify({ modele, cibles }, null, 2));
    if (avant.active && avant.schedule?.type !== 'manual') await planifier(id, avant.schedule); // l'import remet le flow en pause
    await sb(`automations?n8n_id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', prefer: 'return=minimal', body: { name: plan.name, blocks: plan.blocks } });
    console.log(`Personnalisation ${id} : ${cibles.join(', ')}`);
    res.json(await automationSummary(await n8nApi(`/workflows/${encodeURIComponent(id)}`)));
  } catch (e) { console.error(e.message); res.status(500).json({ error: e.message }); }
});

// Arrêter : Holo ET l'exécution n8n (sinon n8n relance le bloc suivant)
async function arreterTout() {
  if (automationRun) { automationRun.stopped = true; killTree(automationRun.proc); }
  if (n8nRun?.running) killTree(n8nRun.proc);
  if (replay?.running) killTree(replay.proc);
  for (const p of webRuns) killTree(p); // Holo dans un navigateur invisible (découverte, lectures web)
  webRuns.clear();
  let stoppees = 0;
  try {
    const en = (await n8nApi('/executions?status=running&limit=20')).data || [];
    for (const e of en) { await n8nApi(`/executions/${e.id}/stop`, { method: 'POST' }).catch(() => {}); stoppees++; }
  } catch { /* n8n arrêté : rien à couper */ }
  setTimeout(() => { if (replay?.running) replay.proc.kill('SIGKILL'); }, 5000);
  return stoppees;
}
app.post('/api/automations/stop', async (req, res) => res.json({ ok: true, executions_arretees: await arreterTout() }));

// Relancer l'étape échouée : n8n rejoue l'exécution en échec à partir du nœud qui a planté. Les étapes déjà
// réussies ne sont pas refaites (testé : même date de rapport avant et après relance).
app.post('/api/automations/:id/retry', async (req, res) => {
  try {
    if (automationRun || n8nRun?.running) return res.status(409).json({ error: 'Une automatisation tourne déjà.' });
    if (replay?.running) return res.status(409).json({ error: 'Holo est occupé par un rejeu.' });
    await ensureN8n();
    const en = (await n8nApi(`/executions?workflowId=${encodeURIComponent(req.params.id)}&status=error&limit=1`)).data || [];
    if (!en.length) return res.status(404).json({ error: 'Aucune exécution en échec à relancer.' });
    await n8nApi(`/executions/${en[0].id}/retry`, { method: 'POST' });
    res.json({ ok: true, execution: en[0].id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Lancement programmé à un créneau (une fois) : pause déjeuner, fin de journée, demain matin…
const PLANS_PATH = path.join(REPO_ROOT, 'workflows', 'automations-programmees.json');
const lirePlans = () => { try { return JSON.parse(fs.readFileSync(PLANS_PATH, 'utf8')); } catch { return []; } };
const ecrirePlans = (p) => { fs.mkdirSync(path.dirname(PLANS_PATH), { recursive: true }); fs.writeFileSync(PLANS_PATH, JSON.stringify(p, null, 2)); };
app.post('/api/automations/:id/plan', (req, res) => {
  const at = new Date(req.body?.at);
  if (Number.isNaN(at.getTime()) || at.getTime() < Date.now() - 60000) return res.status(400).json({ error: 'Heure invalide.' });
  const plans = lirePlans().filter((p) => p.id !== req.params.id);
  plans.push({ id: req.params.id, name: req.body?.name || req.params.id, at: at.toISOString(), prevenu: false });
  ecrirePlans(plans);
  res.json({ ok: true, at: at.toISOString() });
});
app.delete('/api/automations/:id/plan', (req, res) => { ecrirePlans(lirePlans().filter((p) => p.id !== req.params.id)); res.json({ ok: true }); });
setInterval(async () => {
  const plans = lirePlans();
  if (!plans.length) return;
  let change = false;
  for (const p of plans) {
    const reste = new Date(p.at).getTime() - Date.now();
    if (!p.prevenu && reste <= 2 * 60000 && reste > 0) { // prévenir 2 min avant
      notifier('Twiin', `Dans 2 min, « ${p.name} » va utiliser ton Mac. Pour reporter : Mes automatisations.`);
      p.prevenu = true; change = true;
    }
    if (reste <= 0 && !automationRun && !n8nRun?.running && !replay?.running) {
      p.lance = true; change = true;
      lancerAutomatisation(p.id, 'programmée').catch((e) => notifier('Twiin', `« ${p.name} » n'a pas pu démarrer : ${e.message}`));
    }
  }
  if (change) ecrirePlans(plans.filter((p) => !p.lance));
}, 20000);

// État pour le bandeau commun des pages : ce qui tourne, depuis quand, temps estimé, prochain lancement programmé
// --- Jumeaux guides : pendant une automatisation, Iris et Ilo suivent la souris et disent ce qui se passe -----------
// (fenêtre transparente de l'app Mac, desktop/guide). L'étape Holo en cours (en anglais pour l'agent) devient une phrase
// courte en français, traduite une fois par le petit modèle et gardée sur le poste.
const PHRASES_FICHIER = path.join(REPO_ROOT, 'workflows', 'guide-phrases.json');
const phrasesEnCours = new Set();
function phraseGuide(etape) {
  const cache = readJson(PHRASES_FICHIER, {});
  if (cache[etape]) return cache[etape];
  if (!phrasesEnCours.has(etape)) {
    phrasesEnCours.add(etape);
    client.chat.completions.create({ model: HF_MODEL, max_tokens: 400, temperature: 0, reasoning_effort: REASONING_EFFORT,
      messages: [{ role: 'user', content: `Résume cette consigne donnée à un agent qui utilise l'ordinateur en UNE phrase courte en français (12 mots maximum), ` +
        `à la première personne du pluriel, au présent, sans guillemets ni emoji. Exemple : « On ouvre la page LinkedIn de L'Oréal et on lit ses chiffres. »\n\n${etape.slice(0, 1200)}` }] })
      .then((r) => {
        const t = String(r.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim().split('\n')[0].replace(/^[«"\s]+|[»"\s]+$/g, '');
        if (t && !/aucune consigne|pas de consigne|rien à résumer/i.test(t)) { const c = readJson(PHRASES_FICHIER, {}); c[etape] = t.slice(0, 140); fs.writeFileSync(PHRASES_FICHIER, JSON.stringify(c, null, 1)); }
      }).catch(() => {}).finally(() => phrasesEnCours.delete(etape));
  }
  return null;
}
app.get('/api/guide', (req, res) => {
  const r = automationRun;
  if (!r && !replay?.running) return res.json({ actif: false });
  const evs = replay?.running ? readJsonl(replay.events) : [];
  const etape = [...evs].reverse().find((e) => e.type === 'step_start');
  const session = [...evs].reverse().find((e) => e.type === 'session')?.url || null;
  const bloc = replay?.running ? String(replay.name || '').replace(/^n8n\s+/, '') : null;
  // étapes envoyées ensemble (« 3 étapes envoyées ensemble ») : on résume la vraie consigne, lue dans l'événement de départ
  const depart = evs.find((e) => e.type === 'start');
  const consigne = etape?.step && !/envoy[ée]es ensemble/i.test(etape.step) ? String(etape.step)
    : Array.isArray(depart?.steps) ? depart.steps.join(' ') : null;
  let phrase = consigne ? phraseGuide(consigne) : null;
  if (!phrase && bloc) phrase = bloc.replace(/^Holo\s*[—-]\s*/i, '').replace(/^./, (c) => c.toUpperCase()) + '…';
  if (!phrase) { const der = r?.noeuds?.at(-1); phrase = der ? `${der.nom.replace(/^Holo\s*[—-]\s*/i, '')} : ${der.ok ? 'fait' : 'à vérifier'}.` : 'On prépare l\'automatisation…'; }
  res.json({ actif: true, titre: r?.name || bloc || 'Holo', sur_mac: replay?.running ? replay.env !== 'cloud' : !!r?.sur_mac, cloud: replay?.running && replay.env === 'cloud',
    bloc, phrase, index: Number(etape?.index) || null, total: Number(etape?.total) || null, faits: (r?.noeuds || []).map((n) => n.nom),
    direct: session, depuis_s: r ? Math.round((Date.now() - r.startedAt) / 1000) : null });
});

app.get('/api/automations/etat', (req, res) => {
  const r = automationRun;
  const prochain = lirePlans().sort((x, y) => x.at.localeCompare(y.at))[0] || null;
  if (r) return res.json({ running: true, name: r.name, sur_mac: r.sur_mac, elapsed_s: Math.round((Date.now() - r.startedAt) / 1000), estimate_s: r.estimate_s, prochain });
  if (n8nRun?.running) return res.json({ running: true, name: 'Création d\'une automatisation', sur_mac: replay?.running && replay.env !== 'cloud' ? 1 : 0, elapsed_s: null, estimate_s: null, prochain });
  if (replay?.running) return res.json({ running: true, name: 'Holo', sur_mac: replay.env !== 'cloud' ? 1 : 0, elapsed_s: null, estimate_s: null, prochain });
  res.json({ running: false, prochain });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// BACK : tout ce qui est technique (coûts, modèles, journaux, scans complets, rejeux, n8n) — hors parcours employé
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const readJson = (f, dflt = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return dflt; } };
const readJsonl = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
app.get('/api/back', async (req, res) => {
  const runsDir = path.join(WORKFLOWS_DIR, 'runs');
  const runFiles = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).sort().reverse() : [];
  const last = readJson(LAST_RUN_PATH, {});
  const sessions = (fs.existsSync(SESSIONS_DIR) ? fs.readdirSync(SESSIONS_DIR).sort().reverse().slice(0, 10) : []).map((id) => {
    const dir = path.join(SESSIONS_DIR, id);
    let frames = 0;
    try { frames = fs.existsSync(path.join(dir, 'frames.jsonl')) ? fs.readFileSync(path.join(dir, 'frames.jsonl'), 'utf8').split('\n').filter(Boolean).length
                                                                   : (readJson(path.join(dir, 'frames.json'), {}).frames || []).length; } catch { /* rien */ }
    const actions = readActions(dir);
    const start = actions.find((e) => e.type === 'start');
    return { id, frames, actions: actions.length, clicks: actions.filter((e) => e.type === 'click').length,
             displays: start?.displays?.length ?? null, permissions: start ? { clics_clavier: !!start.clicks_and_keys, accessibilite: !!start.accessibility } : null };
  });
  const auditDirs = fs.existsSync(AUDIT_DIR) ? fs.readdirSync(AUDIT_DIR).sort() : [];
  const log = readJsonl(BACK_LOG);
  const costs = {};
  for (const e of log) if (typeof e.cost_usd === 'number') costs[e.kind] = (costs[e.kind] || 0) + e.cost_usd;
  res.json({
    services: {
      twiin: true, n8n: await n8nUp(), n8n_url: N8N_URL,
      cles: { HF_TOKEN: !!process.env.HF_TOKEN, HAI_API_KEY: !!process.env.HAI_API_KEY, ELEVENLABS_API_KEY: !!process.env.ELEVENLABS_API_KEY,
              N8N_LOCAL_API_KEY: !!process.env.N8N_LOCAL_API_KEY, TWIIN_LOCAL_TOKEN: !!process.env.TWIIN_LOCAL_TOKEN },
      modele: HF_MODEL, mode: RECORDER_MODE, voix: ELEVEN_VOICE, transcription: ELEVEN_STT_MODEL,
      raccourci: ((fs.existsSync(path.join(WORKFLOWS_DIR, 'hotkey.log')) ? fs.readFileSync(path.join(WORKFLOWS_DIR, 'hotkey.log'), 'utf8').trim().split('\n').at(-1) : null)),
    },
    costs, log: log.slice(-80).reverse(),
    last_analysis: last.meta ? { ...last.meta, action_log: (last.action_log || '').split('\n').slice(0, 300), ocr_chars: (last.ocr_transcript || '').length,
                                 ocr_extract: (last.ocr_transcript || '').slice(0, 3000) } : null,
    sessions,
    profile: readJson(PROFILE_PATH),
    audit: auditDirs.length ? readJson(path.join(AUDIT_DIR, auditDirs.at(-1), 'audit_poste.json')) : null,
    replays: runFiles.filter((f) => /-(local|cloud)\.json$/.test(f)).slice(0, 10).map((f) => {
      const r = readJson(path.join(runsDir, f), {});
      return { file: f, workflow: r.workflow, mode: r.mode, status: r.status, seconds: r.seconds, restarts: r.restarts,
               share_urls: r.share_urls, usage: r.usage, blocked: r.blocked_actions, screen_switches: (r.screen_switches || []).length,
               steps: (r.steps || []).map((s) => ({ step: s.step, status: s.status, seconds: s.seconds, answer: s.answer })) };
    }),
    n8n: runFiles.filter((f) => /n8n-(create|events)\.jsonl$/.test(f)).slice(0, 10).map((f) => ({ file: f, events: readJsonl(path.join(runsDir, f)).slice(-40) })),
    tuto: tutoJob,
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// BRIQUE AUDIT v2 (twiin/audit, voir son CLAUDE.md) : temps 0 dirigeant, temps 1 outils, temps 2 onboarding, temps 3
// résultat. Les calculs (catalogue, score, croisement, questions) sont dans le module Python twiin_audit : une seule
// version des règles. Tout reste sur le poste (workflows/audit2/), dont la transcription de la question 7.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const AUDIT2_DIR = path.join(REPO_ROOT, 'workflows', 'audit2');
const AUDIT_PKG = path.join(REPO_ROOT, 'audit');
const POSTE_ID = 'poste_' + crypto.createHash('sha256').update(`${os.hostname()}|${os.userInfo().username}`).digest('hex').slice(0, 6); // pseudonyme
const a2 = (f) => path.join(AUDIT2_DIR, f);
const readA2 = (f, d = null) => { try { return JSON.parse(fs.readFileSync(a2(f), 'utf8')); } catch { return d; } };
const writeA2 = (f, v) => { fs.mkdirSync(AUDIT2_DIR, { recursive: true }); fs.writeFileSync(a2(f), JSON.stringify(v, null, 2) + '\n'); };

function auditPy(args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn(PYTHON, ['-m', 'twiin_audit.cli', ...args], { cwd: AUDIT_PKG });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(err.trim().split('\n').at(-1) || `code ${code}`));
      try { resolve(JSON.parse(out)); } catch (e) { reject(e); }
    });
    if (input !== undefined) p.stdin.end(JSON.stringify(input)); else p.stdin.end();
  });
}

const DIRIGEANT_DEFAUT = { objectif: 'gagner_du_temps', irritants: [], cout_horaire: 35, consentement_entreprise: false,
                           sources_autorisees: ['logiciel_installe'] };
// Temps 0 · dirigeant (une fois par entreprise) : objectif, irritants, coût horaire, consentement et sources autorisées
app.get('/api/audit/dirigeant', (req, res) => res.json({ dirigeant: readA2('dirigeant.json', DIRIGEANT_DEFAUT), defaut: !readA2('dirigeant.json') }));
app.post('/api/audit/dirigeant', (req, res) => {
  const d = req.body || {};
  const dirigeant = {
    objectif: ['gagner_du_temps', 'reduire_les_erreurs', 'absorber_plus_de_volume', 'preparer_facturation_electronique'].includes(d.objectif) ? d.objectif : 'gagner_du_temps',
    irritants: (d.irritants || []).map(String).filter(Boolean).slice(0, 20),
    cout_horaire: Math.max(0, Math.min(500, Number(d.cout_horaire) || 35)),
    consentement_entreprise: !!d.consentement_entreprise,
    sources_autorisees: (d.sources_autorisees || []).filter((x) => ['logiciel_installe', 'historique_navigateur', 'connecteur_google_workspace', 'telechargement'].includes(x)),
  };
  writeA2('dirigeant.json', dirigeant);
  backLog('audit-dirigeant', { objectif: dirigeant.objectif, cout_horaire: dirigeant.cout_horaire, sources: dirigeant.sources_autorisees });
  res.json({ dirigeant });
});

// Temps 1 · audit outils passif : logiciels installés (+ jours d'utilisation), outils web vus dans Chrome (domaines seulement)
app.get('/api/audit/outils', (req, res) => res.json(readA2('outils.json', { applications: [], resume: null })));
app.post('/api/audit/outils', async (req, res) => {
  try {
    const dir = readA2('dirigeant.json', DIRIGEANT_DEFAUT);
    const autorise = (s) => (dir.sources_autorisees || []).includes(s);
    const navigateur = !!req.body?.navigateur && autorise('historique_navigateur');
    const usage = !!req.body?.usage;
    const out = path.join(AUDIT2_DIR, 'scan');
    fs.mkdirSync(out, { recursive: true });
    const t0 = Date.now();
    await new Promise((resolve, reject) => {
      const p = spawn(PYTHON, [AUDIT_SCRIPT, '--out', out, ...(usage ? ['--usage'] : [])]);
      let err = '';
      p.stderr.on('data', (d) => { err += d; });
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim().split('\n').at(-1) || `code ${code}`))));
    });
    const r = await auditPy(['outils', '--scan', path.join(out, 'audit_poste.json'), ...(navigateur ? ['--navigateur'] : [])]);
    const result = { ...r, genere_le: new Date().toISOString(), avec_usage: usage, avec_navigateur: navigateur,
                     navigateur_refuse: !!req.body?.navigateur && !navigateur };
    writeA2('outils.json', result);
    backLog('audit-outils', { seconds: (Date.now() - t0) / 1000, usage, navigateur, ...r.resume });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: `Audit des outils impossible : ${e.message}` });
  }
});

// La fiche v2 en cours : poste pseudonymisé, consentement, dirigeant, outils (confirmés ou ajoutés par l'employé), tâches
function ficheEnCours(rep = readA2('reponses.json', {})) {
  const dir = readA2('dirigeant.json', DIRIGEANT_DEFAUT);
  const outils = readA2('outils.json', { applications: [] });
  const confirmes = new Set(rep.outils_confirmes || []);
  const apps = (outils.applications || []).map((a) => (a.filtre_metier?.est_metier && rep.outils_confirmes
    ? { ...a, confirmee_par_employe: confirmes.has(a.id) } : a));
  for (const x of rep.outils_ajoutes || []) { // « + ajouter » : déclaré par l'employé
    if (apps.some((a) => a.id === x.id)) continue;
    apps.push({ id: x.id, nom: x.nom, type: 'saas_web', sources_detection: ['declaration_employe'], usage: { frequence: 'inconnu' },
                filtre_metier: { est_metier: true, categorie: 'autre', methode: 'validation_humaine', confiance: 0.8, a_valider: false },
                api: { disponibilite: 'inconnue', confiance: 0.3 }, duplication: { strategie: 'hybride', dans_process_observe: false, statut: 'a_faire' },
                confirmee_par_employe: true });
  }
  const metier = apps.filter((a) => a.filtre_metier?.est_metier);
  const disp = metier.map((a) => a.api?.disponibilite);
  return {
    audit_id: `aud_${new Date().toISOString().slice(0, 10)}_${POSTE_ID.slice(-4)}`, date_audit: new Date().toISOString(), version_schema: '2.0',
    entreprise: { nom: rep.entreprise || 'Entreprise démo', taille: 'PME' },
    poste: { id: POSTE_ID, os: 'macos', ...(rep.role_metier ? { role_metier: rep.role_metier } : {}) },
    consentement: { obtenu: !!dir.consentement_entreprise, sources_autorisees: dir.sources_autorisees?.length ? dir.sources_autorisees : ['logiciel_installe'] },
    dirigeant: dir, applications: apps,
    resume: { nb_detectees: apps.length, nb_metier: metier.length, nb_avec_api: disp.filter((d) => ['publique', 'partenaire', 'payante_entreprise'].includes(d)).length,
              nb_sans_api: disp.filter((d) => d === 'aucune').length, nb_api_inconnue: disp.filter((d) => d === 'inconnue').length,
              nb_a_valider: apps.filter((a) => a.filtre_metier?.a_valider).length },
    taches: rep.taches || [],
  };
}

// Temps 2 · questions pré-remplies (outils du temps 1, tâches de la bibliothèque selon le rôle et les outils)
app.get('/api/onboarding/questions', async (req, res) => {
  try {
    const rep = readA2('reponses.json', {});
    const fiche = ficheEnCours({ ...rep, role_metier: req.query.role || rep.role_metier });
    const q = await auditPy(['questions'], fiche);
    res.json({ questions: q, roles: listeRoles(), brouillon: rep, temps1: { resume: fiche.resume, genere_le: readA2('outils.json', {}).genere_le || null } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
const ROLES_AUDIT = ['Assistant(e) de direction', 'Gestion de la scolarité', 'Comptable', 'RH', 'Commercial'];
// Liste proposée à « Quel est ton rôle ? » : les 5 métiers de la bibliothèque, leurs intitulés équivalents (qui donnent
// les mêmes tâches suggérées) et les postes du dictionnaire. Sans doublon (casse et accents ignorés), triée.
let rolesProposes = null;
function listeRoles() {
  if (rolesProposes) return rolesProposes;
  const vus = new Set(), out = [];
  const cle = (x) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\(e\)/g, '').replace(/\s+/g, ' ').trim();
  const maj = (x) => (x.length <= 4 ? x.toUpperCase() : x[0].toUpperCase() + x.slice(1));
  const ajouter = (x) => { const k = cle(x); if (x && !vus.has(k)) { vus.add(k); out.push(maj(x.trim()).replace(/\brh\b/gi, 'RH')); } };
  try {
    const yaml = fs.readFileSync(path.join(REPO_ROOT, 'audit', 'data', 'taches_par_role.yaml'), 'utf8');
    const bloc = yaml.split(/^taches:/m)[0];
    for (const m of bloc.matchAll(/libelle:\s*"([^"]+)"/g)) ajouter(m[1]);
    for (const m of bloc.matchAll(/alias:\s*\[([^\]]*)\]/g)) for (const a of m[1].matchAll(/"([^"]+)"/g)) ajouter(a[1]);
  } catch { ROLES_AUDIT.forEach(ajouter); }
  (lexicon().postes || []).forEach(ajouter);
  rolesProposes = out.sort((a, b) => a.localeCompare(b, 'fr'));
  return rolesProposes;
}
// Les 3 tâches les plus lourdes (fréquence × durée) : les questions 5 à 7 ne portent que sur elles
app.post('/api/onboarding/lourdes', async (req, res) => {
  try { res.json({ ids: await auditPy(['lourdes'], req.body?.taches || []) }); } catch (e) { res.status(500).json({ error: e.message }); }
});
// Réponses (brouillon à chaque écran : on peut reprendre plus tard ; envoi final après le récap)
// TWIIN_PRENOM (.env) : le nom affiché partout (« Bonjour … »), pour une démo devant un client ou un jury
app.get('/api/onboarding/reponses', (req, res) => {
  const rep = readA2('reponses.json', null);
  res.json({ reponses: rep && process.env.TWIIN_PRENOM ? { ...rep, prenom: process.env.TWIIN_PRENOM } : rep });
});
app.post('/api/onboarding/reponses', (req, res) => {
  const r = req.body || {};
  const rep = { ...readA2('reponses.json', {}), ...r, mis_a_jour: new Date().toISOString() };
  writeA2('reponses.json', rep);
  res.json({ ok: true });
});

// Temps 3 · croisement + score : la fiche v2 complète (alertes, opportunités triées, top 3 à observer)
app.get('/api/audit/resultat', async (req, res) => {
  try {
    const { fiche, erreurs_schema } = await auditPy(['resultat'], ficheEnCours());
    writeA2('fiche-audit.json', fiche);
    const top = fiche.opportunites.filter((o) => o.a_observer);
    backLog('audit-resultat', { taches: fiche.taches.length, top3: top.map((o) => o.tache_id), alertes: fiche.alertes.map((a) => a.type),
                                heures_semaine_top3: top.reduce((n, o) => n + (o.gain_heures_semaine || 0), 0), erreurs_schema: erreurs_schema.length });
    res.json({ fiche, erreurs_schema });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`workflow-recorder (Hugging Face) running at http://localhost:${PORT}`);
  // Transcription locale : si faster-whisper ou le modèle manquent, installation automatique en arrière-plan (un seul essai
  // par lancement ; la page montre l'avancement et propose « Réessayer » en cas d'échec). VOICE_AUTO_INSTALL=0 la désactive.
  if (process.env.VOICE_AUTO_INSTALL !== '0') {
    localVoiceStatus(true).then((st) => {
      if ((st.ready && !st.needsDownload) || install.state === 'running') return;
      console.log('Transcription locale absente : installation automatique…');
      install = { state: 'running', step: 'python', message: 'Vérification de Python…', startedAt: Date.now() };
      installVoice();
    }).catch(() => {});
  }
});
