// Change ce que disent Iris et Ilo sur la page d'ouverture (voix ElevenLabs, avec le minutage de chaque mot).
//
//   node recorder/scripts/accueil.mjs --iris "Bonjour JC ! Nous sommes Twiin." \
//        --ensemble "Prêt à découvrir notre solution ?" --bouton "C'est parti"
//
//   --iris      ce que dit Iris (voix « Victoria »), en premier, en noir
//   --ilo       ce que dit Ilo (voix « Corentin »), ensuite, en gris (facultatif : sinon on garde la réplique actuelle)
//   --ensemble  ce qu'ils disent tous les deux à la fin (facultatif : sinon on garde la réplique actuelle)
//   --bouton    le texte du bouton final (facultatif)
//
// Écrit recorder/public/voix/{iris-1,ilo-1,iris-2,ilo-2}.{mp3,json} et voix/accueil.json, que bienvenue.js lit au démarrage.
// La clé ElevenLabs est lue dans twiin/.env (ELEVENLABS_API_KEY). Aucun redémarrage nécessaire : recharge la page.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const VOIX = path.join(ICI, '..', 'public', 'voix');
const ENV = path.join(ICI, '..', '..', '.env');

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const cle = process.env.ELEVENLABS_API_KEY
  || (fs.existsSync(ENV) && /^ELEVENLABS_API_KEY=(.*)$/m.exec(fs.readFileSync(ENV, 'utf8'))?.[1]?.trim().replace(/^["']|["']$/g, ''));
if (!cle) { console.error('ELEVENLABS_API_KEY introuvable (twiin/.env).'); process.exit(1); }

// Mêmes voix et réglages que les questions de l'audit (recorder/server.js, JUMEAUX)
const JUMEAUX = {
  iris: { id: 'O31r762Gb3WFygrEOGh0', reglages: { stability: 0.4, similarity_boost: 0.8, style: 0.5, use_speaker_boost: true } },
  ilo: { id: 'IHngRooVccHyPqB4uQkG', reglages: { stability: 0.6, similarity_boost: 0.8, style: 0.15, use_speaker_boost: false } },
};

async function generer(nom, qui, texte) {
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${JUMEAUX[qui].id}/with-timestamps?output_format=mp3_44100_96`, {
    method: 'POST', headers: { 'xi-api-key': cle, 'content-type': 'application/json' },
    body: JSON.stringify({ text: texte, model_id: 'eleven_multilingual_v2', language_code: 'fr', voice_settings: JUMEAUX[qui].reglages }),
  });
  if (!r.ok) throw new Error(`ElevenLabs ${r.status} : ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  fs.writeFileSync(path.join(VOIX, `${nom}.mp3`), Buffer.from(d.audio_base64, 'base64'));
  // les mots et l'instant où chacun commence
  const a = d.alignment, mots = [];
  let cur = '', t0 = 0;
  a.characters.forEach((c, i) => {
    if (/\s/.test(c)) { if (cur) mots.push([cur, +t0.toFixed(3)]); cur = ''; return; }
    if (!cur) t0 = a.character_start_times_seconds[i];
    cur += c;
  });
  if (cur) mots.push([cur, +t0.toFixed(3)]);
  const res = { texte, mots, fin: +a.character_end_times_seconds.at(-1).toFixed(3) };
  fs.writeFileSync(path.join(VOIX, `${nom}.json`), JSON.stringify(res));
  console.log(`${nom} (${qui}) : « ${texte} » · ${res.fin} s`);
  return res;
}

const lire = (nom) => JSON.parse(fs.readFileSync(path.join(VOIX, `${nom}.json`), 'utf8'));
const iris1 = args.iris ? await generer('iris-1', 'iris', args.iris) : lire('iris-1');
const ilo1 = args.ilo ? await generer('ilo-1', 'ilo', args.ilo) : lire('ilo-1');
let iris2 = lire('iris-2'), ilo2 = lire('ilo-2');
if (args.ensemble) { [iris2, ilo2] = await Promise.all([generer('iris-2', 'iris', args.ensemble), generer('ilo-2', 'ilo', args.ensemble)]); }

const ancien = fs.existsSync(path.join(VOIX, 'accueil.json')) ? JSON.parse(fs.readFileSync(path.join(VOIX, 'accueil.json'), 'utf8')) : {};
const accueil = {
  bouton: args.bouton || ancien.bouton || 'Allons-y',
  segs: [
    { qui: [0], clips: ['iris-1'], ton: 'ink', mots: iris1.mots, fin: iris1.fin },
    { qui: [1], clips: ['ilo-1'], ton: 'dim', mots: ilo1.mots, fin: ilo1.fin },
    { qui: [0, 1], clips: ['iris-2', 'ilo-2'], ton: null, mots: [], fin: Math.max(iris2.fin, ilo2.fin), texte: iris2.texte },
  ],
};
fs.writeFileSync(path.join(VOIX, 'accueil.json'), JSON.stringify(accueil, null, 1));
console.log(`voix/accueil.json écrit. Pour revoir l'ouverture : http://localhost:3000/?bienvenue`);
