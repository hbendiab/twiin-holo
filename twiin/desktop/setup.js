// Twiin · installation au premier lancement (app installée) : rien à installer à la main, ni Node, ni Python, ni terminal.
//   1. le code de Twiin est copié dans le dossier de l'utilisateur (on y écrit enregistrements, réglages, .env) ;
//   2. un Python prêt à l'emploi est téléchargé (python-build-standalone), puis l'environnement du projet est créé ;
//   3. les dépendances Python sont installées ; 4. le navigateur des tests (Chromium, pour la découverte) ; 5. les logos.
// Les données de l'utilisateur (enregistrements, .env) ne sont jamais écrasées par une mise à jour.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const IS_WIN = process.platform === 'win32';
const PY_RELEASE = '20261110';
const PY_VERSION = '3.12.16';
const PY_ASSET = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'win32-x64': 'x86_64-pc-windows-msvc',
}[`${process.platform}-${process.arch}`];
const PY_URL = PY_ASSET && `https://github.com/astral-sh/python-build-standalone/releases/download/${PY_RELEASE}/cpython-${PY_VERSION}+${PY_RELEASE}-${PY_ASSET}-install_only.tar.gz`;

// Ce que la mise à jour du code ne touche jamais (données et réglages de l'utilisateur)
const KEEP = new Set(['.env', '.venv', 'workflows', 'tuto/video/node_modules', 'tuto/video/out', 'tuto/video/public/tutos']);

function run(cmd, args, { cwd, onLine, env } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, PYTHONUTF8: '1', ...env }, windowsHide: true });
    let tail = '';
    const take = (d) => { const s = String(d); tail = (tail + s).slice(-2000); s.split(/\r?\n/).filter(Boolean).forEach((l) => onLine?.(l)); };
    p.stdout.on('data', take);
    p.stderr.on('data', take);
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} : ${tail.split('\n').slice(-3).join(' ').slice(0, 300)}`))));
  });
}

function copyCode(from, to) {
  fs.mkdirSync(to, { recursive: true });
  // tout est recopié, sauf les données et réglages de l'utilisateur déjà présents (KEEP)
  fs.cpSync(from, to, { recursive: true, force: true, filter: (s) => {
    const rel = path.relative(from, s).split(path.sep).join('/');
    return !(rel && KEEP.has(rel) && fs.existsSync(path.join(to, rel)));
  } });
}

async function download(url, file, onPct) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Téléchargement impossible (${r.status})`);
  const total = Number(r.headers.get('content-length')) || 0;
  let done = 0;
  const body = Readable.fromWeb(r.body);
  body.on('data', (c) => { done += c.length; if (total) onPct(Math.round((100 * done) / total)); });
  await pipeline(body, fs.createWriteStream(file));
}

/**
 * Installe ce qui manque, étape par étape. `report({ step, status: 'run'|'ok'|'error', detail, pct })` informe l'onboarding.
 * `version` : version de l'app ; le code est recopié quand elle change (mise à jour), le reste seulement s'il manque.
 */
async function install({ resources, dataDir, appDir, version, report }) {
  const mark = path.join(dataDir, 'setup.json');
  const state = (() => { try { return JSON.parse(fs.readFileSync(mark, 'utf8')); } catch { return {}; } })();
  const save = () => fs.writeFileSync(mark, JSON.stringify(state, null, 2));
  const venvPy = path.join(appDir, '.venv', IS_WIN ? 'Scripts' : 'bin', IS_WIN ? 'python.exe' : 'python');
  const step = async (id, fn) => {
    report({ step: id, status: 'run' });
    try { await fn(); report({ step: id, status: 'ok' }); } catch (e) { report({ step: id, status: 'error', detail: e.message }); throw e; }
  };

  await step('code', async () => {
    if (state.code === version && fs.existsSync(path.join(appDir, 'recorder', 'server.js'))) return;
    copyCode(path.join(resources, 'twiin'), appDir);
    state.code = version; save();
  });

  await step('python', async () => {
    if (fs.existsSync(venvPy)) return;
    if (!PY_URL) throw new Error(`Système non pris en charge (${process.platform} ${process.arch}).`);
    const pyDir = path.join(dataDir, 'python');
    if (!fs.existsSync(path.join(pyDir, 'python'))) {
      const tgz = path.join(dataDir, 'python.tar.gz');
      await download(PY_URL, tgz, (pct) => report({ step: 'python', status: 'run', pct }));
      fs.rmSync(pyDir, { recursive: true, force: true });
      fs.mkdirSync(pyDir, { recursive: true });
      await run('tar', ['-xzf', tgz, '-C', pyDir]); // tar existe sur macOS et sur Windows 10 et plus
      fs.rmSync(tgz, { force: true });
    }
    const basePy = path.join(pyDir, 'python', IS_WIN ? 'python.exe' : path.join('bin', 'python3'));
    await run(basePy, ['-m', 'venv', path.join(appDir, '.venv')]);
  });

  await step('deps', async () => {
    if (state.deps === version) return;
    let n = 0;
    await run(venvPy, ['-m', 'pip', 'install', '--disable-pip-version-check', '-q', '-e', appDir], {
      onLine: () => report({ step: 'deps', status: 'run', pct: Math.min(95, ++n) }) });
    state.deps = version; save();
  });

  await step('browser', async () => {
    if (state.browser) return;
    await run(venvPy, ['-m', 'playwright', 'install', 'chromium'], {
      onLine: (l) => { const m = l.match(/(\d+)%/); if (m) report({ step: 'browser', status: 'run', pct: Number(m[1]) }); } });
    state.browser = true; save();
  });

  await step('icons', async () => {
    if (state.icons) return;
    try { await run(venvPy, [path.join(appDir, 'scripts', 'fetch_icons.py')], { cwd: appDir }); } catch { /* logos facultatifs */ }
    state.icons = true; save();
  });
  state.done = version; save();
}

module.exports = { install, IS_WIN };
