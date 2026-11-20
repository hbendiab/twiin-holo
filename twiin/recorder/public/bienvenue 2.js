// Page d'ouverture de Twiin : une goutte de chrome liquide apparaît, cligne des yeux, puis se dédouble.
// Twin = jumeau : Iris (reflet bleu) et Ilo (reflet lilas) naissent de la même goutte, saluent, et présentent Twiin.
// Rendu WebGL sans bibliothèque (lancer de rayons sur deux sphères fondues l'une dans l'autre), visages en HTML par-dessus.
(() => {
  if (window.TwiinBienvenue) return;

  // Ce qu'ils disent : voix ElevenLabs générées une fois (voix/*.mp3), avec l'instant où commence chaque mot.
  // Le texte se change avec recorder/scripts/accueil.mjs, qui écrit voix/accueil.json (lu au démarrage) ; ci-dessous, la version par défaut.
  // Iris (voix « Victoria ») salue, Ilo (voix « Corentin ») donne l'accroche, puis les deux ensemble : « On se met au travail ? »
  let SEGS = [
    { qui: [0], clips: ['iris-1'], ton: 'ink', mots: [["Bonjour", 0.0], ["!", 0.488], ["Bienvenue", 0.557], ["sur", 0.906], ["Twiin", 1.057], ["!", 1.382]], fin: 1.533 },
    { qui: [1], clips: ['ilo-1'], ton: 'dim', mots: [["Analyse", 0.0], ["tes", 0.453], ["tâches.", 0.604], ["Automatise", 1.08], ["tes", 1.73], ["process.", 1.846]], fin: 2.554 },
    { qui: [0, 1], clips: ['iris-2', 'ilo-2'], ton: null, mots: [], fin: 1.393 },
  ];
  let BOUTON = 'Allons-y';
  const placer = () => SEGS.reduce((at, sg, i) => (sg.at = at, at + sg.fin + (i ? .45 : .3)), 0);
  placer();
  // Volume égalisé automatiquement : chaque réplique est ramenée au même niveau moyen (≈ -22 dB), Iris comme Ilo
  async function egaliser(nom, audio) {
    try {
      const buf = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await (await fetch(`/voix/${nom}.mp3`)).arrayBuffer());
      const d = buf.getChannelData(0); let s2 = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { const v = Math.abs(d[i]); if (v > .02) { s2 += v * v; n++; } }
      if (n) audio.volume = Math.min(1, Math.pow(10, -22 / 20) / Math.sqrt(s2 / n)) * (nom === 'ilo-2' ? .9 : 1); // à deux, Ilo un peu en retrait
    } catch { /* volume par défaut */ }
  }


  const CSS = `
.twb { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; overflow: hidden;
  background: var(--canvas, #fff); color: var(--ink, #161615); font-family: var(--font, -apple-system, "SF Pro Text", Inter, system-ui, sans-serif);
  transition: opacity .7s cubic-bezier(.16,1,.3,1), transform .7s cubic-bezier(.16,1,.3,1); }
.twb.out { opacity: 0; transform: scale(1.03); pointer-events: none; }
.twb-in { display: grid; justify-items: center; width: min(760px, calc(100vw - 32px)); }
.twb-logo { font-size: clamp(54px, 11vw, 104px); font-weight: 600; letter-spacing: -0.05em; line-height: 1; margin: 0 0 4px; display: flex; align-items: baseline; }
.twb-logo > span { display: inline-block; opacity: 0; transform: translateY(.25em); }
.twb.logo .twb-logo > span { animation: twbRise .9s cubic-bezier(.16,1,.3,1) forwards; animation-delay: calc(var(--k) * 70ms); }
.twb-i { position: relative; width: .27em; height: .86em; margin: 0 .01em; }
.twb-i .stem { position: absolute; left: 50%; bottom: 0; width: .11em; height: .53em; margin-left: -.055em; border-radius: .06em; background: currentColor; transform-origin: 50% 100%; }
.twb-i .head { position: absolute; left: 50%; top: 0; width: .25em; height: .25em; margin-left: -.125em; transform-origin: 50% 100%; }
.twb-i .head .tw-orb { --s: 100%; width: 100%; height: 100%; box-shadow: 0 .02em .05em rgba(0,0,0,.18); }
.twb-i .head .tw-orb:not(.iris):not(.ilo), .twb-i .head .tw-orb { animation-duration: 6s; }
.twb-i .eyes { position: absolute; inset: 0; pointer-events: none; }
.twb-i .eyes::before, .twb-i .eyes::after { content: ""; position: absolute; top: 38%; width: 14%; height: 22%; border-radius: 50%; background: #0b0b0b; animation: twbBlinkSmall 4.2s infinite; }
.twb-i .eyes::before { left: 30%; } .twb-i .eyes::after { right: 30%; }
.twb-i.b .eyes::before, .twb-i.b .eyes::after { animation-delay: -1.7s; }
.twb.logo .twb-i .head { animation: twbPop .7s cubic-bezier(.34,1.56,.64,1) both; animation-delay: calc((var(--k) - 2) * 250ms + .35s); }
.twb-i.talk .head { animation: twbBob .32s ease-in-out infinite alternate !important; }
.twb-stage { position: relative; width: min(760px, calc(100vw - 32px)); aspect-ratio: 760 / 450; }
.twb-stage canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
.twb-face { position: absolute; left: 0; top: 0; width: 0; height: 0; opacity: 0; transition: opacity .25s; pointer-events: none; }
.twb-face.on { opacity: 1; }
.twb-eye { position: absolute; width: var(--ew); height: var(--eh); margin: calc(var(--eh) / -2) 0 0 calc(var(--ew) / -2); border-radius: 50%;
  background: #0b0b0b; transform: translate(var(--lx, 0px), var(--ly, 0px)) scaleY(var(--open, 1)); transition: transform .12s ease-out; }
.twb-eye::before { content: ""; position: absolute; left: 30%; top: 16%; width: 38%; height: 30%; border-radius: 50%; background: #fff; }
.twb-eye::after { content: ""; position: absolute; left: 22%; bottom: 20%; width: 14%; height: 11%; border-radius: 50%; background: #fff; opacity: .9; }
.twb-mouth { position: absolute; width: var(--mw); height: calc(var(--mw) * .5); margin-left: calc(var(--mw) / -2); border: calc(var(--mw) * .14) solid #0b0b0b;
  border-top: 0; border-radius: 0 0 999px 999px; transform: translate(var(--lx, 0px), var(--ly, 0px)); transition: height .08s, border-radius .08s; }
.twb-face.talk .twb-mouth { height: calc(var(--mw) * var(--o, .5)); border-top: calc(var(--mw) * .14) solid #0b0b0b; border-radius: 999px; background: #3a1414; }
.twb-say { min-height: 3.2em; margin: 6px 0 0; text-align: center; font-size: clamp(17px, 2.4vw, 21px); line-height: 1.45; letter-spacing: -0.01em; max-width: 40ch; }
.twb-say span { opacity: 0; transition: opacity .35s, color .35s; }
.twb-say span.on { opacity: 1; }
.twb-say span.ink { color: var(--ink, #161615); }
.twb-say span.dim { color: var(--muted, #8a8a85); }
.twb-go { margin-top: 22px; opacity: 0; transform: translateY(8px); transition: opacity .6s cubic-bezier(.16,1,.3,1), transform .6s cubic-bezier(.16,1,.3,1); }
.twb.done .twb-go { opacity: 1; transform: none; }
.twb button.twb-go { padding: 12px 18px !important; font: 600 15px var(--font, system-ui) !important; border: 1px solid transparent !important; cursor: pointer;
  background: var(--brand-strong, #56669c) !important; color: #fff !important;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.22), 0 10px 22px -12px rgba(56,66,110,.7) !important; }
.twb button.twb-go:hover { background: var(--accent-hover, #44528a) !important; box-shadow: 0 0 0 4px rgba(86,102,156,.18), 0 12px 26px -12px rgba(56,66,110,.75) !important; }
.twb-go kbd { background: rgba(255,255,255,.2) !important; color: #fff; }
.twb.done .twb-skip { opacity: 0; }
.twb-skip { transition: opacity .4s; }
.twb-go kbd { font: 500 12px var(--mono, ui-monospace, monospace); background: rgba(255,255,255,.14); border-radius: 6px; padding: 2px 7px; margin-left: 8px; }
.twb-skip { position: absolute; right: 18px; bottom: 16px; font: 500 11px var(--mono, ui-monospace, monospace); letter-spacing: .04em; text-transform: uppercase; color: var(--muted, #8a8a85); }
.twb button.twb-son { position: absolute; left: 18px; bottom: 12px; padding: 8px 12px !important; font: 500 13px var(--font, system-ui) !important; cursor: pointer; }
.twb-fallback { position: absolute; inset: 0; display: flex; gap: 6%; align-items: center; justify-content: center; }
.twb-fallback .tw-orb { --s: 34%; width: auto; height: auto; aspect-ratio: 1; flex: 0 0 26%; }
@keyframes twbRise { to { opacity: 1; transform: none; } }
@keyframes twbPop { from { transform: scale(0); } }
@keyframes twbBob { from { transform: translateY(0) rotate(-6deg); } to { transform: translateY(-.06em) rotate(6deg); } }
@keyframes twbBlinkSmall { 0%, 92%, 100% { transform: scaleY(1); } 95% { transform: scaleY(.1); } }
@media (prefers-reduced-motion: reduce) {
  .twb-logo > span, .twb.logo .twb-logo > span { opacity: 1; transform: none; animation: none; }
  .twb-i .head, .twb-i.talk .head, .twb-i .eyes::before, .twb-i .eyes::after { animation: none !important; }
  .twb-say span { opacity: 1; transition: none; }
}`;

  const VERT = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }';
  const FRAG = `
precision highp float;
uniform vec2 uRes; uniform float uT, uSplit, uGrow, uSquish, uF;
const float CAM = 4.2;
float smin(float a, float b, float k){ float h = clamp(.5 + .5 * (b - a) / k, 0., 1.); return mix(b, a, h) - k * h * (1. - h); }
float sd(vec3 p){
  float s = clamp(uSplit, 0., 1.15);
  float d = .86 * uSplit;
  float r = mix(.84, .72, clamp(s, 0., 1.)) * uGrow;
  vec3 q = p * vec3(1., 1. + uSquish, 1.);
  float wob = .03 * sin(3. * p.x + uT * 1.7) * sin(2.7 * p.y + uT * 1.3) * sin(2.3 * p.z + uT * 1.1);
  float a = length(q - vec3(-d, 0., 0.)) - r;
  float b = length(q - vec3(d, 0., 0.)) - r;
  float k = mix(.9, .04, smoothstep(0., 1., s));
  return smin(a, b, k) * .85 + wob * uGrow;
}
vec3 nrm(vec3 p){ vec2 e = vec2(.0015, 0.);
  return normalize(vec3(sd(p + e.xyy) - sd(p - e.xyy), sd(p + e.yxy) - sd(p - e.yxy), sd(p + e.yyx) - sd(p - e.yyx))); }
vec3 env(vec3 r){
  float y = r.y + .24 * sin(r.x * 2.3 + uT * .35) + .1 * sin(r.z * 3.1 - uT * .27);
  float up = smoothstep(-.025, .025, y);
  vec3 sky = mix(vec3(.74, .75, .79), vec3(1.), smoothstep(.05, .85, y));
  sky *= .82 + .18 * smoothstep(-.4, .9, r.x + .3 * r.z);
  vec3 flo = mix(vec3(.03, .035, .06), vec3(.48, .5, .58), .5 + .5 * sin(r.x * 2.5 + r.z * 1.5 - uT * .2));
  flo = mix(flo, vec3(.06, .07, .1), smoothstep(-.1, -.7, y));
  vec3 c = mix(flo, sky, up);
  c += .35 * smoothstep(.985, 1., sin(r.x * 1.7 + r.y * 4.5 + uT * .15));
  return c;
}
vec3 shade(vec3 p, vec3 rd){
  vec3 n = nrm(p);
  vec3 R = reflect(rd, n);
  float disp = .07;
  vec3 c = vec3(env(normalize(R + n * disp)).r, env(R).g, env(normalize(R - n * disp)).b);
  float fr = pow(1. - max(dot(n, -rd), 0.), 3.);
  c = mix(c, vec3(1.), fr * .35);
  float side = smoothstep(.02, .35, abs(p.x)) * clamp(uSplit, 0., 1.);
  vec3 tint = p.x < 0. ? vec3(.86, .94, 1.08) : vec3(1.02, .9, 1.08);
  c *= mix(vec3(1.), tint, .55 * side);
  return c;
}
void main(){
  vec2 uv = (gl_FragCoord.xy - .5 * uRes) / uRes.y;
  vec3 ro = vec3(0., 0., CAM), rd = normalize(vec3(uv, -uF));
  float t = 0., md = 1e9, mt = 0.; bool hit = false;
  for (int i = 0; i < 80; i++){
    vec3 p = ro + rd * t; float d = sd(p);
    if (d < md){ md = d; mt = t; }
    if (d < .0008){ hit = true; break; }
    t += d; if (t > 8.) break;
  }
  float px = 1.6 * mt / (uF * uRes.y);
  if (hit){ gl_FragColor = vec4(shade(ro + rd * t, rd), 1.); return; }
  float a = 1. - smoothstep(0., px, md);
  if (a <= 0.){ gl_FragColor = vec4(0.); return; }
  vec3 c = shade(ro + rd * mt, rd);
  gl_FragColor = vec4(c * a, a);
}`;

  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const ease = (x) => 1 - Math.pow(1 - clamp(x), 4);
  const back = (x) => { x = clamp(x); const c = 1.4; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
  const inout = (x) => { x = clamp(x); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };

  function gl(canvas) {
    const g = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false });
    if (!g) return null;
    const sh = (type, src) => { const s = g.createShader(type); g.shaderSource(s, src); g.compileShader(s); return g.getShaderParameter(s, g.COMPILE_STATUS) ? s : null; };
    const vs = sh(g.VERTEX_SHADER, VERT), fs = sh(g.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return null;
    const pr = g.createProgram(); g.attachShader(pr, vs); g.attachShader(pr, fs); g.linkProgram(pr);
    if (!g.getProgramParameter(pr, g.LINK_STATUS)) return null;
    g.useProgram(pr);
    g.bindBuffer(g.ARRAY_BUFFER, g.createBuffer());
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STATIC_DRAW);
    const loc = g.getAttribLocation(pr, 'p'); g.enableVertexAttribArray(loc); g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);
    const u = Object.fromEntries(['uRes', 'uT', 'uSplit', 'uGrow', 'uSquish', 'uF'].map((k) => [k, g.getUniformLocation(pr, k)]));
    return (s) => {
      const w = canvas.width, h = canvas.height;
      g.viewport(0, 0, w, h);
      g.uniform2f(u.uRes, w, h); g.uniform1f(u.uT, s.t); g.uniform1f(u.uSplit, s.split);
      g.uniform1f(u.uGrow, s.grow); g.uniform1f(u.uSquish, s.squish); g.uniform1f(u.uF, F);
      g.drawArrays(g.TRIANGLES, 0, 3);
    };
  }
  const F = 1.55, CAM = 4.2; // focale assez courte pour que la goutte ne touche jamais les bords du cadre, même en rebondissant

  async function show({ onDone } = {}) {
    if (document.querySelector('.twb')) return;
    try { // le texte du moment (démo, client…), généré par recorder/scripts/accueil.mjs
      const c = await (await fetch('/voix/accueil.json', { cache: 'no-store' })).json();
      if (c?.segs?.length === 3) { SEGS = c.segs; BOUTON = c.bouton || BOUTON; placer(); }
    } catch { /* version par défaut */ }
    if (document.querySelector('.twb')) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!document.getElementById('twb-css')) { const st = document.createElement('style'); st.id = 'twb-css'; st.textContent = CSS; document.head.append(st); }

    const el = document.createElement('div');
    el.className = 'twb';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Bienvenue sur Twiin');
    const head = (cls, who, k) => `<span class="twb-i ${cls}" style="--k:${k}" aria-hidden="true"><i class="stem"></i><i class="head"><i class="tw-orb ${who}"></i><i class="eyes"></i></i></span>`;
    const face = `<div class="twb-face"><i class="twb-eye"></i><i class="twb-eye"></i><i class="twb-mouth"></i></div>`;
    el.innerHTML = `<div class="twb-in">
        <div class="twb-logo" role="heading" aria-level="1" aria-label="Twiin"><span style="--k:0" aria-hidden="true">T</span><span style="--k:1" aria-hidden="true">w</span><span style="--k:2" aria-hidden="true">i</span><span style="--k:3" aria-hidden="true">i</span><span style="--k:4" aria-hidden="true">n</span></div>
        <div class="twb-stage" aria-hidden="true"><canvas></canvas>${face}${face}${face}</div>
        <p class="twb-say">${SEGS.filter((sg) => sg.ton).map((sg) => sg.mots.map(([m, at]) => `<span class="${sg.ton}" data-at="${(sg.at + at).toFixed(3)}">${m}</span>`).join(' ')).join('<br>')}</p>
        <button type="button" class="btn primary twb-go">${BOUTON.replace(/[<>&]/g, '')}<kbd>⏎</kbd></button>
      </div>
      <span class="twb-skip" aria-hidden="true">Clic pour passer</span>
      <button type="button" class="twb-son" hidden><svg viewBox="0 0 24 24" aria-hidden="true" style="width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;vertical-align:-3px;margin-right:6px"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/></svg>Écouter Iris et Ilo</button>`;
    document.body.append(el);
    setTimeout(() => { try { sessionStorage.setItem('twiin-intro', '1'); } catch { /* rien */ } }, 600);

    const stage = el.querySelector('.twb-stage'), canvas = stage.querySelector('canvas');
    const faces = [...stage.querySelectorAll('.twb-face')]; // 0 : la goutte unique, 1 : Iris, 2 : Ilo
    const mots = [...el.querySelectorAll('.twb-say span')];
    const petits = [...el.querySelectorAll('.twb-i')];
    const draw = gl(canvas);
    if (!draw) {
      stage.insertAdjacentHTML('afterbegin', '<div class="twb-fallback"><i class="tw-orb iris"></i><i class="tw-orb ilo"></i></div>');
      canvas.remove(); faces.forEach((f) => f.remove());
    }

    let W = 0, H = 0;
    const size = () => {
      const r = stage.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
      W = r.width; H = r.height; canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    };
    size(); addEventListener('resize', size);

    // Le regard suit la souris
    let mx = 0, my = 0;
    const move = (e) => { const r = stage.getBoundingClientRect(); mx = clamp((e.clientX - r.left - r.width / 2) / (r.width / 2), -1, 1); my = clamp((e.clientY - r.top - r.height / 2) / (r.height / 2), -1, 1); };
    addEventListener('pointermove', move);

    // Projection d'un point 3D (même caméra que le shader) vers l'écran
    const proj = (x, y, z) => { const k = F / (CAM - z) * H; return [W / 2 + x * k, H / 2 - y * k, k]; };
    const placeFace = (f, cx, r, open, look, talkO) => {
      const [sx, sy, k] = proj(cx, .1 * r, r * .92);
      const ew = .17 * r * k, eh = .27 * r * k, gap = .27 * r * k;
      f.style.transform = `translate(${sx}px, ${sy}px)`;
      f.style.setProperty('--ew', `${ew}px`); f.style.setProperty('--eh', `${eh}px`); f.style.setProperty('--mw', `${.16 * r * k}px`);
      f.style.setProperty('--lx', `${look[0] * .1 * r * k}px`); f.style.setProperty('--ly', `${look[1] * .07 * r * k}px`);
      const [e1, e2, m] = f.children;
      e1.style.left = `${-gap}px`; e2.style.left = `${gap}px`; e1.style.top = e2.style.top = '0px';
      e1.style.setProperty('--open', open); e2.style.setProperty('--open', open);
      m.style.left = '0px'; m.style.top = `${.24 * r * k}px`;
      f.classList.toggle('talk', talkO != null);
      if (talkO != null) f.style.setProperty('--o', talkO);
    };

    // Chronologie (secondes)
    const T = { grow: [.15, 1.1], face1: 1.2, focus: 2.15, squash: [2.2, 2.6], split: [2.55, 3.75], faces2: 3.6, logo: 4.0, talk: 4.8 };
    // Effets sonores (sons/*.mp3, générés avec ElevenLabs) : [instant, fichier, vitesse de lecture, volume]
    const CUES = [[.15, 'arrivee-2', 1, .5], [2.3, 'split-1', 1, .5], [4.0, 'chui-1', 1, .45]];
    const DERNIER = SEGS[SEGS.length - 1];
    let talkStart = T.talk, talkEnd = T.talk + DERNIER.at + .1;

    // Voix : on tente la lecture ; si le navigateur bloque le son (pas encore de clic sur la page), l'animation continue
    // en silence et un bouton propose de rejouer avec le son.
    const audios = Object.fromEntries(SEGS.flatMap((sg) => sg.clips).map((c) => { const a = new Audio(`/voix/${c}.mp3?v=${SEGS[0].fin}`); a.preload = 'auto'; egaliser(c, a); return [c, a]; }));
    const effets = CUES.map(([, f, rate, vol]) => { const a = new Audio(`/sons/${f}.mp3`); a.preload = 'auto'; a.volume = vol; a.playbackRate = rate; a.preservesPitch = false; return a; });
    const faits = new Set();
    const stopSon = () => [...Object.values(audios), ...effets].forEach((a) => { a.pause(); a.currentTime = 0; });
    const sonBtn = el.querySelector('.twb-son');
    let son = true;
    const joues = new Set();
    const bloque = () => { if (!son) return; son = false; stopSon(); sonBtn.hidden = false; };
    sonBtn.addEventListener('click', (e) => {
      e.stopPropagation(); sonBtn.hidden = true; son = true; joues.clear(); stopSon();
      const t = (performance.now() - t0) / 1000 + skip;
      talkStart = Math.max(t, T.talk) + .15; talkEnd = talkStart + DERNIER.at + .1;
      el.classList.remove('done');
    });
    let t0 = performance.now(), skip = still ? 99 : 0, fini = false, raf = 0, poke = -9;
    const blinkAt = [1.55, 4.1, 6.4, 8.9, 11.6];
    const blink = (t, off) => { const tt = (t + off) % 4.7; let o = 1; for (const b of blinkAt) if (t > b && t < b + .18) o = .1; return tt > 4.52 && t > 5 ? .1 : o; };

    const frame = () => {
      const t = (performance.now() - t0) / 1000 + skip;
      const grow = still ? 1 : back((t - T.grow[0]) / (T.grow[1] - T.grow[0]));
      const sq0 = Math.sin(clamp((t - T.squash[0]) / (T.squash[1] - T.squash[0])) * Math.PI) * .16;
      const sqPoke = Math.max(0, 1 - (t - poke) / .5) * Math.sin((t - poke) * 22) * .1;
      const sp = (t - T.split[0]) / (T.split[1] - T.split[0]);
      const split = sp <= 0 ? 0 : sp >= 1 ? 1 : inout(sp) + Math.sin(clamp(sp) * Math.PI) * .06;
      if (draw) draw({ t, split, grow: Math.max(grow, .001), squish: sq0 + sqPoke });

      if (draw) {
        const look = [mx, -my];
        // Goutte unique : elle ouvre les yeux, puis les ferme pour se concentrer
        const f1 = t > T.face1 && t < T.split[0] + .1;
        faces[0].classList.toggle('on', f1);
        if (f1) placeFace(faces[0], 0, (.84 + .225) * grow, t > T.focus ? .12 : blink(t, 0), look, null);
        // Iris et Ilo : elles se regardent, puis te regardent ; celle qui parle bouge la bouche
        const on2 = t > T.faces2;
        const d = .86 * split, r = .72 + .012;
        const sNow = t - talkStart;
        const actif = SEGS.find((sg) => sNow >= sg.at && sNow < sg.at + sg.fin);
        const qui = actif ? actif.qui : [];
        [1, 2].forEach((i) => {
          faces[i].classList.toggle('on', on2);
          if (!on2) return;
          const each = t < T.faces2 + .9 ? [i === 1 ? .9 : -.9, .1] : look;
          const parle = qui.includes(i - 1);
          const o = parle ? (.35 + .65 * Math.abs(Math.sin(t * 17 + i))) : null;
          placeFace(faces[i], i === 1 ? -d : d, r, t < T.faces2 + .15 ? .1 : blink(t, i * 1.3), each, o);
        });
        petits.forEach((p, i) => p.classList.toggle('talk', qui.includes(i)));
      }
      if (t > T.logo) el.classList.add('logo');
      CUES.forEach(([at], i) => {
        if (faits.has(i) || t < at) return;
        faits.add(i);
        if (son && t < at + .25) { const a = effets[i]; a.currentTime = 0; a.playbackRate = CUES[i][2]; const p = a.play(); if (p) p.catch(bloque); }
      });
      const sc = t - talkStart;
      mots.forEach((m) => m.classList.toggle('on', sc >= +m.dataset.at));
      SEGS.forEach((sg, i) => {
        if (joues.has(i) || sc < sg.at) return;
        joues.add(i);
        if (son && sc < sg.at + .3) sg.clips.forEach((c) => { const a = audios[c]; a.currentTime = 0; const p = a.play(); if (p) p.catch(bloque); });
      });
      if (t > talkEnd && !el.classList.contains('done')) el.classList.add('done');
      if (!fini) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const fermer = () => {
      if (fini) return; fini = true;
      // Les deux sphères partent rejoindre leur place de compagnons (en bas à droite des pages)
      let depuis = null;
      if (draw) {
        const sr = stage.getBoundingClientRect(), r = .732;
        depuis = [-.86, .86].map((x) => { const [sx, sy, k] = proj(x, 0, 0); return { x: sr.left + sx, y: sr.top + sy, r: r * k * 1.02 }; });
        canvas.style.transition = 'opacity .12s'; canvas.style.opacity = '0'; faces.forEach((f) => f.remove());
      }
      dispatchEvent(new CustomEvent('twiin:bienvenue-fin', { detail: depuis }));
      el.classList.add('out');
      removeEventListener('keydown', key); removeEventListener('pointermove', move); removeEventListener('resize', size);
      stopSon();
      setTimeout(() => { cancelAnimationFrame(raf); el.remove(); onDone && onDone(); }, 700);
      // Deuxième écran : on fait connaissance (questionnaire d'audit, raconté par Iris et Ilo)
      const surAccueil = location.pathname === '/' || location.pathname.endsWith('/index.html');
      if (!surAccueil) { location.href = '/?faire-connaissance#audit'; return; }
      if (!['', '#audit'].includes(location.hash)) location.hash = '#audit';
    };
    const key = (e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); fermer(); } };
    addEventListener('keydown', key);
    el.querySelector('.twb-go').addEventListener('click', (e) => { e.stopPropagation(); fermer(); });
    stage.addEventListener('click', (e) => { e.stopPropagation(); poke = (performance.now() - t0) / 1000 + skip; });
    el.addEventListener('click', () => { // un clic ailleurs : on passe directement à la fin de l'animation
      const t = (performance.now() - t0) / 1000 + skip;
      if (t < talkEnd + DERNIER.fin) { stopSon(); SEGS.forEach((_, i) => joues.add(i)); CUES.forEach((_, i) => faits.add(i)); skip += Math.max(0, talkEnd + DERNIER.fin + .1 - t); } else fermer();
    });
  }

  window.TwiinBienvenue = { show };
})();
