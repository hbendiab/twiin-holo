// Copie de recorder/public/jumeaux.js : une page d'extension ne peut pas charger de script distant. Garder les deux identiques.
// Iris et Ilo partout dans Twiin, exactement comme sur la page d'ouverture : même chrome liquide (même shader, mêmes
// reflets irisés, même teinte bleue ou lilas) et même visage (yeux brillants qui suivent la souris, clignements, sourire,
// bouche qui bouge quand ils parlent).
// Un seul contexte WebGL pour toute la page : il dessine les deux sphères à chaque image, puis chaque emplacement
// (logo, compagnons, narrateur…) recopie la sienne dans un petit canvas 2D et y ajoute le visage.
// Tout élément <i class="tw-orb iris|ilo"> est remplacé automatiquement ; il « parle » s'il est dans un .parle ou .talk.
(() => {
  if (window.TwiinJumeaux) return;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const S = 192; // résolution d'une sphère (px)

  const FRAG = `
precision highp float;
uniform vec2 uRes; uniform float uT;
const float CAM = 4.2, R = .9;
float sd(vec3 p, float ph){
  float wob = .03 * sin(3. * p.x + uT * 1.7 + ph) * sin(2.7 * p.y + uT * 1.3) * sin(2.3 * p.z + uT * 1.1 + ph);
  return (length(p) - R) * .85 + wob;
}
vec3 nrm(vec3 p, float ph){ vec2 e = vec2(.0015, 0.);
  return normalize(vec3(sd(p + e.xyy, ph) - sd(p - e.xyy, ph), sd(p + e.yxy, ph) - sd(p - e.yxy, ph), sd(p + e.yyx, ph) - sd(p - e.yyx, ph))); }
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
void main(){
  float demi = uRes.x * .5;
  float qui = gl_FragCoord.x < demi ? 0. : 1.;               // 0 = Iris (gauche), 1 = Ilo (droite)
  vec2 uv = (vec2(mod(gl_FragCoord.x, demi), gl_FragCoord.y) - .5 * vec2(demi, uRes.y)) / (.5 * uRes.y);
  float ph = qui * 2.7;
  float tg = R / sqrt(CAM * CAM - R * R) * 1.07;              // la sphère remplit le cadre, avec une petite marge
  vec3 ro = vec3(0., 0., CAM), rd = normalize(vec3(uv * tg, -1.));
  float t = 0., md = 1e9, mt = 0.; bool hit = false;
  for (int i = 0; i < 64; i++){
    vec3 p = ro + rd * t; float d = sd(p, ph);
    if (d < md){ md = d; mt = t; }
    if (d < .0008){ hit = true; break; }
    t += d; if (t > 8.) break;
  }
  float px = 2.2 * tg / uRes.y * mt;
  float a = hit ? 1. : 1. - smoothstep(0., px, md);
  if (a <= 0.){ gl_FragColor = vec4(0.); return; }
  vec3 p = ro + rd * (hit ? t : mt), n = nrm(p, ph), Rf = reflect(rd, n);
  vec3 c = vec3(env(normalize(Rf + n * .07)).r, env(Rf).g, env(normalize(Rf - n * .07)).b);
  c = mix(c, vec3(1.), pow(1. - max(dot(n, -rd), 0.), 3.) * .35);
  vec3 tint = qui < .5 ? vec3(.86, .94, 1.08) : vec3(1.02, .9, 1.08);
  c *= mix(vec3(1.), tint, .55);
  gl_FragColor = vec4(c * a, a);
}`;

  // ── moteur WebGL partagé ─────────────────────────────────────────────────────────────────────────────────────────
  const glc = document.createElement('canvas');
  glc.width = S * 2; glc.height = S;
  const gl = glc.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: true });
  let uRes = null, uT = null;
  if (gl) {
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; };
    const vs = sh(gl.VERTEX_SHADER, 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }'), fs = sh(gl.FRAGMENT_SHADER, FRAG);
    const pr = vs && fs && gl.createProgram();
    if (pr) {
      gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
      if (gl.getProgramParameter(pr, gl.LINK_STATUS)) {
        gl.useProgram(pr);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        uRes = gl.getUniformLocation(pr, 'uRes'); uT = gl.getUniformLocation(pr, 'uT');
      }
    }
  }
  if (!uRes) { window.TwiinJumeaux = { ok: false }; return; } // sans WebGL : on garde les sphères en CSS

  document.documentElement.classList.add('tw-gl-on');
  const st = document.createElement('style');
  st.textContent = `
.tw-orb.tw-gl { background: none !important; box-shadow: none !important; animation: none !important; overflow: visible !important; }
.tw-orb.tw-gl::after { display: none !important; }
.tw-orb.tw-gl > canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; pointer-events: none; }
/* le visage est dessiné avec la sphère : on retire les anciens yeux en CSS */
.tw-gl-on .twc-eyes, .tw-gl-on .twn-eyes, .tw-gl-on .twb-i .eyes { display: none !important; }`;
  document.head.append(st);

  // ── emplacements ────────────────────────────────────────────────────────────────────────────────────────────────
  const places = new Set();
  function adopter(el) {
    if (el.dataset.twGl) return;
    const qui = el.classList.contains('ilo') ? 1 : el.classList.contains('iris') ? 0 : null;
    if (qui === null) return;
    el.dataset.twGl = '1';
    el.classList.add('tw-gl');
    const cv = document.createElement('canvas');
    el.append(cv);
    places.add({ el, cv, c2: cv.getContext('2d'), qui, cligne: performance.now() + 1500 + Math.random() * 4000, phase: Math.random() * 9 });
  }
  const scanner = (root) => root.querySelectorAll?.('i.tw-orb.iris, i.tw-orb.ilo').forEach(adopter);
  scanner(document);
  new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => {
    if (n.nodeType !== 1) return;
    if (n.matches?.('i.tw-orb')) adopter(n);
    scanner(n);
  }))).observe(document.documentElement, { childList: true, subtree: true });

  let mx = innerWidth / 2, my = innerHeight / 2;
  addEventListener('pointermove', (e) => { mx = e.clientX; my = e.clientY; }, { passive: true });

  // Le visage, aux mêmes proportions que sur la page d'ouverture
  function visage(c, w, h, p, now, parle) {
    const r = (w / 2) / 1.07;                      // rayon de la sphère dans le canvas
    const cx = w / 2, cy = h / 2;
    const rect = p.el.getBoundingClientRect();
    const dx = mx - (rect.left + rect.width / 2), dy = my - (rect.top + rect.height / 2), n = Math.hypot(dx, dy) || 1;
    const enHaut = !!p.el.closest('.twn-scanning'); // pendant le scan, ils regardent les logos au-dessus d'eux
    const lx = still || enHaut ? 0 : (dx / n) * .1 * r, ly = enHaut ? -.3 * r : still ? 0 : (dy / n) * .07 * r;
    if (!still && now > p.cligne + 140) p.cligne = now + 2600 + Math.random() * 4200;
    const ouvert = !still && now > p.cligne && now < p.cligne + 140 ? .1 : 1;
    const ew = .17 * r, eh = .27 * r * ouvert, gap = .27 * r, ey = cy - .1 * r + ly;
    c.fillStyle = '#0b0b0b';
    for (const s of [-1, 1]) {
      const ex = cx + s * gap + lx;
      c.beginPath(); c.ellipse(ex, ey, ew / 2, eh / 2, 0, 0, Math.PI * 2); c.fill();
      if (ouvert > .5 && r > 9) { // reflets dans les yeux (inutiles en tout petit)
        c.fillStyle = '#fff';
        const gy = p.el.closest('.twn-scanning') ? -.32 : -.2; // en regardant en haut, le reflet monte au bord de l'œil
        c.beginPath(); c.ellipse(ex - ew * .04, ey + eh * gy, ew * .19, eh * .15, 0, 0, Math.PI * 2); c.fill();
        c.beginPath(); c.ellipse(ex - ew * .21, ey + eh * .25, ew * .07, eh * .055, 0, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#0b0b0b';
      }
    }
    if (r < 7) return; // pas de bouche en tout petit (logo de la barre latérale)
    const mw = .16 * r, my2 = cy + .14 * r + ly;
    if (parle && !still) {
      const o = .35 + .65 * Math.abs(Math.sin(now / 1000 * 17 + p.qui));
      c.fillStyle = '#3a1414'; c.strokeStyle = '#0b0b0b'; c.lineWidth = Math.max(1, mw * .14);
      c.beginPath(); c.ellipse(cx + lx, my2 + mw * .2, mw / 2, (mw * o) / 2, 0, 0, Math.PI * 2); c.fill(); c.stroke();
    } else {
      c.strokeStyle = '#0b0b0b'; c.lineWidth = Math.max(1, mw * .14); c.lineCap = 'round';
      c.beginPath(); c.arc(cx + lx, my2, mw / 2, .15 * Math.PI, .85 * Math.PI); c.stroke();
    }
  }

  // ── boucle : ~30 images/s, rien quand l'onglet est caché ou qu'aucune sphère n'est visible ──────────────────────────
  let dernier = 0;
  const t0 = performance.now();
  function image(now) {
    requestAnimationFrame(image);
    if (document.hidden || now - dernier < (still ? 1000 : 33)) return;
    dernier = now;
    const visibles = [];
    for (const p of places) {
      if (!p.el.isConnected) { places.delete(p); continue; }
      const r = p.el.getBoundingClientRect();
      if (r.width < 2 || r.bottom < 0 || r.top > innerHeight || getComputedStyle(p.el).visibility === 'hidden') continue;
      visibles.push([p, r]);
    }
    if (!visibles.length) return;
    gl.viewport(0, 0, glc.width, glc.height);
    gl.uniform2f(uRes, glc.width, glc.height);
    gl.uniform1f(uT, still ? 0 : (now - t0) / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const dpr = Math.min(devicePixelRatio || 1, 2);
    for (const [p, r] of visibles) {
      // taille réelle à l'écran (en tenant compte d'un éventuel zoom CSS, ex. le vol depuis la page d'ouverture)
      const w = Math.max(8, Math.round(r.width * dpr)), h = Math.max(8, Math.round(r.height * dpr));
      if (p.cv.width !== w || p.cv.height !== h) { p.cv.width = w; p.cv.height = h; }
      const c = p.c2;
      c.clearRect(0, 0, w, h);
      c.drawImage(glc, p.qui * S, 0, S, S, 0, 0, w, h);
      visage(c, w, h, p, now, !!p.el.closest('.parle, .talk'));
    }
  }
  requestAnimationFrame(image);

  window.TwiinJumeaux = { ok: true };
})();
