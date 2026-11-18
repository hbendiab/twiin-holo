import dotenv from 'dotenv';
import express from 'express';
import OpenAI from 'openai';
import { jsonrepair } from 'jsonrepair';                // réparation locale des JSON mal formés               // <-- remplace @anthropic-ai/sdk (Hugging Face est compatible OpenAI)
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
const spawnMac = (args) => { try { const c = spawnMac(args); c.on('error', () => {}); return c; } catch { return null; } }; // Windows : osascript absent
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';

// recorder/ sits one level below the repo root, alongside the twiin/ Python package
const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CANDIDATES_PATH = path.join(REPO_ROOT, 'workflows', 'candidates.json');

// project-wide .env lives at the repo root, same file Holo's pieces read
dotenv.config({ path: path.join(REPO_ROOT, '.env') });

const app = express();
app.use(express.json({ limit: '200mb' }));
app.use(express.static('public'));
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
const SB_ON = !!(SB_URL && SB_ANON);
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
  const user = als.getStore();
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

app.get('/api/config', (req, res) => res.json({ supabase: SB_ON ? { url: SB_URL, anonKey: SB_ANON } : null }));
// Toutes les routes /api demandent un employé connecté, sauf : la config, la voix (balise <audio>), le pont n8n → Holo
// (il a son propre jeton) et les fichiers servis.
const OPEN_API = ['/config', '/voice/say', '/holo/run'];
app.use('/api', async (req, res, next) => {
  if (!SB_ON || OPEN_API.some((p) => req.path.startsWith(p))) return next();
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const user = token ? await sbUserFromToken(token).catch(() => null) : null;
  if (!user) return res.status(401).json({ error: 'Connecte-toi pour continuer.', login: true });
  als.run(user, next);
});

// --- Hugging Face (routeur compatible OpenAI) ---------------------------------
// Mets HF_TOKEN dans .env (ton token Hugging Face). HF_MODEL est optionnel.
const client = new OpenAI({
  baseURL: 'https://router.huggingface.co/v1',
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
fetch('https://router.huggingface.co/v1/models', { headers: { Authorization: `Bearer ${process.env.HF_TOKEN}` } })
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
    py.on('error', (e) => { console.error('OCR indisponible :', e.message); resolve([]); });
    py.stdin.on('error', () => {});
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
typing burst (keys are never recorded, only that typing happened and where), keyboard shortcut (⌘C copy, ⌘V paste,
⌘S save…), structure key (Enter, Tab, Escape: they move between fields, e.g. Enter leaves a page title) and app switch, with the screen, the app, the window title and the label of the clicked element.
The ACTION LOG is authoritative for the ORDER of actions, the SCREEN and APP used, and WHERE the user clicked or
typed. Match each typing burst with the next frame of that screen to read WHAT was typed (from the OCR text).
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
{"workflows":[{"name":"short label","general_intent":"abstracted pattern","summary":"one sentence","why_daily":"one sentence","steps":["step 1","step 2"]}]}`;

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
- If the user made a mistake and corrected it, keep only the corrected final action.
- IGNORE the recording tool itself: the « Twiin · Enregistrement » recorder page (localhost), its Start/Stop/« Ajouter un écran »
  buttons and the browser's screen-sharing dialogs are NOT part of the task. Never write a step about them.
- Return ONE workflow for the whole session unless the user clearly did several unrelated tasks.
- "general_intent": the goal in one phrase. "summary": one sentence describing what was done.
  "why_daily": one sentence on why this task is worth automating (do NOT turn it into extra steps).

Inside JSON string values never use straight double quotes: quote typed text with « » instead.
Return ONLY a JSON object, no prose, no markdown fences, exactly in this shape:
{"workflows":[{"name":"short label","general_intent":"goal","summary":"one sentence","why_daily":"one sentence","steps":["step 1","step 2"]}]}`;

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
    else if (e.type === 'key') lines.push(`${t(e.ts)} · ${where} · presses ${({ 'Entrée': 'Enter', 'Échap': 'Escape' })[e.keys] || e.keys}${e.element ? ` in ${e.element}` : ''}`);
  }
  let out = lines.join('\n');
  if (out.length > 15000) out = out.slice(0, 15000) + '\n[… journal tronqué]';
  return out;
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

app.post('/api/frames', (req, res) => {
  try {
    const { session, frame } = req.body;
    const dir = sessionDirById(session);
    if (!dir || !frame) return res.status(400).json({ error: 'session ou image manquante' });
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
    fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({ startedAt: recorderSession.startedAt }));
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
async function analyze({ frames, transcript, actionLog = '', ocrLines = 0, screens = 1, textOnly = false, session = null }) {
  const used = textOnly ? [] : sampleFrames(frames);
  const header = textOnly
    ? `No images are available for this session: only the OCR transcript of its ${frames?.length ?? 'several'} kept frames over ${screens} screen(s). Return the JSON described in the system prompt.`
    : `${frames.length} frames kept in total over ${screens} screen(s); ${used.length} of them are shown below, in time order. Return the JSON described in the system prompt.`;
  const content = [
    { type: 'text', text: header },
    ...used.flatMap((f) => [{ type: 'text', text: `Image ${f.index} · screen ${f.screen ?? 1} · t+${f.seconds ?? '?'}s` }, toImageBlock(f.dataUrl)]),
    { type: 'text', text: `ACTION LOG (recorded during the session: exact time, screen, app and clicked element; authoritative for ORDER and WHERE):\n${actionLog || '(no action log)'}` },
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
                 usage, cost_usd };
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
  console.log(`Wrote ${result.workflows.length} candidate workflow(s) to ${CANDIDATES_PATH}`);
  backLog('analyse', { model: HF_MODEL, provider, tokens_in: usage.prompt_tokens, tokens_out: usage.completion_tokens, cost_usd,
                       images_sent: meta.images_sent, ocr_lines: ocrLines, actions: meta.action_lines, json_repaired: repaired,
                       workflows: result.workflows.map((w) => `${w.name} (${(w.steps || []).length} étapes)`) });
  return { ...result, _meta: meta };
}

async function analyzeSessionDir(dir) {
  const { frames, startedAt, screens: shared } = loadSessionFrames(dir);
  if (!frames.length) throw new Error('Aucune image enregistrée pour cet enregistrement.');
  const actionLog = actionTranscript(readActions(dir), startedAt || Date.parse(frames[0]?.timestamp), shared);
  const t0 = Date.now();
  setPhase('ocr');
  const ocr = await runOcr(frames);
  const transcript = ocrTranscript(frames, ocr);
  const ocrLines = ocr.reduce((n, o) => n + (o.lines?.length || 0), 0);
  console.log(`OCR local : ${ocr.length} image(s), ${ocrLines} lignes, ${transcript.length} caractères gardés, ${((Date.now() - t0) / 1000).toFixed(1)} s · journal : ${actionLog ? actionLog.split('\n').length : 0} action(s)`);
  const screens = new Set(frames.map((f) => f.screen ?? 1)).size;
  return analyze({ frames, transcript, actionLog, ocrLines, screens, session: path.basename(dir) });
}

app.post('/api/generate-workflows', async (req, res) => {
  try {
    const { frames, session, startedAt, screens: shared } = req.body;
    if (recorderSession?.proc) recorderSession.proc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 600)); // laisse le journal écrire ses dernières lignes
    let dir = sessionDirById(session);
    if (frames?.length) { // ancien mode : toutes les images envoyées d'un coup à la fin
      dir = dir || newSessionDir().dir;
      fs.writeFileSync(path.join(dir, 'frames.json'), JSON.stringify({ frames, startedAt, screens: shared || [] }));
    }
    if (!dir) return res.status(400).json({ error: 'Enregistrement introuvable.' });
    const result = await analyzeSessionDir(dir);
    res.json({ ...result, _discovery: startDiscovery(dir) });
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
                     { cwd: REPO_ROOT, env: { ...process.env, PYTHONUTF8: '1' }, detached: true, stdio: ['ignore', log, log] });
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
  const missing = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_EMAIL', 'SUPABASE_PASSWORD', 'HAI_API_KEY'].filter((k) => !process.env[k]);
  if (missing.length) { console.warn(`[découverte] désactivée, variables manquantes : ${missing.join(', ')}`); return false; }
  const st = discoveryState(dir);
  if (workerBusy(st)) { console.log(`[découverte] déjà en cours pour ${path.basename(dir)} (${st.phase})`); discovery.dir = dir; return true; }
  try { fs.rmSync(path.join(dir, 'discovery.json'), { force: true }); } catch {}
  runDiscovery('discover', dir);
  return true;
}
// La page ne reçoit que l'avancement et la question, jamais le détail interne.
app.get('/api/discovery', (req, res) => {
  const dir = discovery.dir || latestSessionDir();
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
    const dirs = fs.existsSync(SESSIONS_DIR) ? fs.readdirSync(SESSIONS_DIR).filter(hasFrames).sort() : [];
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
screen and uses mouse and keyboard on a Mac with several monitors) replays it. Improve it in TWO ways:

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
{"name":"short label","summary":"one sentence","steps":["step 1","step 2"],
 "changes":[{"kind":"fiabilité|process","what":"what changed, in French, one sentence"}]}
Write the steps in English (the agent works best in English) and the "changes" in French.`;

// Dernier workflow analysé (affiché au chargement de la page, pour l'améliorer ou le rejouer sans réenregistrer)
app.get('/api/candidates', async (req, res) => {
  if (sbUser()) { // connecté : SES dernières tâches analysées
    const me = sbUser()?.id;
    const rows = await sb(`taches?select=*&source=eq.analyse&recorded_by=eq.${me}&order=created_at.desc&limit=5`);
    return res.json({ workflows: (rows || []).map((t) => ({ task_id: t.id, name: t.title, summary: t.summary, why_daily: t.why,
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
function sessionDirFor(wf) {
  if (wf?.session) {
    const dir = path.join(SESSIONS_DIR, path.basename(String(wf.session)));
    return fs.existsSync(dir) ? dir : null; // enregistrement absent (autre Mac) : pas de mesures plutôt que de fausses
  }
  return latestSessionDir();
}
function taskContext(wf) {
  const dir = sessionDirFor(wf);
  const events = dir ? readActions(dir) : [];
  const last = fs.existsSync(LAST_RUN_PATH) ? JSON.parse(fs.readFileSync(LAST_RUN_PATH, 'utf8')) : {};
  const same = dir && last.meta?.session === path.basename(dir);
  let actionLog = same ? last.action_log : '';
  if (!actionLog && dir && events.length) {
    let started = null;
    try { started = JSON.parse(fs.readFileSync(path.join(dir, 'session.json'), 'utf8')).startedAt; } catch { /* rien */ }
    try { actionLog = actionTranscript(events, started || events[0].ts * 1000, []); } catch { actionLog = ''; }
  }
  return { dir, events, actionLog: actionLog || '', ocr: same ? last.ocr_transcript || '' : '' };
}

function latestSessionDir() {
  if (!fs.existsSync(SESSIONS_DIR)) return null;
  const hasFrames = (d) => ['frames.jsonl', 'frames.json'].some((f) => fs.existsSync(path.join(SESSIONS_DIR, d, f)));
  const dirs = fs.readdirSync(SESSIONS_DIR).filter(hasFrames).sort();
  return dirs.length ? path.join(SESSIONS_DIR, dirs.at(-1)) : null;
}

// Mesures objectives tirées du journal d'actions : durée, temps par appli, allers-retours, copier-coller, saisies.
function processStats(events) {
  const ev = events.filter((e) => e?.type && !['start', 'stop', 'error'].includes(e.type) && !IS_RECORDER(e));
  if (!ev.length) return null;
  const t0 = ev[0].ts, t1 = Math.max(...ev.map((e) => e.until || e.ts));
  const perApp = {};
  let switches = 0, prevApp = null;
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i];
    const end = i + 1 < ev.length ? ev[i + 1].ts : t1;
    if (e.app) perApp[e.app] = (perApp[e.app] || 0) + Math.max(0, end - e.ts);
    if (e.app && prevApp && e.app !== prevApp) switches++;
    if (e.app) prevApp = e.app;
  }
  const count = (f) => ev.filter(f).length;
  return {
    duration_s: Math.round(t1 - t0),
    time_per_app_s: Object.fromEntries(Object.entries(perApp).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round(v)])),
    app_switches: switches,
    clicks: count((e) => e.type === 'click'),
    copies: count((e) => e.type === 'shortcut' && /C$/i.test(e.keys || '')),
    pastes: count((e) => e.type === 'shortcut' && /V$/i.test(e.keys || '')),
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
    const stats = processStats(ctx.events);
    const last = { action_log: ctx.actionLog, ocr_transcript: ctx.ocr };
    const user = [
      `TASK\nName: ${wf.name || ''}\nSummary: ${wf.summary || ''}\nSteps:\n` + (wf.steps || []).map((st, i) => `${i + 1}. ${st}`).join('\n'),
      `MEASURES (from the action log)\n${stats ? JSON.stringify(stats, null, 1) : '(no action log)'}`,
      `ACTION LOG\n${(last.action_log || '(none)').slice(0, 12000)}`,
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
    const stats = processStats(ctx.events);
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
(a computer-use agent that works on the employee's Mac). Use ONLY these block types, in order:
- {"type":"holo","name":"Holo — <verb> <tool>","steps":["one precise instruction in English"],"expect":{"key":"what to read"}}
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
Return ONLY JSON, no fences: {"name":"short title","schedule_cron":"cron or null","blocks":[…]}.
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
    proc.stderr.on('data', (d) => process.stderr.write(`[n8n] ${d}`));
    n8nRun = { proc, events, running: true };
    proc.on('close', keepUser(async () => {
      n8nRun.running = false;
      spawnMac(['-e', 'tell application "Google Chrome" to activate']);
      const evs = readJsonl(events);
      const imported = evs.find((e) => e.type === 'imported');
      if (imported) await sb('automations?on_conflict=user_id,n8n_id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
        body: { task_id: wf.task_id || null, n8n_id: imported.id, name: plan.name || wf.name, blocks: plan.blocks, freq: 'manual', active: false } });
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
  res.json({ events: all.slice(since), next: all.length, running: n8nRun.running, holo, holoRunning: !!replay?.running });
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

// --- Pont n8n → Holo : n8n envoie des étapes, Holo les fait sur ce Mac, la réponse revient à n8n -----------------
// Appel SYNCHRONE (n8n attend la fin). Réservé aux appels locaux portant le jeton TWIIN_LOCAL_TOKEN.
app.post('/api/holo/run', async (req, res) => {
  try {
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
    if (!local || !process.env.TWIIN_LOCAL_TOKEN || req.get('x-twiin-token') !== process.env.TWIIN_LOCAL_TOKEN) {
      return res.status(403).json({ error: 'Accès refusé (appel local avec jeton Twiin uniquement).' });
    }
    if (replay?.running) return res.status(409).json({ error: 'Holo est déjà occupé par un autre rejeu.' });
    const { name, steps: raw, expect } = req.body || {};
    const steps = (raw || []).map((x) => String(x).trim()).filter(Boolean);
    if (!steps.length) return res.status(400).json({ error: 'Aucune étape.' });
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
    spawnMac( ['-e', 'tell application "System Events" to set visible of process "Code" to false']);
    const t0 = Date.now();
    const proc = spawn(PYTHON, ['-u', RUN_LIVE, id, '--no-open', '--events', events], { cwd: REPO_ROOT });
    proc.stdout.on('data', (d) => process.stdout.write(`[n8n→holo] ${d}`));
    proc.stderr.on('data', (d) => process.stderr.write(`[n8n→holo] ${d}`));
    replay = { proc, events, id, running: true };
    console.log(`n8n → Holo : ${id} (${steps.length} étape(s))`);
    await new Promise((resolve) => proc.on('close', resolve));
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
    res.json({ ok: !!end.ok, status: end.status || 'inconnu', seconds: Math.round((Date.now() - t0) / 1000),
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
  if (replay?.running) replay.proc.kill('SIGTERM');
  res.json({ ok: true });
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
const ELEVEN_VOICE = process.env.ELEVENLABS_VOICE_ID || 'XrExE9yKIg1WjnnlVkGX'; // Matilda
const ELEVEN_STT_MODEL = process.env.ELEVENLABS_STT_MODEL || 'scribe_v2';

// La voix et la transcription coûtent des crédits ElevenLabs : réservées à ce Mac (pas aux autres postes du réseau).
const isLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);

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
app.get('/api/onboarding/questions', (req, res) => res.json(ONBOARDING));

// Twiin parle : texte → voix (ElevenLabs), gardée en cache sur le disque.
app.get('/api/voice/say', async (req, res) => {
  try {
    if (!isLocal(req)) return res.status(403).end();
    const text = String(req.query.text || '').trim().slice(0, 600);
    if (!text) return res.status(400).end();
    if (!ELEVEN_KEY) return res.status(503).json({ error: 'ELEVENLABS_API_KEY manquante dans .env' });
    fs.mkdirSync(VOICE_CACHE, { recursive: true });
    const file = path.join(VOICE_CACHE, crypto.createHash('sha1').update(`${ELEVEN_VOICE}|${text}`).digest('hex') + '.mp3');
    if (!fs.existsSync(file)) {
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE}?output_format=mp3_44100_64`, {
        method: 'POST', headers: { 'xi-api-key': ELEVEN_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' }),
      });
      if (!r.ok) throw new Error(`ElevenLabs (voix) : ${r.status} ${(await r.text()).slice(0, 200)}`);
      fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    }
    res.type('audio/mpeg').sendFile(file);
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
    let r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': ELEVEN_KEY }, body: form });
    if (!r.ok && form.has('keyterms')) { // liste de mots refusée : on retranscrit sans elle plutôt que d'échouer
      form.delete('keyterms');
      r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': ELEVEN_KEY }, body: form });
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
  if (sbUser()) { // connecté : SA fiche (plusieurs collègues peuvent passer sur le même Mac)
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
  if (sbUser()) { // connecté : SON dernier scan
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
      const dir = sessionDirFor(wf);
      if (!dir) throw new Error('L\'enregistrement de cette tâche n\'est pas sur ce Mac : enregistre-la d\'abord (étape 2).');
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
      await runStep('npx', ['remotion', 'render', 'TwiinTuto', `out/${name}.mp4`, `--props=${JSON.stringify({ dataFile: `tutos/${name}/props.json` })}`],
        VIDEO_DIR, (l) => {
          const m = l.match(/(\d+)\s*\/\s*(\d+)/);
          if (m && Number(m[2]) > 0) job.percent = Math.min(100, Math.round((100 * Number(m[1])) / Number(m[2])));
        });
    }
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
app.get('/api/tuto/status', (req, res) => res.json(tutoJob || { phase: 'idle' }));

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Pages « Mes vidéos » et « Mes automatisations »
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
app.get('/api/tutos', (req, res) => {
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
      thumb: props?.scenes?.[0]?.shots?.[0]?.src ? `/tutos-media/${props.scenes[0].shots[0].src.replace(/^tutos\//, '')}` : null,
    };
  }).sort((a, b) => new Date(b.created) - new Date(a.created));
  res.json({ tutos: list });
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
const BLOCK_KIND = (n) => (/api\/holo\/run/.test(n.parameters?.url || '') ? 'holo' : n.type.endsWith('.googleSheets') ? 'sheets'
  : n.type.endsWith('.code') ? (/Vérification|rules/.test(n.parameters?.jsCode || '') ? 'verify' : 'code') : n.type.endsWith('.httpRequest') ? 'http' : 'other');
let automationRun = null; // { id, proc, startedAt }

async function automationSummary(w) {
  const sched = w.nodes.find((n) => n.type.endsWith('.scheduleTrigger'));
  const cron = sched && !sched.disabled ? sched.parameters?.rule?.interval?.[0]?.expression : null;
  const freq = Object.keys(FREQS).find((k) => FREQS[k] && FREQS[k] === cron) || (cron ? 'custom' : 'manual');
  const sheetNode = w.nodes.find((n) => n.type.endsWith('.googleSheets'));
  const sheetId = sheetNode?.parameters?.documentId?.value;
  const gid = sheetNode?.parameters?.sheetName?.value;
  let execs = [];
  try { execs = (await n8nApi(`/executions?workflowId=${encodeURIComponent(w.id)}&limit=20`)).data || []; } catch { /* historique indisponible */ }
  const done = execs.filter((e) => e.stoppedAt);
  const dur = done.map((e) => (new Date(e.stoppedAt) - new Date(e.startedAt)) / 1000);
  return {
    id: w.id, name: w.name.replace(/^Twiin — /, ''), active: w.active, freq, freq_label: FREQ_LABEL[freq] || cron, cron,
    blocks: w.nodes.filter((n) => !/(webhook|scheduleTrigger|manualTrigger)$/i.test(n.type)).map((n) => ({ name: n.name, kind: BLOCK_KIND(n) })),
    sheet: sheetId ? { id: sheetId, url: `https://docs.google.com/spreadsheets/d/${sheetId}/edit${gid ? `#gid=${gid}` : ''}` } : null,
    executions: execs.map((e) => ({ id: e.id, status: e.status, mode: e.mode, startedAt: e.startedAt, stoppedAt: e.stoppedAt,
                                    url: `${N8N_URL}/workflow/${w.id}/executions/${e.id}` })),
    stats: { total: execs.length, success: execs.filter((e) => e.status === 'success').length,
             avg_s: dur.length ? Math.round(dur.reduce((a, b) => a + b, 0) / dur.length) : null, last: execs[0]?.startedAt || null },
    running: automationRun?.id === w.id,
    n8n_url: `${N8N_URL}/workflow/${w.id}`, created: w.createdAt, updated: w.updatedAt,
  };
}

app.get('/api/automations', async (req, res) => {
  if (!(await n8nUp())) return res.json({ up: false, automations: [] });
  try {
    const all = (await n8nApi('/workflows?limit=100')).data || [];
    const mine = all.filter((w) => w.id.startsWith('twiin') && !/\(outil\)/.test(w.name));
    const list = await Promise.all(mine.map(automationSummary));
    const runs = list.flatMap((a) => a.executions.map((e) => ({ n8n_id: a.id, n8n_execution_id: String(e.id), status: e.status, mode: e.mode,
                                                                  started_at: e.startedAt, stopped_at: e.stoppedAt })));
    if (runs.length) sb('automation_runs?on_conflict=user_id,n8n_execution_id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: runs });
    res.json({ up: true, n8n_url: N8N_URL, automations: list });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.get('/api/automations/:id', async (req, res) => {
  try { res.json(await automationSummary(await n8nApi(`/workflows/${encodeURIComponent(req.params.id)}`))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Fréquence : on règle le déclencheur planifié du workflow, puis on l'active (ou on le met en pause si « manuelle »).
app.post('/api/automations/:id/schedule', async (req, res) => {
  try {
    const freq = req.body?.freq;
    if (!(freq in FREQS)) return res.status(400).json({ error: 'Fréquence inconnue.' });
    const id = encodeURIComponent(req.params.id);
    const w = await n8nApi(`/workflows/${id}`);
    const sched = w.nodes.find((n) => n.type.endsWith('.scheduleTrigger'));
    if (!sched && freq !== 'manual') throw new Error('Cette automatisation n\'a pas de déclencheur planifié.');
    if (sched) {
      sched.disabled = freq === 'manual';
      if (FREQS[freq]) sched.parameters = { rule: { interval: [{ field: 'cronExpression', expression: FREQS[freq] }] } };
    }
    const keep = ['executionOrder', 'timezone', 'saveDataErrorExecution', 'saveDataSuccessExecution', 'saveManualExecutions',
                  'saveExecutionProgress', 'executionTimeout', 'errorWorkflow', 'callerPolicy'];
    const settings = Object.fromEntries(Object.entries(w.settings || {}).filter(([k]) => keep.includes(k)));
    await n8nApi(`/workflows/${id}`, { method: 'PUT', body: JSON.stringify({ name: w.name, nodes: w.nodes, connections: w.connections, settings }) });
    await n8nApi(`/workflows/${id}/${freq === 'manual' ? 'deactivate' : 'activate'}`, { method: 'POST' });
    console.log(`Automatisation ${w.id} : ${FREQ_LABEL[freq]}`);
    await sb(`automations?n8n_id=eq.${encodeURIComponent(w.id)}`, { method: 'PATCH', prefer: 'return=minimal', body: { freq, active: freq !== 'manual' } });
    res.json(await automationSummary(await n8nApi(`/workflows/${id}`)));
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: e.message });
  }
});

// Lancer maintenant (une exécution de test, comme à la création). Les blocs Holo prennent la souris du Mac.
app.post('/api/automations/:id/run', async (req, res) => {
  if (automationRun || n8nRun?.running) return res.status(409).json({ error: 'Une automatisation tourne déjà.' });
  if (replay?.running) return res.status(409).json({ error: 'Holo est occupé par un rejeu.' });
  try { await ensureN8n(); } catch (e) { return res.status(500).json({ error: e.message }); }
  const id = req.params.id;
  const proc = spawn(PYTHON, ['-u', N8N_GEN, '--run', id], { cwd: REPO_ROOT });
  proc.stderr.on('data', (d) => process.stderr.write(`[n8n] ${d}`));
  automationRun = { id, proc, startedAt: Date.now() };
  proc.on('close', (code) => { console.log(`Automatisation ${id} lancée à la main : ${code === 0 ? 'succès' : 'échec'}`); automationRun = null; });
  res.json({ ok: true });
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

app.listen(PORT, () => console.log(`workflow-recorder (Hugging Face) running at http://localhost:${PORT}`));
