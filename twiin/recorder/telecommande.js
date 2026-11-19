// Télécommande : piloter ce Mac depuis son téléphone.
// Le Mac lance le pont officiel de H (`holo local desktop`), qui attend les ordres de l'agent H à travers le relais Twiin
// (jeton client TWIIN_CLE : aucune clé H sur le poste). Le téléphone reçoit un jeton d'appairage signé par ce Mac,
// limité à ce pont et à une durée : il ouvre ${TWIIN_RELAIS}/m, parle ou écrit, et voit l'écran en direct.
import { spawn, spawnSync, execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import QRCode from 'qrcode';

const DUREE_H = 24; // durée d'un appairage
const PAQUETS = ['holo-desktop-cli', 'hai-agents[desktop]'];

export function mountTelecommande(app, { isLocal, root, port, analyser }) {
  const HOLO_VENV = path.join(root, 'workflows', 'holo-venv');
  const ETAT = path.join(root, 'workflows', 'telecommande.json'); // appairage en cours (pont + expiration), jamais publié
  const bin = (d) => path.join(d, 'bin', 'holo');
  let pont = null, etat = 'off', erreur = null, journal = [];

  // Relais et jeton client : ceux de l'app installée (.env), sinon, en développement, la configuration pilote.
  function config() {
    let relais = process.env.TWIIN_RELAIS, cle = process.env.TWIIN_CLE;
    if (!relais || !cle) {
      try {
        const txt = fs.readFileSync(path.join(root, 'desktop', 'config-pilote.env'), 'utf8');
        const val = (k) => (txt.match(new RegExp(`^${k}=\\s*"?([^"\\n#]+)`, 'm')) || [])[1]?.trim();
        relais ||= val('TWIIN_RELAIS'); cle ||= val('TWIIN_CLE');
      } catch {}
    }
    return relais && cle ? { relais: relais.replace(/\/+$/, ''), cle } : null;
  }
  // Un environnement est prêt s'il a Python ≥ 3.12, le CLI et les pilotes du bureau (un vieux `holo` en 3.11 ne suffit pas).
  let pret = null;
  const essai = (d) => new Promise((res) => execFile(path.join(d, 'bin', 'python'), ['-c',
    'import sys, hai_agents_cli, hai_drivers.desktop; assert sys.version_info >= (3, 12)'], { timeout: 30000 }, (e) => res(!e && fs.existsSync(bin(d)))));
  async function holoBin() {
    if (process.env.HOLO_BIN) return process.env.HOLO_BIN;
    if (pret && fs.existsSync(pret)) return pret;
    for (const d of [HOLO_VENV, path.join(root, '.venv')]) if (fs.existsSync(bin(d)) && (await essai(d))) return (pret = bin(d));
    return null;
  }
  const lire = () => {
    let a = null;
    try { a = JSON.parse(fs.readFileSync(ETAT, 'utf8')); } catch { return null; }
    // Clé AES-256 propre à cet appairage, transmise au téléphone dans le QR code (jamais au serveur) : elle chiffre
    // les fichiers envoyés au téléphone. Ajoutée aux anciens appairages (il faut alors rescanner le QR une fois).
    if (a && !a.k) { a.k = crypto.randomBytes(32).toString('base64url'); fs.writeFileSync(ETAT, JSON.stringify(a), { mode: 0o600 }); }
    return a;
  };
  const log = (l) => { journal.push(String(l).trim()); journal = journal.slice(-30); };

  function run(cmd, args) {
    return new Promise((res, rej) => execFile(cmd, args, { timeout: 10 * 60000, maxBuffer: 8 << 20 }, (e, out, errOut) => {
      if (e) { log(errOut || e.message); rej(new Error(String(errOut || e.message).split('\n').filter(Boolean).slice(-2).join(' '))); } else res(String(out).trim());
    }));
  }
  // Le pont demande Python ≥ 3.12 : le .venv de l'app installée (3.12) ; en développement, un environnement à part (uv).
  async function installer() {
    const py = path.join(root, '.venv', 'bin', 'python');
    if (fs.existsSync(py) && (await run(py, ['-c', 'import sys; print(sys.version_info >= (3, 12))']).catch(() => '')) === 'True') {
      await run(py, ['-m', 'pip', 'install', '--quiet', ...PAQUETS]);
      return;
    }
    const uv = ['/opt/homebrew/bin/uv', '/usr/local/bin/uv', path.join(process.env.HOME || '', '.local', 'bin', 'uv')].find((u) => fs.existsSync(u));
    if (!uv) throw new Error('Python 3.12 introuvable pour la télécommande (installe uv : brew install uv).');
    if (!fs.existsSync(path.join(HOLO_VENV, 'bin', 'python'))) await run(uv, ['venv', '--quiet', '-p', '3.12', HOLO_VENV]);
    await run(uv, ['pip', 'install', '--quiet', '--python', path.join(HOLO_VENV, 'bin', 'python'), ...PAQUETS]);
  }

  function jeton(cle, id, exp) {
    const p = `m1.${id}.${exp}`;
    return `${p}.${crypto.createHmac('sha256', cle).update(p).digest('base64url')}`;
  }

  async function vue() {
    const cfg = config();
    const a = lire();
    const out = { disponible: !!cfg, etat, erreur };
    if (!cfg) out.erreur = 'Télécommande indisponible : cette installation n\'a pas de relais Twiin (TWIIN_RELAIS, TWIIN_CLE).';
    if (cfg && a && etat === 'on') {
      // Prénom et nom de la fiche Twiin, pour que la dictée du téléphone les reconnaisse. Ils sont dans le fragment (#…),
      // qui reste sur le téléphone et n'est jamais envoyé au serveur.
      let noms = '';
      try {
        const f = (await (await fetch(`http://127.0.0.1:${port}/api/onboarding/profile`)).json()).profile || {}; // compte en ligne ou fiche locale
        noms = [f.prenom, f.nom].filter(Boolean).join('|');
      } catch { /* pas de fiche */ }
      out.url = `${cfg.relais}/m#t=${jeton(cfg.cle, a.pont, a.exp)}&k=${a.k}${noms ? `&m=${encodeURIComponent(noms)}` : ''}`;
      out.qr = await QRCode.toString(out.url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#121418', light: '#ffffff' } });
      out.expire = a.exp * 1000;
    }
    return out;
  }

  async function demarrer({ nouveau } = {}) {
    const cfg = config();
    if (!cfg) throw new Error('Pas de relais Twiin configuré.');
    if (pont) return;
    erreur = null;
    let holo = await holoBin();
    if (!holo) {
      etat = 'installation';
      await installer();
      pret = null;
      holo = await holoBin();
      if (!holo) throw new Error('Installation du pont H incomplète.');
    }
    let a = lire();
    if (nouveau || !a || a.exp * 1000 < Date.now() + 3600e3) { // nouvel appairage : l'ancien QR code ne sert plus à rien
      a = { pont: crypto.randomUUID(), exp: Math.floor(Date.now() / 1000) + DUREE_H * 3600, k: crypto.randomBytes(32).toString('base64url') };
      fs.mkdirSync(path.dirname(ETAT), { recursive: true });
      fs.writeFileSync(ETAT, JSON.stringify(a), { mode: 0o600 });
    }
    etat = 'demarrage';
    // Un ancien pont pour le même appairage peut survivre à un redémarrage brutal de l'app (il n'est pas tué avec elle) :
    // H refuserait alors le nouveau (« another agent is driving this desktop ») et les outils Twiin ne répondraient plus.
    spawnSync('pkill', ['-f', `holo local desktop --session-id ${a.pont}`]);
    await new Promise((r) => setTimeout(r, 600));
    const env = { ...process.env, HAI_API_KEY: cfg.cle, HAI_API_BASE_URL: `${cfg.relais}/hai/agp.eu.hcompany.ai`, PYTHONUNBUFFERED: '1' };
    for (const k of ['HAI_AUTO_BRIDGE', 'HAI_SHELL_POLICY', 'HAI_SHELL_SANDBOX', 'HAI_SHELL_WORKSPACE', 'ELECTRON_RUN_AS_NODE']) delete env[k];
    const p = spawn(holo, ['local', 'desktop', '--session-id', a.pont, '--max-width', '1280'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    pont = p;
    const lignes = (buf) => String(buf).split('\n').forEach((l) => {
      if (!l.trim()) return;
      log(l.replace(/Bearer\s+\S+/g, 'Bearer ***'));
      if (/serving session id/i.test(l)) etat = 'on';
      if (/trajectories\/[\w-]+ "HTTP\/1\.1 200/.test(l)) etat = 'on';
    });
    p.stdout.on('data', lignes);
    p.stderr.on('data', lignes);
    p.on('exit', (code) => {
      if (pont !== p) return;
      pont = null;
      if (etat !== 'off') { etat = code ? 'erreur' : 'off'; if (code) erreur = journal.filter((l) => /●|error|erreur/i.test(l)).slice(-1)[0] || `Le pont H s'est arrêté (code ${code}).`; }
    });
    for (let i = 0; i < 40 && pont === p && etat === 'demarrage'; i++) await new Promise((r) => setTimeout(r, 250));
    if (pont === p && etat === 'demarrage') etat = 'on'; // le pont tourne : l'annonce peut arriver après
    veiller();
  }

  // --- Outils Twiin : l'agent H les appelle, ce Mac les exécute (il repère ses sessions au nom « twiin-tc-<pont> ») ---
  const LOCAL = `http://127.0.0.1:${port}`;
  const importees = new Map(); // « session H : début de la tâche » → enregistrement Twiin (pas de doublon)
  let derniere = null;          // dernier enregistrement venu du téléphone
  const donnee = (e) => { const d = e?.data; return (d && typeof d.data === 'object' && d.data) || d || {}; };
  const faits = new Set(), index = new Map();
  let veille = null;
  async function hai(cfg, method, p, body) {
    const r = await fetch(`${cfg.relais}/hai/agp.eu.hcompany.ai/api/v2${p}`, { method,
      headers: { authorization: `Bearer ${cfg.cle}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) throw new Error(`H ${r.status}`);
    return r.status === 204 ? null : r.json();
  }
  async function outil(nom, args, sid) {
    if (nom === 'twiin_automatisations') {
      const d = await (await fetch(`${LOCAL}/api/automations`)).json();
      if (!d.up) return "Le moteur d'automatisations (n8n) est arrêté sur le Mac : aucune automatisation disponible pour l'instant.";
      return JSON.stringify((d.automations || []).map((a) => ({ id: a.id, nom: a.name, etapes: (a.blocks || []).map((b) => b.name), frequence: a.freq_label,
        derniere_execution: a.executions?.[0] ? { statut: a.executions[0].status, debut: a.executions[0].startedAt } : null })));
    }
    if (nom === 'twiin_lancer_automatisation') {
      const id = String(args?.id || '');
      if (!/^[\w-]{1,80}$/.test(id)) throw new Error('id invalide');
      const r = await fetch(`${LOCAL}/api/automations/${encodeURIComponent(id)}/run`, { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `refus (${r.status})`);
      return `Automatisation ${id} lancée sur le Mac.`;
    }
    if (nom === 'twiin_enregistrer_tache') return importer(sid);
    if (nom === 'twiin_etat') return JSON.stringify(await (await fetch(`${LOCAL}/api/automations/etat`)).json());
    if (nom === 'twiin_envoyer_fichier') return envoyerFichier(args?.chemin);
    if (nom === 'twiin_enregistrements') {
      const d = await (await fetch(`${LOCAL}/api/sessions`)).json();
      return JSON.stringify((d.sessions || []).filter((e) => !e.supprime_le).slice(0, 8).map((e) => ({ id: e.id, titre: e.titre, date: e.startedAt,
        depuis: e.source === 'telecommande' ? 'téléphone' : 'ordinateur', analyse: e.analyse, etapes: e.nb_etapes })));
    }
    if (nom === 'twiin_automatiser') return lancerTravail('automatisation', args?.id, sid);
    if (nom === 'twiin_creer_video') return lancerTravail('video', args?.id, sid);
    if (nom === 'twiin_suivi') {
      const prog = await (await fetch(`${LOCAL}/api/analysis/progress`)).json().catch(() => ({}));
      return JSON.stringify({ travaux: travaux.map((j) => ({ quoi: j.type, tache: j.titre || j.id, etat: ETATS[j.etat], detail: j.detail || undefined,
        depuis_min: Math.round((Date.now() - j.debut) / 60e3) })), analyse_en_cours: prog.phase && prog.phase !== 'idle' ? prog.phase : null });
    }
    throw new Error(`outil inconnu : ${nom}`);
  }

  // --- Automatiser / faire la vidéo d'une tâche, demandé depuis le téléphone ------------------------------------------
  // Mêmes fonctions que dans Twiin (analyse → plan n8n → import et test ; ou images → voix off → montage), lancées en
  // arrière-plan. À la fin, Twiin écrit dans la conversation du téléphone pour le prévenir.
  const ETATS = { analyse: "analyse de l'enregistrement", creation: 'création en cours', pret: 'prête', echec: 'échec' };
  const dodo = (ms) => new Promise((r) => setTimeout(r, ms));
  const getJ = async (u) => (await fetch(`${LOCAL}${u}`)).json();
  const postJ = async (u, body) => {
    const r = await fetch(`${LOCAL}${u}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) { const e = new Error(d.error || `refus (${r.status})`); e.status = r.status; throw e; }
    return d;
  };
  async function quelEnregistrement(id) {
    if (id && /^[\w-]{1,40}$/.test(id)) return id;
    if (derniere) return derniere; // la dernière tâche faite depuis le téléphone
    const d = await getJ('/api/sessions');
    const e = (d.sessions || []).find((x) => !x.supprime_le);
    if (!e) throw new Error('aucun enregistrement dans Twiin');
    return e.id;
  }
  async function attendreAnalyse(id, job) {
    let lancee = false;
    for (let i = 0; i < 100; i++) { // jusqu'à ~8 min
      const d = await getJ(`/api/sessions/${encodeURIComponent(id)}`);
      if (d.error) throw new Error(d.error);
      const wf = d.analyse_complete?.result?.workflows?.[0];
      if (wf) return { ...wf, session: id };
      const prog = await getJ('/api/analysis/progress').catch(() => ({}));
      if (!lancee && (!prog.phase || prog.phase === 'idle')) { lancee = true; postJ(`/api/sessions/${encodeURIComponent(id)}/analyze`).catch(() => { lancee = false; }); }
      job.detail = prog.phase && prog.phase !== 'idle' ? `analyse : ${prog.phase}` : '';
      await dodo(5000);
    }
    throw new Error("l'analyse de l'enregistrement prend trop de temps");
  }
  async function prevenir(job) {
    const cfg = config();
    if (!cfg || !job.sid) return;
    const quoi = job.type === 'automatisation' ? 'automatisation' : 'vidéo de formation';
    const fait = job.etat === 'pret'
      ? (job.type === 'automatisation' ? `L'automatisation de « ${job.titre} » est prête et testée : elle est dans « Mes automatisations » (en pause, à activer).`
        : `La vidéo de formation de « ${job.titre} » est prête : elle est dans « Mes vidéos ».`)
      : `La ${quoi} de « ${job.titre || job.id} » n'a pas pu être créée : ${job.detail || 'erreur'}.`;
    await hai(cfg, 'POST', `/sessions/${job.sid}/messages`, { type: 'user_message',
      message: `[Message automatique de Twiin, pas de l'utilisateur] ${fait} Annonce-le à l'utilisateur en une phrase, sans rien faire à l'écran.` }).catch(() => {});
  }
  const travaux = [];
  async function lancerTravail(type, idDemande, sid) {
    const id = await quelEnregistrement(idDemande);
    if (travaux.some((j) => j.id === id && j.type === type && !['pret', 'echec'].includes(j.etat))) return `C'est déjà en cours pour cet enregistrement.`;
    const job = { type, id, sid, etat: 'analyse', detail: '', debut: Date.now() };
    travaux.unshift(job); travaux.splice(8);
    (async () => {
      try {
        const wf = await attendreAnalyse(id, job);
        job.titre = wf.name; job.etat = 'creation'; job.detail = '';
        if (type === 'automatisation') {
          await postJ('/api/n8n/create', { workflow: wf });
          let since = 0, fin = null;
          for (let i = 0; i < 180 && !fin; i++) { // test compris : jusqu'à ~15 min
            await dodo(5000);
            const ev = await getJ(`/api/n8n/events?since=${since}`);
            since = ev.next ?? since;
            fin = (ev.events || []).find((e) => e.type === 'done') || (ev.running === false && i > 2 ? { ok: false, status: 'création interrompue' } : null);
          }
          job.etat = fin?.ok ? 'pret' : 'echec'; job.detail = fin?.ok ? '' : String(fin?.status || 'trop long').slice(0, 200);
        } else {
          await postJ('/api/tuto/create', { workflow: wf });
          let st = null;
          for (let i = 0; i < 120; i++) { await dodo(5000); st = await getJ('/api/tuto/status'); if (!st.running) break; job.detail = st.phase || ''; }
          job.etat = st && !st.running && !st.error ? 'pret' : 'echec'; job.detail = st?.error || (st?.running ? 'trop long' : '');
        }
      } catch (e) { job.etat = 'echec'; job.detail = e.message; }
      log(`${type} depuis le téléphone : ${job.etat}${job.detail ? ` (${job.detail})` : ''}`);
      prevenir(job);
    })();
    const deja = derniere === id ? 'la tâche que tu viens de faire' : `l'enregistrement ${id}`;
    return `C'est lancé sur le Mac pour ${deja} : ${type === 'automatisation' ? "analyse, puis création et test de l'automatisation" : 'analyse, puis images, voix off et montage de la vidéo'} (quelques minutes). Je te préviens ici quand c'est prêt.`;
  }

  // --- Un fichier du Mac vers le téléphone : chiffré ici, déposé via le relais, téléchargé et déchiffré par le téléphone ---
  const MAX_FICHIER = 3 * 1024 * 1024;
  const INTERDITS = /(^|\/)(\.ssh|\.gnupg|\.aws|\.kube|\.docker|\.config|Keychains|\.Trash)(\/|$)|(^|\/)\.env[^/]*$|config-pilote\.env$|\.(pem|key|p12|keychain-db)$/i;
  function trouver(chemin) {
    const maison = os.homedir();
    let c = String(chemin || '').trim().replace(/^~(?=\/|$)/, maison);
    if (!c) throw new Error('chemin manquant');
    if (!c.includes('/')) { // un simple nom : on le cherche dans Documents, Bureau, Téléchargements (le plus récent)
      const vus = ['Documents', 'Desktop', 'Downloads'].map((d) => path.join(maison, d, c)).filter((f) => fs.existsSync(f));
      if (!vus.length) throw new Error(`« ${c} » introuvable dans Documents, Bureau ou Téléchargements`);
      c = vus.sort((x, y) => fs.statSync(y).mtimeMs - fs.statSync(x).mtimeMs)[0];
    }
    const vrai = fs.realpathSync(path.resolve(c));
    if (!vrai.startsWith(maison + path.sep)) throw new Error('seuls les fichiers de ton dossier personnel peuvent être envoyés');
    if (INTERDITS.test(vrai)) throw new Error('ce fichier est protégé (clés, mots de passe, configuration) : il ne sera pas envoyé');
    const st = fs.statSync(vrai);
    if (!st.isFile()) throw new Error("ce n'est pas un fichier");
    if (st.size > MAX_FICHIER) throw new Error(`fichier trop lourd pour le téléphone (${Math.round(st.size / 1e6)} Mo, 3 Mo maximum)`);
    return vrai;
  }
  const TYPES = { pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', rtf: 'application/rtf',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', heic: 'image/heic', html: 'text/html',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', pages: 'application/x-iwork-pages-sffpages',
    numbers: 'application/x-iwork-numbers-sffnumbers', key: 'application/x-iwork-keynote-sffkey', zip: 'application/zip' };
  async function envoyerFichier(chemin) {
    const cfg = config(), a = lire();
    if (!cfg || !a?.k) throw new Error('télécommande non appairée');
    const f = trouver(chemin);
    const nom = path.basename(f);
    const type = TYPES[path.extname(f).slice(1).toLowerCase()] || 'application/octet-stream';
    // en clair (avant chiffrement) : [longueur de l'en-tête sur 4 octets][en-tête JSON {nom, type}][contenu]
    const entete = Buffer.from(JSON.stringify({ nom, type }));
    const lg = Buffer.alloc(4); lg.writeUInt32BE(entete.length);
    const clair = Buffer.concat([lg, entete, fs.readFileSync(f)]);
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', Buffer.from(a.k, 'base64url'), iv);
    const chiffre = Buffer.concat([iv, c.update(clair), c.final(), c.getAuthTag()]); // iv | données | étiquette (format WebCrypto)
    const r = await fetch(`${cfg.relais}/mobile/depot`, { method: 'POST', body: chiffre,
      headers: { authorization: `Bearer ${cfg.cle}`, 'x-twiin-pont': a.pont, 'content-type': 'application/octet-stream' } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `dépôt refusé (${r.status})`);
    log(`Fichier envoyé au téléphone : ${nom}`);
    const ko = Math.max(1, Math.round(fs.statSync(f).size / 1024));
    return `Fichier « ${nom} » envoyé sur le téléphone (${ko} Ko) : il est téléchargeable dans la conversation pendant une heure. [[twiin-fichier:${d.id}:${encodeURIComponent(nom)}:${ko}]]`;
  }
  // --- Enregistrer dans Twiin une tâche faite par Holo depuis le téléphone ---------------------------------------------
  // On relit la session H (captures + actions de l'agent) et on écrit un enregistrement Twiin normal (frames.jsonl,
  // actions.jsonl, session.json) : il apparaît dans « Mes enregistrements », puis passe par le masquage et l'analyse.
  async function importer(sid, { auto = false } = {}) {
    const cfg = config();
    const tous = [];
    for (let from = 0, i = 0; i < 20; i++) {
      const c = await hai(cfg, 'GET', `/sessions/${sid}/changes?from_index=${from}&wait_for_seconds=0`);
      const ev = c?.new_events || [];
      if (!ev.length) break;
      tous.push(...ev);
      from = (c.first_index ?? from) + ev.length;
    }
    const data = (e) => { const d = e?.data; return (d && typeof d.data === 'object' && d.data) || d || {}; };
    const texte = (e) => { const c = data(e).content; return (Array.isArray(c) ? c.join(' ') : String(c || '')).trim(); };
    const demandes = tous.map((e, i) => (data(e).kind === 'message_event' && data(e).caller_id === 'user' ? i : -1)).filter((i) => i >= 0);
    // La demande d'enregistrement elle-même n'en fait pas partie : on garde la dernière tâche avant elle.
    let fin = tous.length;
    if (!auto) for (const i of [...demandes].reverse()) if (/enregistr/i.test(texte(tous[i])) && /twiin/i.test(texte(tous[i]))) { fin = i; break; }
    const debut = [...demandes].reverse().find((i) => i < fin);
    if (debut == null) throw new Error('aucune tâche à enregistrer dans cette session');
    const cleTache = `${sid}:${debut}`;
    if (importees.has(cleTache)) { // déjà enregistrée automatiquement à la fin de la tâche
      if (auto) return null;
      return `Cette tâche est déjà dans Twiin (« Mes enregistrements »), enregistrée automatiquement à la fin.`;
    }
    const tranche = tous.slice(debut, fin);
    const instruction = texte(tous[debut]);
    const ts = (e) => Date.parse(e.timestamp) / 1000;
    const t0 = ts(tous[debut]);

    const frames = [], actions = [{ ts: t0, type: 'start', clicks_and_keys: true, accessibility: true, source: 'telecommande' },
      { ts: t0, until: t0 + 2, type: 'voice', text: instruction }];
    for (const e of tranche) {
      const d = data(e);
      if (d.kind === 'observation_event' && typeof d.image?.source === 'string') {
        const u = new URL(d.image.source, 'https://agp.eu.hcompany.ai');
        const via = u.hostname.endsWith('.hcompany.ai') ? `${cfg.relais}/hai/${u.hostname}${u.pathname}${u.search}` : null;
        if (!via) continue;
        const r = await fetch(via, { headers: { authorization: `Bearer ${cfg.cle}` } });
        if (!r.ok) continue;
        const b64 = Buffer.from(await r.arrayBuffer()).toString('base64');
        frames.push({ index: frames.length, timestamp: e.timestamp, seconds: +(ts(e) - t0).toFixed(1), screen: 1, screen_label: 'Écran du Mac (télécommande)',
          dataUrl: `data:${d.image.media_type || 'image/jpeg'};base64,${b64}` });
      }
      if (d.kind === 'policy_event') {
        for (const t of d.tool_reqs || []) {
          const n = String(t?.tool_name || '').replace(/_desktop$/, ''), a = t?.args || {}, at = ts(e);
          const el = a.element || null;
          if (/click/.test(n)) actions.push({ ts: at, type: 'click', button: a.button || 'left', double: /double/.test(n), display: 1, element: el });
          else if (/^(write|type)/.test(n)) actions.push({ ts: at, until: at + 1, type: 'typing', display: 1, keys: String(a.content ?? a.text ?? '').length,
            element: `${el || 'le champ actif'} (texte saisi : « ${String(a.content ?? a.text ?? '').slice(0, 200)} »)` });
          else if (/hotkey/.test(n)) actions.push({ ts: at, type: 'shortcut', display: 1, keys: [].concat(a.keys || []).join('+') });
          else if (/^(key|press)/.test(n)) actions.push({ ts: at, type: 'key', display: 1, keys: [].concat(a.keys || a.key || []).join('+') });
        }
      }
    }
    if (!frames.length) throw new Error("aucune capture d'écran dans cette tâche");
    if (actions.length <= 2) throw new Error("aucune action à l'écran dans cette tâche"); // une simple question n'est pas une tâche
    const id = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dir = path.join(root, 'workflows', 'sessions', id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'frames.jsonl'), frames.map((f) => JSON.stringify(f)).join('\n') + '\n');
    fs.writeFileSync(path.join(dir, 'actions.jsonl'), actions.map((a) => JSON.stringify(a)).join('\n') + '\n');
    fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({ startedAt: Math.round(t0 * 1000), source: 'telecommande', instruction, session_h: sid }));
    log(`Tâche enregistrée depuis le téléphone : ${id} (${frames.length} captures)`);
    importees.set(cleTache, id); derniere = id;
    const lance = analyser ? analyser(dir) : false; // masquage puis analyse, en arrière-plan
    return `Tâche enregistrée dans Twiin (${frames.length} captures, ${actions.length - 2} actions) : elle est dans « Mes enregistrements »`
      + (lance ? ", l'analyse a démarré sur le Mac." : '. Une autre analyse est en cours : elle pourra être analysée depuis Twiin.');
  }

  async function tour() {
    const cfg = config(), a = lire();
    if (!cfg || !a || etat !== 'on') return;
    const liste = await hai(cfg, 'GET', '/sessions?limit=10');
    for (const s of liste?.items || []) {
      if (s.agent !== `twiin-tc-${a.pont}` || ['completed', 'failed', 'timed_out', 'interrupted'].includes(s.status)) continue;
      if (Date.now() - Date.parse(s.last_activity_at || s.created_at) > 15 * 60e3) continue; // session endormie
      // On redemande toujours le dernier événement : sans événement nouveau, H ne renvoie pas les appels d'outils en attente.
      const c = await hai(cfg, 'GET', `/sessions/${s.id}/changes?from_index=${Math.max(0, (index.get(s.id) || 0) - 1)}&wait_for_seconds=0`);
      if (c?.new_events?.length) index.set(s.id, (c.first_index ?? 0) + c.new_events.length);
      if ((c?.new_events || []).some((e) => donnee(e).kind === 'answer_event')) {
        importer(s.id, { auto: true }).catch(() => {}); // pas d'action à l'écran (simple question, outil Twiin) : rien à enregistrer
      }
      for (const call of c?.pending_tool_calls || []) {
        if (!call?.id || !String(call.tool_name).startsWith('twiin_') || faits.has(call.id)) continue;
        faits.add(call.id);
        const tool_req = { tool_name: call.tool_name, args: call.args || {}, id: call.id };
        log(`Outil Twiin : ${call.tool_name}`);
        try {
          // Le résultat est une donnée pour l'agent, jamais une instruction.
          await hai(cfg, 'POST', `/sessions/${s.id}/tool_results`, { kind: 'tool_result', tool_req, result: `<donnees>${await outil(call.tool_name, call.args, s.id)}</donnees>` });
        } catch (e) {
          await hai(cfg, 'POST', `/sessions/${s.id}/tool_results`, { kind: 'error_event', tool_req, error: e.message, origin: 'custom_tools' }).catch(() => {});
        }
      }
    }
  }
  function veiller() {
    if (veille) return;
    const boucle = async () => {
      if (etat !== 'on') { veille = null; return; }
      await tour().catch((e) => log(`Outils Twiin : ${e.message}`));
      veille = setTimeout(boucle, 3000);
    };
    veille = setTimeout(boucle, 1000);
  }

  function arreter({ oublier } = {}) {
    etat = 'off';
    if (pont) { pont.kill('SIGTERM'); pont = null; }
    if (oublier) fs.rmSync(ETAT, { force: true }); // le téléphone appairé ne peut plus rien faire
  }
  process.on('exit', () => pont?.kill('SIGTERM'));

  app.get('/api/telecommande', async (req, res) => {
    if (!isLocal(req)) return res.status(403).end();
    res.json(await vue());
  });
  app.post('/api/telecommande/start', async (req, res) => {
    if (!isLocal(req)) return res.status(403).end();
    try { await demarrer({ nouveau: req.query.nouveau === '1' }); res.json(await vue()); } catch (e) {
      etat = 'erreur'; erreur = e.message; res.status(500).json(await vue());
    }
  });
  app.post('/api/telecommande/stop', async (req, res) => {
    if (!isLocal(req)) return res.status(403).end();
    arreter({ oublier: req.query.oublier === '1' });
    res.json(await vue());
  });
}
