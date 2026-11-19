// Relais Twiin : les clés des services restent ici (variables d'environnement Vercel), jamais sur les postes clients.
// L'app envoie son jeton client (TWIIN_CLE) à la place de la vraie clé ; le relais vérifie le jeton, met la vraie clé, transmet.
//   /hf/...                  → https://router.huggingface.co/...   (analyse, narration)
//   /eleven/...              → https://api.elevenlabs.io/...       (voix, transcription)
//   /hai/<hôte>.hcompany.ai/... → https://<hôte>.hcompany.ai/...   (Holo)
//   /sb/session              → connexion Supabase du compte pilote (le mot de passe reste ici)
//   /ping                    → { ok } si le jeton est valide
//   /m, /mobile/...          → télécommande depuis le téléphone (jeton d'appairage, voir _mobile.js)
// Jetons acceptés : TWIIN_CLES (séparés par des virgules). Retirer un jeton coupe l'accès de ce poste, sans toucher aux clés.
import crypto from 'node:crypto';
import { mobile } from './_mobile.js';

const SERVICES = {
  hf: { base: () => 'https://router.huggingface.co', auth: () => ({ authorization: `Bearer ${process.env.HF_TOKEN}` }) },
  eleven: { base: () => 'https://api.elevenlabs.io', auth: () => ({ 'xi-api-key': process.env.ELEVENLABS_API_KEY }) },
};
const DROP = new Set(['host', 'authorization', 'xi-api-key', 'connection', 'content-length', 'accept-encoding', 'x-forwarded-for',
  'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip', 'x-vercel-id', 'forwarded', 'cookie']);

const egal = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
function jetonValide(req) {
  const h = req.headers;
  const t = (h.get('xi-api-key') || (h.get('authorization') || '').replace(/^Bearer\s+/i, '')).trim();
  const ok = (process.env.TWIIN_CLES || '').split(',').map((s) => s.trim()).filter((s) => s.length >= 24);
  return t && ok.some((k) => egal(k, t));
}
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function handler(req) {
  const url = new URL(req.url);
  const chemin = url.searchParams.get('__p') ?? url.pathname.replace(/^\/+/, ''); // ex. hf/v1/chat/completions
  url.searchParams.delete('__p');
  const parts = chemin.replace(/^\/+/, '').split('/');
  if (parts[0] === 'm' && parts.length <= 2 && !parts[1]) return mobile(req, []);
  if (parts[0] === 'mobile') return mobile(req, parts.slice(1));
  if (!jetonValide(req)) return json(401, { error: 'Jeton Twiin invalide ou révoqué.' });
  const svc = parts.shift();

  if (svc === 'ping') return json(200, { ok: true });

  if (svc === 'sb' && parts[0] === 'session') {
    const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_EMAIL, SUPABASE_PASSWORD } = process.env;
    const r = await fetch(`${SUPABASE_URL.replace(/\/+$/, '')}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ email: SUPABASE_EMAIL, password: SUPABASE_PASSWORD }),
    });
    return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json' } });
  }

  let target, auth;
  if (SERVICES[svc]) {
    target = SERVICES[svc].base() + '/' + parts.join('/');
    auth = SERVICES[svc].auth();
  } else if (svc === 'hai') {
    const host = parts.shift() || '';
    if (!/^[a-z0-9.-]+\.hcompany\.ai$/.test(host)) return json(400, { error: 'Hôte non autorisé.' });
    target = `https://${host}/` + parts.join('/');
    auth = { authorization: `Bearer ${process.env.HAI_API_KEY}` };
  } else {
    return json(404, { error: 'Service inconnu.' });
  }
  target += url.searchParams.size ? '?' + url.searchParams : '';

  const headers = {};
  req.headers.forEach((v, k) => { if (!DROP.has(k) && !k.startsWith('x-vercel')) headers[k] = v; });
  Object.assign(headers, auth);
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const r = await fetch(target, { method: req.method, headers, body: hasBody ? req.body : undefined, duplex: hasBody ? 'half' : undefined, redirect: 'manual' });
  const out = new Headers();
  r.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(k)) out.set(k, v); });
  // Redirection de H (ex. /api/v1/trajectories/ → /api/v1/agents/…) : elle doit repasser par le relais, avec le même hôte.
  const loc = r.headers.get('location');
  if (svc === 'hai' && loc) {
    const dest = new URL(loc, target);
    if (dest.hostname.endsWith('.hcompany.ai')) out.set('location', `${url.origin}/hai/${dest.hostname}${dest.pathname}${dest.search}`);
  }
  return new Response(r.body, { status: r.status, headers: out }); // réponse transmise en flux (réponses longues, audio)
}

export const GET = handler, POST = handler, PUT = handler, PATCH = handler, DELETE = handler;
