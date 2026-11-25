import { Audio } from "@remotion/media";
import type React from "react";
import { AbsoluteFill, Easing, Img, interpolate, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

// Pub Twiin v2 : DA du SaaS (clair, lavande, verre), une tagline unique, texte à l'écran = texte de la voix off.
// Voix : public/pub/v2/voix.json ; musique : public/pub/musique-*.mp3.

const FPS = 30;
const S = (s: number) => Math.round(s * FPS);
const INK = "#f4f5fa", DIM = "#a3a8bd", STRONG = "#aab6dc", FILL = "#56669c", LAV = "#56669c", RULE = "rgba(255,255,255,.14)";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const MONO = '"Geist Mono", ui-monospace, "SF Mono", Menlo, monospace';
const out = Easing.bezier(0.16, 1, 0.3, 1);
const TAGLINE = "Montrez une fois. Twiin le fait partout.";

type Ligne = { f: string; texte: string; s: number };
export type Pub2Props = { voix: Ligne[]; final: { f: string; s: number }; musique: string };
type L = { a: number; s: number; texte: string }; // réplique en temps local du plan
type Rendu = React.FC<{ l: L[] }>;

const k = (f: number, a: number, b: number, from = 0, to = 1, e = out) =>
  interpolate(f, [S(a), S(b)], [from, to], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: e });

// ---------- Fond : la DA du SaaS ----------
const Fond: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const f = useCurrentFrame();
  return <AbsoluteFill style={{ background: "#050507", fontFamily: FONT, color: INK, overflow: "hidden" }}>
    <AbsoluteFill style={{ background: `radial-gradient(48% 60% at ${78 + Math.sin(f / 80) * 8}% ${18 + Math.cos(f / 90) * 6}%, ${LAV}cc 0%, transparent 70%), radial-gradient(42% 55% at ${12 + Math.cos(f / 70) * 6}% 92%, ${LAV}aa 0%, transparent 70%)` }} />
    <AbsoluteFill style={{ backgroundImage: `radial-gradient(circle, #ffffff12 1.6px, transparent 2px)`, backgroundSize: "36px 36px" }} />
    {children}</AbsoluteFill>;
};

// ---------- Le logo Twiin : les deux jumeaux + le mot ----------
const Logo: React.FC<{ size?: number; at?: number }> = ({ size = 220, at = 0 }) => {
  const f = useCurrentFrame();
  const a = spring({ frame: f - S(at), fps: FPS, config: { damping: 14, mass: 0.9 } });
  const o = size * 0.62;
  return <div style={{ display: "flex", alignItems: "center", gap: size * 0.16, opacity: a, scale: `${0.85 + a * 0.15}` }}>
    <div style={{ display: "flex" }}>
      <Img src={staticFile("twiin/iris.png")} style={{ width: o, height: o, translate: `${(1 - a) * o * 0.5}px 0px` }} />
      <Img src={staticFile("twiin/ilo.png")} style={{ width: o, height: o, marginLeft: -o * 0.12, translate: `${-(1 - a) * o * 0.5}px 0px` }} /></div>
    <div style={{ fontSize: size, fontWeight: 600, letterSpacing: "-0.045em", lineHeight: 1 }}>Twiin</div></div>;
};

// ---------- Texte synchronisé avec la voix ----------
// Découpe une réplique en morceaux (phrases) et fait apparaître chacun quand la voix le prononce.
const morceaux = (t: string) => t.split(/(?<=[.?!:])\s+/).filter(Boolean);
const Phrase: React.FC<{ l: L; size?: number; w?: number; accent?: number[]; seul?: boolean; centre?: boolean; couleur?: string }> =
  ({ l, size = 72, w = 700, accent = [], seul, centre, couleur }) => {
  const f = useCurrentFrame();
  const m = morceaux(l.texte);
  let c = 0;
  const debuts = m.map((x) => { const d = l.a + (c / l.texte.length) * l.s * 0.95; c += x.length + 1; return d; });
  return <div style={{ width: w, display: "flex", flexDirection: "column", gap: size * 0.12, alignItems: centre ? "center" : "flex-start", textAlign: centre ? "center" : "left" }}>
    {m.map((x, i) => {
      const a = k(f, debuts[i] - 0.05, debuts[i] + 0.45);
      const fin = seul && i < m.length - 1 ? k(f, debuts[i + 1] - 0.1, debuts[i + 1] + 0.1, 1, 0) : 1;
      if (seul && (f < S(debuts[i] - 0.05) || fin <= 0)) return null;
      return <div key={i} style={{ overflow: "hidden", paddingBottom: size * 0.1, position: seul ? "absolute" : "relative", width: seul ? w : undefined }}>
        <div style={{ fontSize: size, fontWeight: 600, letterSpacing: "-0.045em", lineHeight: 1.06, opacity: fin,
          color: couleur || (accent.includes(i) ? STRONG : INK), translate: `0px ${(1 - a) * size * 1.1}px` }}>{x}</div></div>;
    })}</div>;
};
const Etape: React.FC<{ n: string; t: string }> = ({ n, t }) => {
  const f = useCurrentFrame(); const a = k(f, 0.1, 0.6);
  return <div style={{ position: "absolute", left: 110, top: 64, display: "flex", alignItems: "center", gap: 14, opacity: a, translate: `${(1 - a) * -20}px 0px` }}>
    <div style={{ fontFamily: MONO, fontSize: 24, letterSpacing: "0.12em", color: STRONG, padding: "10px 20px", borderRadius: 999, background: "rgba(255,255,255,.08)", border: `1.5px solid ${RULE}` }}>{n}</div>
    <div style={{ fontFamily: MONO, fontSize: 24, letterSpacing: "0.12em", color: DIM, textTransform: "uppercase" }}>{t}</div></div>;
};

// ---------- Appareils (captures en entier, jamais recadrées) ----------
const Clip: React.FC<{ src: string; debut?: number; image?: boolean }> = ({ src, debut = 0, image }) => image
  ? <Img src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top", display: "block" }} />
  : <OffthreadVideo src={staticFile(src)} startFrom={S(debut)} muted style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", background: "#fff" }} />;

type Pose = { ry?: number; rx?: number; s?: number; x?: number; y?: number };
const Pivot: React.FC<{ pose: Pose; w: number; h: number; cx: number; cy: number; children: React.ReactNode }> = ({ pose, w, h, cx, cy, children }) =>
  <div style={{ position: "absolute", left: cx - w / 2 + (pose.x || 0), top: cy - h / 2 + (pose.y || 0), width: w, height: h, perspective: 2600 }}>
    <div style={{ width: "100%", height: "100%", transform: `rotateY(${pose.ry || 0}deg) rotateX(${pose.rx || 0}deg) scale(${pose.s ?? 1})` }}>{children}</div></div>;

// Entrée commune : l'appareil arrive en tournant, puis flotte doucement
const useEntree = (dir = 1) => {
  const f = useCurrentFrame();
  const a = k(f, 0, 1.1);
  return { ry: dir * (22 * (1 - a) + 6) + Math.sin(f / 50) * 1.5, rx: 4 - Math.cos(f / 60) * 1, s: 0.92 + a * 0.08, y: (1 - a) * 80 };
};

const Telephone: React.FC<{ src: string; debut?: number; h?: number; cx: number; cy?: number; pose: Pose }> = ({ src, debut, h = 900, cx, cy = 560, pose }) => {
  const w = h * (600 / 1008);
  return <Pivot pose={pose} w={w + 28} h={h + 28} cx={cx} cy={cy}>
    <div style={{ width: "100%", height: "100%", borderRadius: 70, padding: 14, boxSizing: "border-box", background: "linear-gradient(145deg,#3a3c47,#16171d 45%,#2c2e38)",
      boxShadow: "0 70px 110px -50px rgba(40,46,90,.6), inset 0 0 0 2px rgba(255,255,255,.14)" }}>
      <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: 56, overflow: "hidden", background: "#fff" }}>
        <Clip src={src} debut={debut} />
        <div style={{ position: "absolute", top: 12, left: "50%", translate: "-50% 0px", width: 112, height: 32, borderRadius: 18, background: "#000" }} /></div></div></Pivot>;
};
const Portable: React.FC<{ src: string; debut?: number; w?: number; ratio: number; cx: number; cy?: number; pose: Pose; image?: boolean }> = ({ src, debut, w = 1250, ratio, cx, cy = 560, pose, image }) => {
  const h = w * ratio + 40;
  return <Pivot pose={pose} w={w + 40} h={h + 36} cx={cx} cy={cy}>
    <div style={{ width: "100%", height: h, borderRadius: "24px 24px 0 0", padding: "20px 20px 20px", boxSizing: "border-box", background: "#1c1d24", boxShadow: "0 70px 120px -60px rgba(40,46,90,.65)" }}>
      <div style={{ width: "100%", height: "100%", overflow: "hidden", borderRadius: 4, background: "#fff" }}><Clip src={src} debut={debut} image={image} /></div></div>
    <div style={{ width: "110%", marginLeft: "-5%", height: 30, borderRadius: "0 0 28px 28px", background: "linear-gradient(180deg,#e4e6ee,#b4b8c6)" }} /></Pivot>;
};
const Fenetre: React.FC<{ src: string; debut?: number; w: number; ratio: number; cx: number; cy?: number; pose: Pose; barre?: boolean; image?: boolean }> = ({ src, debut, w, ratio, cx, cy = 560, pose, barre = true, image }) =>
  <Pivot pose={pose} w={w} h={w * ratio + (barre ? 40 : 0)} cx={cx} cy={cy}>
    <div style={{ width: "100%", height: "100%", borderRadius: 18, overflow: "hidden", background: "#fff", boxShadow: "0 60px 110px -45px rgba(40,46,90,.5), 0 0 0 1px rgba(40,46,90,.1)" }}>
      {barre && <div style={{ height: 40, background: "#eef0f6", display: "flex", alignItems: "center", gap: 8, paddingLeft: 16 }}>
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => <div key={c} style={{ width: 13, height: 13, borderRadius: 7, background: c }} />)}</div>}
      <div style={{ width: "100%", height: barre ? "calc(100% - 40px)" : "100%" }}><Clip src={src} debut={debut} image={image} /></div></div></Pivot>;

// Carte en verre (DA du SaaS)
const Verre: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; at?: number }> = ({ children, style, at = 0 }) => {
  const f = useCurrentFrame(); const a = k(f, at, at + 0.6);
  return <div style={{ background: "rgba(255,255,255,.06)", border: `1.5px solid ${RULE}`, borderRadius: 30, boxShadow: "0 30px 80px -40px rgba(86,102,156,.6)",
    padding: "30px 34px", opacity: a, translate: `0px ${(1 - a) * 30}px`, ...style }}>{children}</div>;
};
const Logos: React.FC<{ noms: string[]; at: number; h?: number }> = ({ noms, at, h = 70 }) => {
  const f = useCurrentFrame();
  return <>{noms.map((n, i) => { const a = spring({ frame: f - S(at + i * 0.15), fps: FPS, config: { damping: 13 } });
    return <div key={n} style={{ height: h + 44, padding: "22px 30px", borderRadius: 26, background: "rgba(255,255,255,.85)", border: `1.5px solid ${RULE}`, boxSizing: "border-box",
      display: "flex", alignItems: "center", scale: `${a}`, opacity: a }}><Img src={staticFile(`marques/${n}.png`)} style={{ height: h, maxWidth: 260, objectFit: "contain" }} /></div>; })}</>;
};

// ---------- Les plans ----------
const Gauche: React.FC<{ children: React.ReactNode; top?: number }> = ({ children, top = 300 }) =>
  <div style={{ position: "absolute", left: 110, top }}>{children}</div>;

const P_lundi: Rendu = ({ l }) => {
  const f = useCurrentFrame();
  return <Fond>
    <div style={{ opacity: 0.22 * k(f, 0.2, 1.2), filter: "blur(2px)" }}><Portable src="demo/clips/mac_facture.mp4" debut={0} ratio={1040 / 1600} w={1500} cx={960} cy={540} pose={{ rx: 8, s: 1.05 + f * 0.0006 }} /></div>
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "relative", width: 1600, height: 200, display: "flex", justifyContent: "center", opacity: k(f, l[1].a - 0.2, l[1].a, 1, 0) }}>
        <Phrase l={l[0]} seul centre size={150} w={1600} /></div></AbsoluteFill>
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ opacity: k(f, l[1].a, l[1].a + 0.2) }}><Phrase l={l[1]} centre size={96} w={1500} accent={[1]} /></div></AbsoluteFill>
  </Fond>;
};
const P_logo: Rendu = ({ l }) => {
  const f = useCurrentFrame();
  return <Fond>
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: k(f, l[1].a - 0.3, l[1].a - 0.05, 1, 0) }}>
      <Phrase l={l[0]} centre size={110} w={1600} /></AbsoluteFill>
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 50, opacity: f > S(l[1].a - 0.1) ? 1 : 0 }}>
      <Logo size={230} at={l[1].a} />
      <div style={{ fontSize: 60, fontWeight: 600, letterSpacing: "-0.035em", opacity: k(f, l[1].a + 0.9, l[1].a + 1.5), translate: `0px ${(1 - k(f, l[1].a + 0.9, l[1].a + 1.5)) * 20}px` }}>{TAGLINE}</div>
    </AbsoluteFill></Fond>;
};
const P_promesse: Rendu = ({ l }) => {
  const f = useCurrentFrame();
  const t = l[0].texte, at = (m: string) => l[0].a + (t.indexOf(m) / t.length) * l[0].s;
  const piliers = [["Il la refait", "Holo, l'agent de H Company, reproduit la tâche à l'écran, comme vous", at("refait")],
    ["Il l'automatise", "avec ou sans API : un workflow testé, qui tourne tout seul", at("automatise")]] as const;
  return <Fond><Etape n="EN UNE PHRASE" t="Ce que fait Twiin" />
    <div style={{ position: "absolute", left: 110, top: 170 }}><Phrase l={{ ...l[0], texte: "Montrez une tâche une fois." }} size={84} w={1700} /></div>
    <div style={{ position: "absolute", left: 110, right: 110, top: 330, display: "flex", gap: 28 }}>
      {piliers.map(([a, b, x], i) => <div key={a} style={{ flex: 1 }}><Verre at={x - 0.15} style={{ padding: "36px 38px", ...(i === 1 ? { background: FILL, color: "#fff", border: `1.5px solid ${FILL}` } : {}) }}>
        <div style={{ fontFamily: MONO, fontSize: 24, letterSpacing: "0.12em", color: i === 1 ? "#dfe5f3" : STRONG }}>{`0${i + 1}`}</div>
        <div style={{ fontSize: 60, fontWeight: 600, letterSpacing: "-0.045em", marginTop: 10 }}>{a}</div>
        <div style={{ fontSize: 30, marginTop: 10, lineHeight: 1.3, color: i === 1 ? "#e6eaf6" : DIM }}>{b}</div></Verre></div>)}</div>
    <div style={{ position: "absolute", left: 110, right: 110, top: 720, display: "flex", gap: 16, alignItems: "center", opacity: k(f, l[0].a + l[0].s + 0.2, l[0].a + l[0].s + 0.8) }}>
      <div style={{ fontSize: 40, fontWeight: 600, letterSpacing: "-0.03em", marginRight: 12 }}>Partout :</div>
      {["Interface", "Extension Chrome", "App Mac", "Depuis votre téléphone"].map((x) => <div key={x} style={{ fontSize: 34, fontWeight: 600, color: STRONG, padding: "14px 28px", borderRadius: 999, background: "rgba(255,255,255,.07)", border: `1.5px solid ${RULE}` }}>{x}</div>)}</div>
  </Fond>;
};
const P_audit: Rendu = ({ l }) => <Fond><Etape n="1 · APPREND" t="Audit du poste" />
  <Portable src="film/audit.mp4" ratio={1000 / 1600} w={1060} cx={1310} pose={useEntree(-1)} />
  <Gauche top={330}><Phrase l={l[0]} size={54} w={560} accent={[0]} /></Gauche></Fond>;
const P_enreg: Rendu = ({ l }) => <Fond><Etape n="1 · APPREND" t="Enregistrer une fois" />
  <Fenetre src="film/ext_page.mp4" debut={1} w={1080} ratio={900 / 1440} cx={1320} pose={useEntree(-1)} />
  <Gauche top={330}><Phrase l={l[0]} size={56} w={560} accent={[1]} /></Gauche></Fond>;
const P_demande: Rendu = ({ l }) => <Fond><Etape n="2 · DÉMO RÉELLE" t="Depuis le téléphone" />
  <Telephone src="demo/clips/tel_facture.mp4" debut={0} h={900} cx={1330} pose={useEntree(-1)} />
  <Gauche top={360}><Phrase l={l[0]} size={72} w={800} accent={[1]} /></Gauche></Fond>;
const P_mac: Rendu = ({ l }) => <Fond><Etape n="2 · DÉMO RÉELLE" t="Holo pilote le Mac" />
  <Portable src="demo/clips/mac_facture.mp4" debut={2} ratio={1040 / 1600} w={1080} cx={1320} pose={useEntree(-1)} />
  <Gauche top={300}><Phrase l={l[0]} size={54} w={560} accent={[1, 3]} /></Gauche></Fond>;
const P_47: Rendu = ({ l }) => {
  const f = useCurrentFrame();
  const n = Math.round(interpolate(f, [S(l[0].a), S(l[0].a + 1.4)], [0, 47], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: out }));
  return <Fond><Etape n="2 · DÉMO RÉELLE" t="Mesuré le 20 novembre" />
    <Telephone src="demo/clips/tel_facture.mp4" debut={27} h={900} cx={1330} pose={useEntree(-1)} />
    <Gauche top={260}><div style={{ fontSize: 300, fontWeight: 600, letterSpacing: "-0.06em", color: STRONG, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{n}</div>
      <div style={{ height: 30 }} /><Phrase l={{ ...l[0], texte: l[0].texte.replace("Quarante-sept s", "S") }} size={56} w={700} /></Gauche></Fond>;
};
const P_automatise: Rendu = ({ l }) => <Fond><Etape n="3 · PROUVE" t="Un seul message" />
  <Telephone src="demo/clips/tel_automatise.mp4" debut={2.5} h={900} cx={1330} pose={useEntree(-1)} />
  <Gauche top={380}><Phrase l={l[0]} size={76} w={800} accent={[1]} /></Gauche></Fond>;
const P_preuve: Rendu = ({ l }) => {
  const f = useCurrentFrame();
  const m = morceaux(l[0].texte); const t2 = l[0].a + (l[0].texte.indexOf(m[1]) / l[0].texte.length) * l[0].s;
  const b = k(f, t2, t2 + 0.5);
  return <Fond><Etape n="3 · PROUVE" t="Rejoué et vérifié" />
    <Fenetre src="demo/clips/n8n.mp4" debut={2} w={1080} ratio={898 / 1600} cx={1320} cy={480} pose={useEntree(-1)} />
    <div style={{ position: "absolute", left: 760, top: 790, display: "flex", gap: 24, alignItems: "center", opacity: b, translate: `0px ${(1 - b) * 30}px` }}>
      <Verre style={{ padding: "18px 28px" }}><span style={{ fontFamily: MONO, fontSize: 30, color: DIM }}>Taux BCE lu : </span><span style={{ fontFamily: MONO, fontSize: 30, textDecoration: "line-through", color: "#b04a4a" }}>1.0992</span></Verre>
      <div style={{ fontSize: 34, fontWeight: 600, padding: "18px 30px", borderRadius: 999, background: FILL, color: "#fff", scale: `${spring({ frame: f - S(t2 + 0.8), fps: FPS, config: { damping: 11 } })}` }}>Bloqué, pas écrit</div></div>
    <Gauche top={240}><Phrase l={l[0]} size={48} w={560} accent={[2]} /></Gauche></Fond>;
};
const P_toujours: Rendu = ({ l }) => <Fond><Etape n="4 · FAIT" t="À votre place" />
  <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}><Phrase l={l[0]} centre size={130} w={1700} accent={[1]} /></AbsoluteFill></Fond>;
const P_cloud: Rendu = ({ l }) => {
  const f = useCurrentFrame();
  const etapes = [["Twiin", "n8n lance l'automatisation", ""], ["Cloud H Company", "Holo ouvre un navigateur", "h-company"], ["Site de la BCE", "il lit le taux du jour", ""], ["1,0992", "vérifié, puis écrit", ""]];
  return <Fond><Etape n="4 · FAIT" t="Dans le cloud de H Company" />
    <div style={{ position: "absolute", left: 110, right: 110, top: 200, display: "flex", alignItems: "center", gap: 0 }}>
      {etapes.map(([t, s, logo], i) => { const a = k(f, 0.3 + i * 0.7, 0.9 + i * 0.7);
        return <div key={t} style={{ display: "flex", alignItems: "center", flex: 1 }}>
          {i > 0 && <div style={{ width: 50, height: 4, background: STRONG, opacity: 0.6, transform: `scaleX(${a})`, transformOrigin: "left" }} />}
          <div style={{ flex: 1, opacity: a, scale: `${0.9 + a * 0.1}`, padding: "28px 30px", borderRadius: 28, background: i === 1 ? FILL : "rgba(255,255,255,.06)", color: INK, border: `1.5px solid ${i === 1 ? FILL : RULE}`, boxShadow: "0 30px 60px -40px rgba(56,66,110,.55)" }}>
            {logo && <div style={{ background: "#fff", borderRadius: 12, padding: "6px 12px", display: "inline-block", marginBottom: 12 }}><Img src={staticFile(`marques/${logo}.png`)} style={{ height: 34 }} /></div>}
            <div style={{ fontSize: 38, fontWeight: 600, letterSpacing: "-0.03em" }}>{t}</div>
            <div style={{ fontSize: 24, marginTop: 8, color: i === 1 ? "#e6eaf6" : DIM }}>{s}</div></div></div>; })}</div>
    <div style={{ position: "absolute", left: 110, top: 560, display: "flex", gap: 80, alignItems: "flex-end" }}>
      <Phrase l={l[0]} size={56} w={1000} accent={[1, 2]} /></div></Fond>;
};
const P_partout: Rendu = ({ l }) => {
  const f = useCurrentFrame();
  const p = f < S(l[1].a - 0.2) ? 0 : f < S(l[2].a - 0.2) ? 1 : f < S(l[3].a - 0.2) ? 2 : 3;
  const t0 = [0, l[1].a - 0.2, l[2].a - 0.2, l[3].a - 0.2][p];
  const a = k(f, t0, t0 + 0.8);
  const pose = { ry: -10 * (1 - a) - 6, rx: 3, s: 0.9 + a * 0.1, y: (1 - a) * 60 };
  return <Fond><Etape n="PARTOUT" t={["Interface", "Extension Chrome", "App Mac", "Depuis le téléphone"][p]} />
    {p === 0 && <Portable src="film/autos.mp4" ratio={1000 / 1600} w={1060} cx={1320} pose={pose} />}
    {p === 2 && <Fenetre src="film/app.mp4" w={470} ratio={720 / 400} cx={1200} barre={false} pose={pose} />}
    {p === 2 && <div style={{ position: "absolute", left: 1500, top: 300, width: 300 }}><Fenetre src="film/toast.mp4" w={420} ratio={140 / 420} cx={140} cy={0} barre={false} pose={{ s: k(f, t0 + 0.5, t0 + 1.1) }} /></div>}
    {p === 1 && <Fenetre src="film/ext_page.mp4" debut={2} w={1060} ratio={900 / 1440} cx={1330} pose={pose} />}
    {p === 3 && <Telephone src="demo/clips/tel_cloud.mp4" debut={18} h={900} cx={1300} pose={pose} />}
    <Gauche top={340}>{l.map((x, i) => <div key={i} style={{ opacity: i <= p ? (i === p ? 1 : 0.3) : 0 }}><Phrase l={x} size={60} w={600} accent={i === p ? [morceaux(x.texte).length - 1] : []} /></div>)}</Gauche></Fond>;
};
const P_videos: Rendu = ({ l }) => <Fond><Etape n="EN PLUS" t="Vidéo de formation" />
  <Fenetre src="demo/clips/videos.mp4" debut={3} w={1060} ratio={1040 / 1600} cx={1320} pose={useEntree(-1)} />
  <Gauche top={340}><Phrase l={l[0]} size={56} w={560} /></Gauche></Fond>;
const P_marque: Rendu = ({ l }) => <Fond><Etape n="EN PLUS" t="À votre marque" />
  <Portable src="film/marque.mp4" debut={1.2} ratio={1000 / 1600} w={1000} cx={1300} cy={600} pose={useEntree(-1)} />
  <div style={{ position: "absolute", left: 110, top: 170, display: "grid", gridTemplateColumns: "repeat(2, 300px)", gap: 18 }}>
    <Logos noms={["bnp-paribas", "meetic", "microsoft", "loreal", "decathlon", "lvmh"]} at={0.3} h={56} /></div>
    <div style={{ position: "absolute", left: 110, top: 760 }}><Phrase l={l[0]} size={60} w={700} /></div></Fond>;
const P_stack: Rendu = ({ l }) => {
  const f = useCurrentFrame();
  const t = l[0].texte, at = (mot: string) => l[0].a + (t.indexOf(mot) / t.length) * l[0].s;
  const cols = [["Agir", "Holo · Agents API", "H Company", at("Holo")], ["Orchestrer", "n8n", "workflows lisibles", at("n8n")], ["Comprendre", "Qwen", "open source · Hugging Face", at("modèle")]] as const;
  return <Fond><Etape n="SOUS LE CAPOT" t="La stack" />
    <div style={{ position: "absolute", left: 110, right: 110, top: 190, display: "flex", gap: 28 }}>
      {cols.map(([k1, t1, t2, a]) => <div key={k1} style={{ flex: 1 }}><Verre at={a - 0.1} style={{ padding: "36px 38px" }}>
        <div style={{ fontFamily: MONO, fontSize: 24, letterSpacing: "0.12em", color: STRONG }}>{k1.toUpperCase()}</div>
        <div style={{ fontSize: 64, fontWeight: 600, letterSpacing: "-0.045em", marginTop: 10 }}>{t1}</div>
        <div style={{ fontSize: 28, color: DIM, marginTop: 6 }}>{t2}</div></Verre></div>)}</div>
    <div style={{ position: "absolute", left: 110, right: 110, top: 470, display: "flex", gap: 14, opacity: k(f, l[0].a + l[0].s - 1, l[0].a + l[0].s) }}>
      {["App Mac Electron", "Extension Chrome", "Supabase", "Relais Vercel", "Voix ElevenLabs"].map((x) => <div key={x} style={{ fontFamily: MONO, fontSize: 24, color: STRONG, padding: "10px 20px", borderRadius: 999, background: "rgba(255,255,255,.07)", border: `1.5px solid ${RULE}` }}>{x}</div>)}</div>
    <div style={{ position: "absolute", left: 110, top: 610 }}><Phrase l={l[0]} size={46} w={1700} /></div></Fond>;
};
const P_prix: Rendu = ({ l }) => {
  const f = useCurrentFrame();
  const offres = [["Solo", "Indépendants", "29 €", "par mois"], ["Équipe", "PME", "390 €", "par mois"], ["Entreprise", "Grandes entreprises", "Sur devis", "diagnostic inclus"]];
  return <Fond><Etape n="OFFRES" t="Pour chaque entreprise" />
    <div style={{ position: "absolute", left: 110, right: 110, top: 190, display: "flex", gap: 28 }}>
      {offres.map(([n, c, p, s], i) => <div key={n} style={{ flex: 1 }}><Verre at={l[0].a + i * 0.6} style={{ padding: "36px 38px", ...(i === 1 ? { background: FILL, color: "#fff", border: `1.5px solid ${FILL}` } : {}) }}>
        <div style={{ fontFamily: MONO, fontSize: 24, letterSpacing: "0.12em", color: i === 1 ? "#dfe5f3" : STRONG }}>{n.toUpperCase()}</div>
        <div style={{ fontSize: 34, marginTop: 8, color: i === 1 ? "#e6eaf6" : DIM }}>{c}</div>
        <div style={{ fontSize: 96, fontWeight: 600, letterSpacing: "-0.05em", marginTop: 18, lineHeight: 1 }}>{p}</div>
        <div style={{ fontSize: 28, marginTop: 8, color: i === 1 ? "#e6eaf6" : DIM }}>{s}</div></Verre></div>)}</div>
    <div style={{ position: "absolute", left: 110, top: 640 }}><Phrase l={l[0]} size={60} w={1700} /></div>
    <div style={{ position: "absolute", left: 110, top: 760, opacity: k(f, l[1].a, l[1].a + 0.4) }}><Phrase l={l[1]} size={84} w={1700} couleur={STRONG} /></div></Fond>;
};
const P_fin: React.FC<{ l: L[]; final: { a: number; s: number } }> = ({ l, final }) => {
  const f = useCurrentFrame();
  const clip = 4.2;
  const tag = k(f, l[0].a + 0.9, l[0].a + 1.6), pw = k(f, final.a, final.a + 0.6);
  return <AbsoluteFill style={{ background: "#fff", fontFamily: FONT, color: "#161615" }}>
    <Sequence durationInFrames={S(clip)}><OffthreadVideo src={staticFile("pub/bienvenue.mp4")} muted style={{ width: "100%", height: "100%" }} /></Sequence>
    <Sequence from={S(clip)}><Img src={staticFile("pub/bienvenue-fin.png")} style={{ width: "100%", height: "100%" }} /></Sequence>
    <div style={{ position: "absolute", left: 0, right: 0, top: 700, textAlign: "center", opacity: tag, translate: `0px ${(1 - tag) * 24}px` }}>
      <div style={{ fontSize: 72, fontWeight: 600, letterSpacing: "-0.04em" }}>{TAGLINE}</div></div>
    <div style={{ position: "absolute", left: 0, right: 0, top: 830, textAlign: "center", opacity: pw }}>
      <div style={{ fontFamily: MONO, fontSize: 30, letterSpacing: "0.12em", color: FILL }}>POWERED BY H COMPANY… AND NOT A LOT OF SLEEP</div></div>
  </AbsoluteFill>;
};

// [répliques, rendu, durée minimale]
const PLANS: [number[], Rendu, number][] = [
  [[0, 1], P_lundi, 0], [[2, 3], P_logo, 0], [[22], P_promesse, 8.5], [[4], P_audit, 6], [[5], P_enreg, 6], [[6], P_demande, 5.5], [[7], P_mac, 7],
  [[8], P_47, 5.5], [[9], P_automatise, 4.5], [[10], P_preuve, 8], [[11], P_toujours, 4], [[12], P_cloud, 7],
  [[13, 14, 23, 15], P_partout, 0], [[16], P_videos, 5.5], [[17], P_marque, 5], [[18], P_stack, 9], [[19, 20], P_prix, 7.5],
];
const PRE = 0.45, GAP = 0.4, POST = 0.7;
const calage = (voix: Ligne[], fin: { s: number }) => {
  let t = 0;
  const plans = PLANS.map(([rep, r, min]) => {
    let c = PRE; const l = rep.map((i) => { const x = { a: c, s: voix[i]?.s || 2, texte: voix[i]?.texte || "" }; c += x.s + GAP; return x; });
    const d = Math.max(min, c - GAP + POST); const p = { a: t, d, l, r, rep }; t += d; return p;
  });
  const lf = { a: 4.3, s: voix[21]?.s || 3, texte: voix[21]?.texte || "" };
  const final = { a: lf.a + lf.s + 0.7, s: fin.s };
  return { plans, fin: { a: t, d: final.a + final.s + 2.2, l: [lf], final } };
};
// Coup de caméra à chaque plan : léger zoom arrière, flou qui se dissipe, flash de lumière
const Punch: React.FC<{ d: number; children: React.ReactNode }> = ({ d, children }) => {
  const f = useCurrentFrame();
  const a = k(f, 0, 0.55);
  const sortie = k(f, d - 0.25, d, 0, 1);
  const flash = interpolate(f, [0, 3, 10], [0.55, 0.35, 0], { extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ background: "#050507" }}>
    <AbsoluteFill style={{ scale: `${1.12 - a * 0.12 + sortie * 0.06}`, filter: `blur(${(1 - a) * 10 + sortie * 8}px)`, opacity: 1 - sortie * 0.6 }}>{children}</AbsoluteFill>
    <AbsoluteFill style={{ background: "radial-gradient(60% 60% at 50% 50%, #c9d2e7 0%, transparent 70%)", opacity: flash, pointerEvents: "none" }} /></AbsoluteFill>;
};
export const dureePub2 = (voix: Ligne[], fin: { s: number }) => { const c = calage(voix, fin); return S(c.fin.a + c.fin.d); };

// Pulsation sur chaque temps de la musique (No Title : 103 BPM, temps à 0,42 s + k × 0,58 s ; la vidéo commence à 40 s du morceau)
const PER = 0.58, PHASE = 0.42, DEBUT_MUSIQUE = 40;
const ENERGIE = [0.034,0.064,0.058,0.075,0.055,0.079,0.062,0.066,0.089,0.076,0.131,0.110,0.137,0.165,0.172,0.091,0.109,0.067,0.118,0.078,0.061,0.108,0.237,0.262,0.223,0.256,0.223,0.223,0.192,0.083,0.076,0.049,0.045,0.110,0.104,0.121,0.115,0.133,0.193,0.223,0.067,0.032,0.130,0.205,0.163,0.006];
const Pulse: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const f = useCurrentFrame();
  const tm = f / FPS + DEBUT_MUSIQUE;
  const b = (((tm - PHASE) % PER) + PER) % PER;
  const p = Math.exp(-b * 9);
  const en = Math.min(1, (ENERGIE[Math.floor(tm / 4)] || 0.05) / 0.2);
  const mesure = Math.floor((tm - PHASE) / PER) % 4 === 0;
  return <AbsoluteFill>
    <AbsoluteFill style={{ scale: `${1 + p * 0.008 * (0.4 + en)}` }}>{children}</AbsoluteFill>
    <AbsoluteFill style={{ pointerEvents: "none", mixBlendMode: "screen", opacity: p * (0.10 + en * 0.22) * (mesure ? 1.6 : 1),
      background: "radial-gradient(70% 55% at 50% 100%, #7f8fd0 0%, transparent 70%)" }} />
    {mesure && <AbsoluteFill style={{ pointerEvents: "none", opacity: p * en * 0.5,
      background: `linear-gradient(100deg, transparent ${b * 400 - 30}%, rgba(201,210,231,.22) ${b * 400}%, transparent ${b * 400 + 12}%)` }} />}
  </AbsoluteFill>;
};

export const TwiinPub2: React.FC<Pub2Props> = ({ voix, final, musique }) => {
  const f = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const c = calage(voix, final);
  const vol = interpolate(f, [0, S(1), durationInFrames - S(3), durationInFrames - 1], [0, 0.45, 0.45, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const coupes = c.plans.map((p) => p.a).slice(1).concat([c.fin.a]);
  return <AbsoluteFill style={{ background: "#050507" }}>
    {c.plans.map((p, i) => <Sequence key={i} from={S(p.a)} durationInFrames={S(p.d)} name={`plan-${i + 1}`}><Punch d={p.d}><Pulse><p.r l={p.l} /></Pulse></Punch>
      {p.rep.map((r, j) => voix[r] && <Sequence key={r} from={S(p.l[j].a)} durationInFrames={S(p.l[j].s + 0.2)}><Audio src={staticFile(voix[r].f)} /></Sequence>)}</Sequence>)}
    <Sequence from={S(c.fin.a)} durationInFrames={S(c.fin.d)} name="fin"><P_fin l={c.fin.l} final={c.fin.final} />
      {voix[21] && <Sequence from={S(c.fin.l[0].a)}><Audio src={staticFile(voix[21].f)} /></Sequence>}
      <Sequence from={S(c.fin.final.a)}><Audio src={staticFile(final.f)} /></Sequence></Sequence>
    {coupes.map((t) => <Sequence key={t} from={Math.max(0, S(t) - 6)} durationInFrames={S(1)}><Audio src={staticFile("pub/whoosh.mp3")} volume={0.18} /></Sequence>)}
    {musique && <Audio src={staticFile(musique)} volume={vol} />}
  </AbsoluteFill>;
};
