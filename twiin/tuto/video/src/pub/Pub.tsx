import { Audio } from "@remotion/media";
import type React from "react";
import { AbsoluteFill, Easing, Img, interpolate, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

// Pub Twiin (vidéo démo du hackathon) : motion design façon lancement de produit.
// Appareils en 3D, gros plans, typographie animée, une seule voix off (public/pub/voix.json), musique ElevenLabs.

const FPS = 30;
const S = (s: number) => Math.round(s * FPS);
const NUIT = "#0b0d18", INK = "#141522", STRONG = "#56669c", LAV = "#c9d2e7";
const FONT = '"SF Pro Display", "Helvetica Neue", Helvetica, Arial, sans-serif';
const MONO = '"SF Mono", ui-monospace, Menlo, monospace';
const out = Easing.bezier(0.16, 1, 0.3, 1);
const inout = Easing.bezier(0.65, 0, 0.35, 1);

type Voix = { f: string; texte: string; s: number };
export type PubProps = { voix: Voix[] };

const k = (f: number, a: number, b: number, from = 0, to = 1, e = out) =>
  interpolate(f, [S(a), S(b)], [from, to], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: e });

// ---------- Fonds ----------
const Nuit: React.FC<{ children?: React.ReactNode; glow?: string }> = ({ children, glow = STRONG }) => {
  const f = useCurrentFrame();
  return <AbsoluteFill style={{ background: NUIT, fontFamily: FONT, color: "#fff", overflow: "hidden" }}>
    <AbsoluteFill style={{ background: `radial-gradient(50% 60% at ${50 + Math.sin(f / 60) * 12}% ${55 + Math.cos(f / 80) * 8}%, ${glow}55 0%, transparent 70%)` }} />
    {children}</AbsoluteFill>;
};
const Jour: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const f = useCurrentFrame();
  return <AbsoluteFill style={{ background: "#f7f8fc", fontFamily: FONT, color: INK, overflow: "hidden" }}>
    <AbsoluteFill style={{ background: `radial-gradient(45% 55% at ${70 + Math.sin(f / 70) * 10}% 30%, ${LAV}cc 0%, transparent 70%), radial-gradient(40% 50% at ${20 + Math.cos(f / 60) * 8}% 85%, ${LAV}99 0%, transparent 70%)` }} />
    {children}</AbsoluteFill>;
};

// ---------- Typographie ----------
// Mot qui monte depuis un masque
const Mot: React.FC<{ t: string; at: number; size?: number; color?: string; weight?: number; dur?: number }> = ({ t, at, size = 160, color, weight = 700, dur = 0.7 }) => {
  const f = useCurrentFrame();
  const a = k(f, at, at + dur);
  return <div style={{ overflow: "hidden", paddingBottom: size * 0.12, lineHeight: 1.02 }}>
    <div style={{ fontSize: size, fontWeight: weight, letterSpacing: "-0.055em", color, translate: `0px ${(1 - a) * size * 1.1}px`, filter: `blur(${(1 - a) * 8}px)` }}>{t}</div></div>;
};
const Centre: React.FC<{ children: React.ReactNode; gap?: number; style?: React.CSSProperties }> = ({ children, gap = 0, style }) =>
  <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap, textAlign: "center", ...style }}>{children}</AbsoluteFill>;
const Etiquette: React.FC<{ t: string; at: number; sombre?: boolean }> = ({ t, at, sombre }) => {
  const f = useCurrentFrame();
  const a = k(f, at, at + 0.5);
  return <div style={{ display: "inline-block", fontFamily: MONO, fontSize: 26, letterSpacing: "0.14em", textTransform: "uppercase", opacity: a, translate: `0px ${(1 - a) * 14}px`,
    color: sombre ? "#aab6dc" : STRONG, padding: "10px 22px", borderRadius: 999, background: sombre ? "rgba(255,255,255,.08)" : `${STRONG}18`, whiteSpace: "nowrap" }}>{t}</div>;
};
// Compteur qui défile
const Compte: React.FC<{ de: number; a: number; at: number; dur?: number; fmt: (n: number) => string; size?: number; color?: string }> = ({ de, a, at, dur = 1.2, fmt, size = 300, color }) => {
  const f = useCurrentFrame();
  const v = interpolate(f, [S(at), S(at + dur)], [de, a], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: out });
  const o = k(f, at - 0.2, at + 0.2);
  return <div style={{ fontSize: size, fontWeight: 700, letterSpacing: "-0.06em", lineHeight: 0.9, color, opacity: o, fontVariantNumeric: "tabular-nums" }}>{fmt(v)}</div>;
};

// ---------- Appareils ----------
const Video: React.FC<{ src: string; debut?: number; rate?: number; style?: React.CSSProperties }> = ({ src, debut = 0, rate = 1, style }) =>
  <OffthreadVideo src={staticFile(src)} startFrom={S(debut)} playbackRate={rate} muted style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top", display: "block", ...style }} />;

// Reflet qui balaie l'écran
const Reflet: React.FC<{ at?: number }> = ({ at = 0.3 }) => {
  const f = useCurrentFrame();
  const x = interpolate(f, [S(at), S(at + 1.4)], [-60, 160], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: inout });
  return <AbsoluteFill style={{ background: `linear-gradient(105deg, transparent ${x - 20}%, rgba(255,255,255,.28) ${x}%, transparent ${x + 18}%)`, pointerEvents: "none" }} />;
};

type Pose = { ry?: number; rx?: number; rz?: number; s?: number; x?: number; y?: number };
const Scene3D: React.FC<{ pose: Pose; children: React.ReactNode; w: number; h: number; cx?: number; cy?: number }> = ({ pose, children, w, h, cx = 960, cy = 540 }) =>
  <div style={{ position: "absolute", left: cx - w / 2 + (pose.x || 0), top: cy - h / 2 + (pose.y || 0), width: w, height: h, perspective: 2400 }}>
    <div style={{ width: "100%", height: "100%", transformStyle: "preserve-3d",
      transform: `rotateY(${pose.ry || 0}deg) rotateX(${pose.rx || 0}deg) rotateZ(${pose.rz || 0}deg) scale(${pose.s ?? 1})` }}>{children}</div></div>;

const Telephone: React.FC<{ src: string; debut?: number; pose: Pose; h?: number; cx?: number; cy?: number; zoom?: { s: number; ox: string; oy: string }; reflet?: number }> =
  ({ src, debut, pose, h = 860, cx, cy, zoom, reflet }) => {
  const w = h * (393 / 659) + 28;
  return <Scene3D pose={pose} w={w} h={h + 28} cx={cx} cy={cy}>
    <div style={{ width: "100%", height: "100%", borderRadius: 74, padding: 14, boxSizing: "border-box", background: "linear-gradient(145deg,#2b2d38,#0c0d12 40%,#22242e)",
      boxShadow: "0 80px 120px -40px rgba(0,0,0,.65), inset 0 0 0 2px rgba(255,255,255,.12)" }}>
      <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: 60, overflow: "hidden", background: "#fff" }}>
        <div style={{ width: "100%", height: "100%", scale: `${zoom?.s ?? 1}`, transformOrigin: `${zoom?.ox ?? "50%"} ${zoom?.oy ?? "50%"}` }}>
          <Video src={src} debut={debut} /></div>
        <div style={{ position: "absolute", top: 14, left: "50%", translate: "-50% 0px", width: 120, height: 34, borderRadius: 20, background: "#000" }} />
        {reflet !== undefined && <Reflet at={reflet} />}
      </div></div></Scene3D>;
};

const Portable: React.FC<{ src: string; debut?: number; pose: Pose; w?: number; cx?: number; cy?: number; zoom?: { s: number; ox: string; oy: string }; ratio?: number; reflet?: number; image?: boolean }> =
  ({ src, debut, pose, w = 1300, cx, cy, zoom, ratio = 1040 / 1600, reflet, image }) => {
  const h = w * ratio;
  return <Scene3D pose={pose} w={w} h={h + 60} cx={cx} cy={cy}>
    <div style={{ width: "100%", height: h, borderRadius: "26px 26px 0 0", padding: "18px 18px 22px", boxSizing: "border-box", background: "linear-gradient(180deg,#1e2029,#0e0f14)",
      boxShadow: "0 80px 140px -60px rgba(10,12,30,.7), inset 0 0 0 2px rgba(255,255,255,.08)" }}>
      <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", borderRadius: 6, background: "#fff" }}>
        <div style={{ width: "100%", height: "100%", scale: `${zoom?.s ?? 1}`, transformOrigin: `${zoom?.ox ?? "50%"} ${zoom?.oy ?? "50%"}` }}>
          {image ? <Img src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} /> : <Video src={src} debut={debut} />}</div>
        {reflet !== undefined && <Reflet at={reflet} />}
      </div></div>
    <div style={{ width: "112%", marginLeft: "-6%", height: 34, borderRadius: "0 0 30px 30px", background: "linear-gradient(180deg,#d9dce6,#a9adbb)", boxShadow: "0 30px 40px -20px rgba(0,0,0,.5)" }} />
  </Scene3D>;
};

// Fenêtre de navigateur ou d'app, flottante
const Fenetre: React.FC<{ src: string; debut?: number; pose: Pose; w: number; ratio: number; cx?: number; cy?: number; barre?: boolean; zoom?: { s: number; ox: string; oy: string } }> =
  ({ src, debut, pose, w, ratio, cx, cy, barre = true, zoom }) =>
  <Scene3D pose={pose} w={w} h={w * ratio + (barre ? 44 : 0)} cx={cx} cy={cy}>
    <div style={{ width: "100%", height: "100%", borderRadius: 22, overflow: "hidden", background: "#fff", boxShadow: "0 60px 110px -40px rgba(20,24,50,.55), 0 0 0 1px rgba(20,24,50,.08)" }}>
      {barre && <div style={{ height: 44, background: "#eceef4", display: "flex", alignItems: "center", gap: 9, paddingLeft: 18 }}>
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => <div key={c} style={{ width: 14, height: 14, borderRadius: 7, background: c }} />)}</div>}
      <div style={{ width: "100%", height: barre ? `calc(100% - 44px)` : "100%", overflow: "hidden" }}>
        <div style={{ width: "100%", height: "100%", scale: `${zoom?.s ?? 1}`, transformOrigin: `${zoom?.ox ?? "50%"} ${zoom?.oy ?? "50%"}` }}><Video src={src} debut={debut} /></div></div>
    </div></Scene3D>;

// Transition : flash de lumière entre deux plans
const Flash: React.FC<{ at: number }> = ({ at }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [S(at) - 4, S(at), S(at) + 8], [0, 0.85, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ background: "#fff", opacity: o, pointerEvents: "none" }} />;
};

// ---------- Plans ----------
// Chaque plan : [début, fin] en secondes, rendu en temps local
type Plan = { a: number; b: number; r: React.FC };

const P1: React.FC = () => { // « Chaque semaine… 3 h »
  const f = useCurrentFrame();
  return <Nuit glow="#3a4270">
    <Centre gap={10}>
      <div style={{ opacity: k(f, 3.4, 4, 1, 0) }}>
        <Mot t="Chaque semaine," at={0.4} size={110} weight={600} color="#c9d2e7" />
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 30 }}>
          <Compte de={0} a={3} at={1.4} dur={1.4} fmt={(n) => `${Math.round(n)} h`} size={340} />
          <Mot t="perdues." at={2.2} size={110} weight={600} color="#c9d2e7" /></div></div>
    </Centre>
    <Centre>{["Copier.", "Coller.", "Cliquer.", "Recommencer."].map((m, i) => {
      const a = 4.4 + i * 0.95;
      const o = interpolate(f, [S(a), S(a) + 3, S(a + 0.85), S(a + 0.95)], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
      const sc = interpolate(f, [S(a), S(a + 0.95)], [1.25, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
      return <div key={m} style={{ position: "absolute", fontSize: 230, fontWeight: 700, letterSpacing: "-0.06em", opacity: o, scale: `${sc}` }}>{m}</div>;
    })}</Centre>
    <div style={{ position: "absolute", bottom: 90, width: "100%", textAlign: "center", opacity: k(f, 6, 6.6) * k(f, 8.4, 8.8, 1, 0) }}>
      <Etiquette t="Des logiciels sans API" at={6} sombre /></div>
  </Nuit>;
};

const P2: React.FC = () => { // « Montrez-le. Une fois. » → Voici Twiin
  const f = useCurrentFrame();
  const sortie = k(f, 2.9, 3.3, 1, 0);
  const logo = spring({ frame: f - S(3.35), fps: FPS, config: { damping: 13, mass: 0.9 } });
  return <Jour>
    <Centre style={{ opacity: sortie }}>
      <Mot t="Montrez-le." at={0.2} size={170} />
      <Mot t="Une seule fois." at={1.1} size={170} color={STRONG} /></Centre>
    <Centre style={{ opacity: f > S(3.3) ? 1 : 0 }}>
      <div style={{ fontSize: 330, fontWeight: 700, letterSpacing: "-0.07em", scale: `${0.6 + logo * 0.4}`, opacity: logo,
        backgroundImage: `linear-gradient(120deg, ${INK} 30%, ${STRONG} 50%, ${INK} 70%)`, backgroundSize: "300% 100%",
        backgroundPosition: `${interpolate(f, [S(3.4), S(5.2)], [100, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}% 0`,
        WebkitBackgroundClip: "text", color: "transparent" }}>Twiin</div>
    </Centre>
  </Jour>;
};

const P3: React.FC = () => { // Téléphone : on demande
  const f = useCurrentFrame();
  const ry = interpolate(f, [0, S(2.2)], [-38, -8], { extrapolateRight: "clamp", easing: out });
  const z = k(f, 3.2, 5.2, 1, 1.9, inout);
  return <Nuit>
    <Telephone src="demo/clips/tel_facture.mp4" debut={0.5} h={880} cx={1180} pose={{ ry: ry + Math.sin(f / 40) * 3, rx: 4, s: 0.9 + k(f, 0, 1.5) * 0.1 }}
      zoom={{ s: z, ox: "60%", oy: "88%" }} reflet={0.6} />
    <div style={{ position: "absolute", left: 140, top: 380, width: 720 }}>
      <Etiquette t="Depuis le téléphone" at={0.4} sombre />
      <div style={{ height: 26 }} />
      <Mot t="Vous" at={0.7} size={150} /><Mot t="demandez." at={1.0} size={150} color="#aab6dc" /></div>
  </Nuit>;
};

const P4: React.FC = () => { // Le Mac : Holo prend la main
  const f = useCurrentFrame();
  const ry = interpolate(f, [0, S(2)], [24, 8], { extrapolateRight: "clamp", easing: out });
  const z = k(f, 3.4, 5.6, 1, 2.1, inout) * (1 - k(f, 7.6, 8.6, 0, 1, inout)) + k(f, 7.6, 8.6, 0, 1, inout);
  return <Jour>
    <Portable src="demo/clips/mac_facture.mp4" debut={1} w={1200} cx={1260} cy={580} pose={{ ry, rx: 6, s: 0.95 }} zoom={{ s: z, ox: "40%", oy: "58%" }} reflet={0.4} />
    <div style={{ position: "absolute", left: 120, top: 70, display: "flex", gap: 18, alignItems: "center" }}>
      <Etiquette t="Holo · H Company" at={0.6} /><Etiquette t="voit · clique · tape" at={1.4} /></div>
    <div style={{ position: "absolute", left: 110, top: 330, width: 560, opacity: k(f, 1.6, 2.2) }}>
      <Mot t="Il voit l'écran." at={1.6} size={76} /><Mot t="Il clique." at={2.6} size={84} color={STRONG} /><Mot t="Comme vous." at={3.6} size={84} /></div>
  </Jour>;
};

const P5: React.FC = () => { // 47 s, la facture dans la poche
  const f = useCurrentFrame();
  return <Nuit>
    <Telephone src="demo/clips/tel_facture.mp4" debut={26} h={860} cx={1300} pose={{ ry: -14 + Math.sin(f / 40) * 3, rx: 3, s: 0.95 }} zoom={{ s: 1.25, ox: "50%", oy: "78%" }} reflet={0.8} />
    <div style={{ position: "absolute", left: 150, top: 300 }}>
      <Compte de={0} a={47} at={0.2} dur={1.6} fmt={(n) => `${Math.round(n)} s`} size={330} />
      <div style={{ height: 20 }} />
      <Mot t="La facture, dans votre poche." at={1.4} size={64} weight={600} color="#c9d2e7" /></div>
  </Nuit>;
};

const P6: React.FC = () => { // « Automatise. »
  const f = useCurrentFrame();
  return <Jour>
    <Telephone src="demo/clips/tel_automatise.mp4" debut={2} h={860} cx={600} pose={{ ry: 16 - k(f, 0, 2) * 8, rx: 3 }} zoom={{ s: 1.5, ox: "70%", oy: "45%" }} reflet={0.5} />
    <div style={{ position: "absolute", left: 1000, top: 360 }}>
      <Etiquette t="Un seul message" at={0.3} /><div style={{ height: 20 }} />
      <div style={{ whiteSpace: "nowrap" }}><Mot t="« Automatise. »" at={0.6} size={130} /></div></div>
  </Jour>;
};

const P7: React.FC = () => { // Apprend · Rejoue · Vérifie, puis bloque une valeur douteuse
  const f = useCurrentFrame();
  const mots = [["Il apprend.", 0.2], ["Il rejoue.", 1.4], ["Il vérifie.", 2.6]] as const;
  const bloc = k(f, 4.6, 5.2);
  return <Nuit glow="#4a5590">
    <Fenetre src="demo/clips/n8n.mp4" debut={2} w={1240} ratio={898 / 1600} cx={1180} cy={470} pose={{ ry: -22 + f * 0.06, rx: 8, s: 0.92 }} zoom={{ s: 1.6, ox: "55%", oy: "50%" }} />
    <div style={{ position: "absolute", left: 120, top: 260, opacity: 1 - bloc }}>
      {mots.map(([t, a]) => <Mot key={t} t={t} at={a} size={120} color={a === 2.6 ? "#aab6dc" : "#fff"} />)}</div>
    <div style={{ position: "absolute", left: 120, top: 300, opacity: bloc, translate: `0px ${(1 - bloc) * 30}px` }}>
      <div style={{ fontFamily: MONO, fontSize: 120, color: "#ff8a8a", textDecoration: "line-through", textDecorationThickness: 8 }}>1.0992</div>
      <div style={{ marginTop: 24, display: "inline-block", fontSize: 64, fontWeight: 700, padding: "18px 36px", borderRadius: 999, background: "#fff", color: NUIT,
        scale: `${spring({ frame: f - S(5.6), fps: FPS, config: { damping: 10 } })}` }}>Bloqué. Pas écrit.</div>
    </div>
  </Nuit>;
};

const P8: React.FC = () => { // Pour toujours
  const f = useCurrentFrame();
  return <Jour>
    <Centre>
      <Mot t="Puis il le fait." at={0.1} size={150} />
      <Mot t="Pour toujours." at={0.9} size={190} color={STRONG} /></Centre>
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 120, height: 6, background: `${STRONG}22` }}>
      <div style={{ width: `${k(f, 0.5, 2.4, 0, 100, inout)}%`, height: "100%", background: STRONG }} /></div>
  </Jour>;
};

const P9: React.FC = () => { // Cloud H Company
  const f = useCurrentFrame();
  return <Nuit glow="#3d5a9a">
    <Telephone src="demo/clips/tel_cloud.mp4" debut={8} h={860} cx={560} pose={{ ry: 20 - f * 0.08, rx: 4 }} zoom={{ s: 1.2, ox: "50%", oy: "20%" }} reflet={0.4} />
    <div style={{ position: "absolute", left: 1000, top: 210 }}>
      <Etiquette t="Cloud H Company" at={0.3} sombre /><div style={{ height: 30 }} />
      <Compte de={0} a={28} at={0.8} dur={1.3} fmt={(n) => `${Math.round(n)} s`} size={260} />
      <div style={{ height: 20 }} />
      <Compte de={0} a={0.01} at={2.2} dur={1.1} fmt={(n) => `${n.toFixed(2).replace(".", ",")} $`} size={200} color="#aab6dc" /></div>
  </Nuit>;
};

const P10: React.FC = () => { // Partout : Mac, Chrome, téléphone
  const f = useCurrentFrame();
  const t1 = k(f, 0, 0.8), t2 = k(f, 1.2, 2), t3 = k(f, 2.4, 3.2), tous = k(f, 4.2, 5.4, 0, 1, inout);
  return <Jour>
    <Portable src="film/autos.mp4" w={1100} ratio={1000 / 1600} cx={760 - tous * 120} cy={480} pose={{ ry: 18 - tous * 6, rx: 6, s: (0.7 + t1 * 0.3) * (1 - tous * 0.28), y: (1 - t1) * 300 }} />
    <Fenetre src="film/ext_page.mp4" debut={1} w={900} ratio={900 / 1440} cx={1380 - tous * 60} cy={560 - tous * 60}
      pose={{ ry: -16, rx: 4, s: t2 * (1 - tous * 0.22), x: (1 - t2) * 400 }} zoom={{ s: 1.15, ox: "100%", oy: "100%" }} />
    <Fenetre src="film/app.mp4" w={330} ratio={720 / 400} cx={300} cy={600} barre={false} pose={{ ry: 20, rz: -3, s: t3 * 0.9, y: (1 - t3) * 300 }} />
    <Telephone src="demo/clips/tel_facture.mp4" debut={27} h={560} cx={1640} cy={640} pose={{ ry: -24, rz: 4, s: tous, y: (1 - tous) * 400 }} />
    <div style={{ position: "absolute", left: 0, right: 0, top: 60, display: "flex", justifyContent: "center", gap: 60 }}>
      {[["Mac.", 0.2], ["Chrome.", 1.4], ["Téléphone.", 2.6]].map(([t, a]) => <Mot key={t as string} t={t as string} at={a as number} size={96} />)}</div>
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 70, textAlign: "center", opacity: k(f, 4.6, 5.2) }}>
      <div style={{ fontSize: 80, fontWeight: 700, letterSpacing: "-0.05em", color: STRONG }}>Partout où vous travaillez.</div></div>
  </Jour>;
};

const P11: React.FC = () => { // Aux couleurs de l'entreprise
  const f = useCurrentFrame();
  const couleurs = ["#00915a", "#e5186a", "#0078d4", "#151515", "#56669c"];
  return <Nuit>
    <Portable src="film/marque.mp4" debut={1.2} w={1150} ratio={1000 / 1600} cx={1120} cy={480} pose={{ ry: -14 + f * 0.05, rx: 6 }} zoom={{ s: 1.35, ox: "40%", oy: "20%" }} reflet={0.5} />
    <div style={{ position: "absolute", left: 120, top: 200, display: "flex", flexDirection: "column", gap: 22 }}>
      {couleurs.map((c, i) => { const a = spring({ frame: f - S(0.2 + i * 0.25), fps: FPS, config: { damping: 11 } });
        return <div key={c} style={{ width: 96, height: 96, borderRadius: 48, background: c, scale: `${a}`, boxShadow: `0 20px 40px -10px ${c}aa` }} />; })}</div>
    <div style={{ position: "absolute", left: 120, bottom: 60 }}><Mot t="Aux couleurs de votre entreprise." at={0.3} size={72} weight={600} /></div>
  </Nuit>;
};

const P12: React.FC = () => { // Une formation
  const f = useCurrentFrame();
  return <Jour>
    <Fenetre src="demo/clips/videos.mp4" debut={2} w={1150} ratio={1040 / 1600} cx={1240} cy={560} pose={{ ry: -18 + f * 0.05, rx: 6, s: 0.92 }} zoom={{ s: 1.25, ox: "60%", oy: "30%" }} />
    <div style={{ position: "absolute", left: 110, top: 160 }}>
      <Etiquette t="Vidéo de formation" at={0.2} /><div style={{ height: 20 }} />
      <Mot t="Chaque tâche" at={0.4} size={92} /><Mot t="devient une" at={0.8} size={92} /><Mot t="formation." at={1.2} size={92} color={STRONG} /></div>
  </Jour>;
};

const P13: React.FC = () => { // Pour qui
  const f = useCurrentFrame();
  return <Nuit>
    <Centre gap={10}>
      <div style={{ opacity: k(f, 1.6, 1.9, 1, 0.35) }}><Mot t="Pour les dirigeants pressés." at={0.1} size={110} /></div>
      <Mot t="Pour les équipes sans DSI." at={1.7} size={110} color="#aab6dc" /></Centre>
  </Nuit>;
};

const P14: React.FC = () => { // Holo voit. Twiin apprend. Votre entreprise avance.
  const f = useCurrentFrame();
  const chiffres = [["47 s", "facture sur le téléphone"], ["1er essai", "workflow n8n réussi"], ["28 s", "dans le cloud H Company"], ["0,01 $", "par exécution web"]];
  return <Jour>
    <Centre gap={0} style={{ justifyContent: "flex-start", paddingTop: 170 }}>
      <Mot t="Holo voit." at={0.1} size={130} />
      <Mot t="Twiin apprend." at={0.8} size={130} color={STRONG} />
      <Mot t="Votre entreprise avance." at={1.5} size={130} /></Centre>
    <div style={{ position: "absolute", left: 120, right: 120, bottom: 110, display: "flex", gap: 24 }}>
      {chiffres.map(([n, l], i) => { const a = k(f, 2.2 + i * 0.18, 2.8 + i * 0.18);
        return <div key={n} style={{ flex: 1, opacity: a, translate: `0px ${(1 - a) * 40}px`, padding: "24px 28px", borderRadius: 28, background: "rgba(255,255,255,.75)", border: `2px solid ${LAV}` }}>
          <div style={{ fontSize: 64, fontWeight: 700, letterSpacing: "-0.05em", color: STRONG }}>{n}</div>
          <div style={{ fontSize: 26, color: "#5d6280", marginTop: 6 }}>{l}</div></div>; })}</div>
  </Jour>;
};

const P15: React.FC = () => { // Final : l'ouverture du SaaS, une bulle qui se sépare en deux
  const f = useCurrentFrame();
  const dureeClip = 4.2;
  const tag = k(f, 4.6, 5.4), pw = k(f, 6.6, 7.4);
  return <AbsoluteFill style={{ background: "#fff", fontFamily: FONT, color: INK }}>
    <Sequence durationInFrames={S(dureeClip)}><OffthreadVideo src={staticFile("pub/bienvenue.mp4")} muted style={{ width: "100%", height: "100%" }} /></Sequence>
    <Sequence from={S(dureeClip)}><Img src={staticFile("pub/bienvenue-fin.png")} style={{ width: "100%", height: "100%", scale: `${1 + (f - S(dureeClip)) * 0.0004}` }} /></Sequence>
    <div style={{ position: "absolute", left: 0, right: 0, top: 700, textAlign: "center", opacity: tag, translate: `0px ${(1 - tag) * 24}px` }}>
      <div style={{ fontSize: 72, fontWeight: 650, letterSpacing: "-0.04em" }}>Montrez une fois. Twiin le fait pour toujours.</div></div>
    <div style={{ position: "absolute", left: 0, right: 0, top: 830, textAlign: "center", opacity: pw }}>
      <div style={{ fontFamily: MONO, fontSize: 28, letterSpacing: "0.12em", color: STRONG }}>POWERED BY H COMPANY… AND NOT A LOT OF SLEEP</div></div>
  </AbsoluteFill>;
};

// Calage : début et fin de chaque plan (secondes), et où tombent les répliques de la voix off
const PLANS: Plan[] = [
  { a: 0, b: 9.2, r: P1 }, { a: 9.2, b: 15, r: P2 }, { a: 15, b: 21.5, r: P3 }, { a: 21.5, b: 31, r: P4 },
  { a: 31, b: 36, r: P5 }, { a: 36, b: 41, r: P6 }, { a: 41, b: 50.5, r: P7 }, { a: 50.5, b: 54.5, r: P8 },
  { a: 54.5, b: 61, r: P9 }, { a: 61, b: 69, r: P10 }, { a: 69, b: 74, r: P11 }, { a: 74, b: 79.5, r: P12 },
  { a: 79.5, b: 84.5, r: P13 }, { a: 84.5, b: 91, r: P14 }, { a: 91, b: 102, r: P15 },
];
const REPLIQUES = [0.5, 4.6, 9.5, 12.6, 15.4, 21.9, 31.3, 36.4, 41.3, 45.8, 50.8, 54.9, 61.3, 69.4, 74.4, 79.8, 84.8, 95.8];
const COUPES = [9.2, 15, 21.5, 31, 36, 41, 50.5, 54.5, 61, 69, 74, 79.5, 84.5, 91];
export const DUREE_PUB = S(102);

export const TwiinPub: React.FC<PubProps> = ({ voix }) => {
  const f = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const musique = interpolate(f, [0, S(1.5), durationInFrames - S(4), durationInFrames - 2], [0, 0.55, 0.55, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: NUIT }}>
      {PLANS.map((p, i) => (
        <Sequence key={i} from={S(p.a)} durationInFrames={S(p.b - p.a)} name={`plan-${i + 1}`}><p.r /></Sequence>
      ))}
      {COUPES.map((c) => <Flash key={c} at={c} />)}
      <Audio src={staticFile("pub/musique.mp3")} volume={musique} />
      {COUPES.map((c, i) => <Sequence key={`w${c}`} from={Math.max(0, S(c) - 8)} durationInFrames={S(1)}><Audio src={staticFile(i % 3 === 2 ? "pub/hit.mp3" : "pub/whoosh.mp3")} volume={0.35} /></Sequence>)}
      <Sequence from={S(11.4)} durationInFrames={S(2)}><Audio src={staticFile("pub/riser.mp3")} volume={0.4} /></Sequence>
      <Sequence from={S(12.5)} durationInFrames={S(1.3)}><Audio src={staticFile("pub/hit.mp3")} volume={0.6} /></Sequence>
      {voix.map((v, i) => REPLIQUES[i] !== undefined &&
        <Sequence key={v.f} from={S(REPLIQUES[i])} durationInFrames={S(v.s + 0.3)}><Audio src={staticFile(v.f)} volume={1} /></Sequence>)}
    </AbsoluteFill>
  );
};
