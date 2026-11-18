import dotenv from 'dotenv';
import express from 'express';
import OpenAI from 'openai';
import { jsonrepair } from 'jsonrepair';                // réparation locale des JSON mal formés               // <-- remplace @anthropic-ai/sdk (Hugging Face est compatible OpenAI)
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
const spawnMac = (args) => { try { const c = spawn('osascript', args); c.on('error', () => {}); return c; } catch { return null; } }; // Windows : osascript absent
import { fileURLToPath } from 'url';

// recorder/ sits one level below the repo root, alongside the twiin/ Python package
const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CANDIDATES_PATH = path.join(REPO_ROOT, 'workflows', 'candidates.json');

// project-wide .env lives at the repo root, same file Holo's pieces read
dotenv.config({ path: path.join(REPO_ROOT, '.env') });

const app = express();
app.use(express.json({ limit: '200mb' }));
app.use(express.static('public'));

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
const PYTHON = fs.existsSync(path.join(REPO_ROOT, '.venv', 'bin', 'python'))
  ? path.join(REPO_ROOT, '.venv', 'bin', 'python')
  : fs.existsSync(path.join(REPO_ROOT, '..', '.venv', 'Scripts', 'python.exe'))
    ? path.join(REPO_ROOT, '..', '.venv', 'Scripts', 'python.exe') : 'python3';
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
    const py = spawn(PYTHON, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'ocr.py')]);
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
    const proc = spawn(PYTHON, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'actions.py'), '--out', path.join(dir, 'actions.jsonl')]);
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
async function analyze({ frames, transcript, actionLog = '', ocrLines = 0, screens = 1, textOnly = false }) {
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
  if (!Array.isArray(result.workflows) || !result.workflows.length) {
    throw new Error('Le modèle n\'a renvoyé aucun workflow. Réponse brute : ' + raw.slice(0, 300));
  }

  fs.mkdirSync(path.dirname(CANDIDATES_PATH), { recursive: true });
  fs.writeFileSync(CANDIDATES_PATH, JSON.stringify(result, null, 2) + '\n');
  fs.writeFileSync(LAST_RUN_PATH, JSON.stringify({ meta, action_log: actionLog, ocr_transcript: transcript }, null, 2) + '\n');
  console.log(`Wrote ${result.workflows.length} candidate workflow(s) to ${CANDIDATES_PATH}`);
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
  return analyze({ frames, transcript, actionLog, ocrLines, screens });
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
    startDiscovery(dir);
    res.json(result);
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
// Le jumeau, les essais et la casse ne sont jamais montrés sur la page. Désactiver : DISCOVERY=off.
let discovery = { dir: null, proc: null };
const discoveryState = (dir) => {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'discovery.json'), 'utf8')); } catch { return null; }
};
function runDiscovery(cmd, dir) {
  const proc = spawn(PYTHON, ['-u', '-m', 'discovery.discovery', cmd, dir], { cwd: REPO_ROOT, env: { ...process.env, PYTHONUTF8: '1' } });
  proc.on('error', (e) => console.warn('[découverte] impossible de lancer le worker :', e.message));
  proc.stdout.on('data', (d) => console.log(String(d).trim()));
  proc.stderr.on('data', (d) => console.warn('[découverte]', String(d).trim().slice(0, 400)));
  proc.on('close', (code) => { console.log(`[découverte] ${cmd} terminé (code ${code})`); discovery.proc = null; });
  discovery = { dir, proc };
}
function startDiscovery(dir) {
  if ((process.env.DISCOVERY || 'on') === 'off') return;
  const missing = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_EMAIL', 'SUPABASE_PASSWORD', 'HAI_API_KEY'].filter((k) => !process.env[k]);
  if (missing.length) return console.warn(`[découverte] désactivée, variables manquantes : ${missing.join(', ')}`);
  const st = discoveryState(dir);
  if (st && !['error', 'corrected'].includes(st.phase)) return console.log(`[découverte] déjà faite pour ${path.basename(dir)} (${st.phase})`);
  if (discovery.proc) return console.warn('[découverte] une découverte tourne déjà');
  try { fs.rmSync(path.join(dir, 'discovery.json'), { force: true }); } catch {}
  runDiscovery('discover', dir);
}
// La page ne reçoit que l'avancement et la question, jamais le détail interne.
app.get('/api/discovery', (req, res) => {
  const dir = discovery.dir || latestSessionDir();
  const st = dir ? discoveryState(dir) : null;
  if (!st) return res.json({ phase: 'idle' });
  res.json({ phase: st.phase, question: st.phase === 'awaiting_confirmation' ? st.question : null });
});
app.post('/api/discovery/answer', (req, res) => {
  const dir = discovery.dir || latestSessionDir();
  const st = dir ? discoveryState(dir) : null;
  if (!st || st.phase !== 'awaiting_confirmation') return res.status(409).json({ error: 'Aucune question en attente.' });
  if (discovery.proc) return res.status(409).json({ error: 'Traitement en cours.' });
  st.answer = { ok: !!req.body?.ok, correction: String(req.body?.correction || '').slice(0, 2000) };
  st.phase = 'answered';
  fs.writeFileSync(path.join(dir, 'discovery.json'), JSON.stringify(st, null, 1));
  runDiscovery('answer', dir);
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
      startDiscovery(path.join(SESSIONS_DIR, dirs.at(-1)));
      return res.json(result);
    }
    if (!fs.existsSync(LAST_RUN_PATH)) return res.status(404).json({ error: 'Aucun enregistrement à relancer.' });
    const last = JSON.parse(fs.readFileSync(LAST_RUN_PATH, 'utf8'));
    console.log('Relance sur le texte OCR du dernier enregistrement (images non gardées)');
    res.json(await analyze({ frames: Array.from({ length: last.meta?.images_kept || 0 }), transcript: last.ocr_transcript,
                             actionLog: last.action_log || '', ocrLines: last.meta?.ocr_lines || 0,
                             screens: last.meta?.screens || 1, textOnly: true }));
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
app.get('/api/candidates', (req, res) => {
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
Return ONLY a JSON object, no prose, no markdown fences; in string values use « » instead of straight double quotes. French.
Shape: {"headline":"one sentence summary of the main opportunity",
 "recommendations":[{"title":"short","observed":"what was observed, with numbers","suggestion":"what to do instead",
   "gain":"estimated time saved per run, e.g. « ~30 s »","kind":"à faire soi-même|outil existant|à automatiser avec Twiin"}],
 "automation_potential":"one sentence: which part Twiin could take over and why"}`;

app.post('/api/process-advice', async (req, res) => {
  try {
    const wf = req.body?.workflow || {};
    const dir = latestSessionDir();
    const actions = dir ? readActions(dir) : [];
    const stats = processStats(actions);
    const last = fs.existsSync(LAST_RUN_PATH) ? JSON.parse(fs.readFileSync(LAST_RUN_PATH, 'utf8')) : {};
    const user = [
      `TASK\nName: ${wf.name || ''}\nSummary: ${wf.summary || ''}\nSteps:\n` + (wf.steps || []).map((st, i) => `${i + 1}. ${st}`).join('\n'),
      `MEASURES (from the action log)\n${stats ? JSON.stringify(stats, null, 1) : '(no action log)'}`,
      `ACTION LOG\n${(last.action_log || '(none)').slice(0, 12000)}`,
      `OCR TEXT\n${(last.ocr_transcript || '(none)').slice(0, 8000)}`,
    ].join('\n\n');
    const { data: resp } = await client.chat.completions.create({
      model: HF_MODEL, max_tokens: MAX_OUTPUT_TOKENS, temperature: 0, reasoning_effort: REASONING_EFFORT,
      messages: [{ role: 'system', content: ADVICE_PROMPT }, { role: 'user', content: user }],
    }).withResponse();
    const raw = resp.choices?.[0]?.message?.content || '';
    if (!raw.trim()) throw new Error('Réponse vide du modèle : réessaie.');
    const { result } = parseWorkflows(raw);
    console.log(`Conseils process : ${result.recommendations?.length ?? 0} recommandation(s), ≈ ${(resp.usage?.cost ?? 0).toFixed(4)} $`);
    res.json({ stats, ...result, cost_usd: resp.usage?.cost ?? null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
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
Return ONLY a JSON object, no prose, no fences, using « » instead of straight double quotes inside strings:
{"verdict":"accélérer|automatiser","confidence":"élevée|moyenne|faible","reasons":["…","…"],
 "frequency_hint":"how often such a task is probably done, and that the employee should confirm",
 "time_saved":"estimated time saved per run or per month",
 "plan":[{"tool":"name","how":"API n8n|Holo|manuel","what":"what this tool does in the automated or improved version"}]}`;

app.post('/api/verdict', async (req, res) => {
  try {
    const wf = req.body?.workflow || {};
    const dir = latestSessionDir();
    const events = dir ? readActions(dir) : [];
    const last = fs.existsSync(LAST_RUN_PATH) ? JSON.parse(fs.readFileSync(LAST_RUN_PATH, 'utf8')) : {};
    const stats = processStats(events);
    const tools = toolsUsed(events, last.ocr_transcript);
    const user = [
      `TASK\nName: ${wf.name || ''}\nSteps:\n` + (wf.steps || []).map((st, i) => `${i + 1}. ${st}`).join('\n'),
      `MEASURES\n${stats ? JSON.stringify(stats) : '(no action log)'}`,
      `TOOLS USED (from Twiin registry)\n${tools.map((t) => `- ${t.name} (${t.kind}) : ${t.known ? `${t.tool}, ${t.api ? `API (${t.connector})` : 'pas d\'API'}` : 'inconnu du registre, pas d\'API connue'}`).join('\n') || '(none)'}`,
    ].join('\n\n');
    const { data: resp } = await client.chat.completions.create({
      model: HF_MODEL, max_tokens: MAX_OUTPUT_TOKENS, temperature: 0, reasoning_effort: REASONING_EFFORT,
      messages: [{ role: 'system', content: VERDICT_PROMPT }, { role: 'user', content: user }],
    }).withResponse();
    const raw = resp.choices?.[0]?.message?.content || '';
    if (!raw.trim()) throw new Error('Réponse vide du modèle : réessaie.');
    const { result } = parseWorkflows(raw);
    console.log(`Verdict : ${result.verdict} (${result.confidence}), ≈ ${(resp.usage?.cost ?? 0).toFixed(4)} $`);
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

app.post('/api/n8n/create', async (req, res) => {
  try {
    if (n8nRun?.running) return res.status(409).json({ error: 'Une automatisation est déjà en cours de création.' });
    if (replay?.running) return res.status(409).json({ error: 'Holo est occupé par un rejeu.' });
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
    proc.on('close', () => { n8nRun.running = false; spawnMac( ['-e', 'tell application "Google Chrome" to activate']); });
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
app.listen(PORT, () => console.log(`workflow-recorder (Hugging Face) running at http://localhost:${PORT}`));
