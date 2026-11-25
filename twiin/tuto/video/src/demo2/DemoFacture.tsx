import { Audio } from "@remotion/media";
import type React from "react";
import { AbsoluteFill, Easing, Img, interpolate, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame } from "remotion";

// Démo réelle accélérée (20 novembre) : le dirigeant demande depuis son téléphone, Holo fait la tâche sur le Mac,
// Twiin l'automatise (n8n), la relance, puis crée la vidéo de formation. Plan : public/demo2/plan.json.
const FPS = 30;
const S = (s: number) => Math.round(s * FPS);
const INK = "#f4f5fa", DIM = "#a3a8bd", LAV = "#aab6dc", FILL = "#56669c";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const MONO = '"Geist Mono", ui-monospace, "SF Mono", Menlo, monospace';
const out = Easing.bezier(0.16, 1, 0.3, 1);

type Seg = { id: string; titre: string; texte: string | null; voix: string | null; voix_s: number; d: number; vitesse: number | null; reel: string | null; mac?: string; tel?: string; safari?: boolean };
export type DemoFactureProps = { plan: Seg[] };
const t0 = (p: Seg[]) => p.reduce((n, s) => n + s.d, 0);
export const dureeDemoFacture = (p: Seg[]) => S(2.6 + t0(p));

const k = (f: number, a: number, b: number) => interpolate(f, [S(a), S(b)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: out });

const Fond: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const f = useCurrentFrame();
  return <AbsoluteFill style={{ background: "#050507", fontFamily: FONT, color: INK }}>
    <AbsoluteFill style={{ background: `radial-gradient(50% 60% at ${80 + Math.sin(f / 80) * 6}% 10%, #56669c55 0%, transparent 70%), radial-gradient(45% 55% at 10% 100%, #56669c33 0%, transparent 70%)` }} />
    {children}</AbsoluteFill>;
};

const Mac: React.FC<{ src: string; seul: boolean; ratio: number }> = ({ src, seul, ratio }) => {
  const f = useCurrentFrame(); const a = k(f, 0, 0.5);
  const w = seul ? 1240 : 1180;
  return <div style={{ position: "absolute", left: seul ? 340 : 80, top: 128, width: w, opacity: a, scale: `${0.97 + a * 0.03}` }}>
    <div style={{ background: "#1c1d24", borderRadius: "20px 20px 0 0", padding: 14, boxShadow: "0 60px 120px -60px rgba(86,102,156,.8)" }}>
      <div style={{ width: "100%", aspectRatio: `${ratio}`, overflow: "hidden", borderRadius: 4, background: "#fff" }}>
        <OffthreadVideo src={staticFile(src)} muted style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} /></div></div>
    <div style={{ height: 22, margin: "0 -40px", borderRadius: "0 0 22px 22px", background: "linear-gradient(180deg,#d9dce6,#9ea3b3)" }} />
  </div>;
};
const Tel: React.FC<{ src: string; seul: boolean }> = ({ src, seul }) => {
  const f = useCurrentFrame(); const a = k(f, 0.1, 0.6);
  const h = 760;
  return <div style={{ position: "absolute", left: seul ? 960 - (h * 392 / 852) / 2 - 14 : 1400, top: 150, height: h + 28, aspectRatio: "392 / 852", padding: 14, boxSizing: "content-box",
    borderRadius: 64, background: "linear-gradient(145deg,#3a3c47,#16171d 45%,#2c2e38)", opacity: a, translate: `0px ${(1 - a) * 40}px`, boxShadow: "0 60px 110px -50px rgba(86,102,156,.8)" }}>
    <div style={{ width: "100%", height: "100%", borderRadius: 50, overflow: "hidden", background: "#fff" }}>
      <OffthreadVideo src={staticFile(src)} muted style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top", display: "block" }} /></div></div>;
};

const Bandeau: React.FC<{ s: Seg; n: number }> = ({ s, n }) => {
  const f = useCurrentFrame(); const a = k(f, 0, 0.5);
  return <div style={{ position: "absolute", left: 80, right: 80, top: 52, display: "flex", alignItems: "center", gap: 18, opacity: a }}>
    <div style={{ fontFamily: MONO, fontSize: 24, letterSpacing: "0.12em", color: LAV, padding: "10px 20px", borderRadius: 999, background: "rgba(255,255,255,.07)", border: "1.5px solid rgba(255,255,255,.14)" }}>{`ÉTAPE ${n}`}</div>
    <div style={{ fontSize: 44, fontWeight: 600, letterSpacing: "-0.03em" }}>{s.titre}</div>
    <div style={{ flex: 1 }} />
    {s.vitesse && s.vitesse > 1.2 && <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <div style={{ fontFamily: MONO, fontSize: 28, fontWeight: 600, color: "#fff", padding: "8px 18px", borderRadius: 12, background: FILL }}>{`×${Math.round(s.vitesse)}`}</div>
      {s.reel && <div style={{ fontFamily: MONO, fontSize: 22, color: DIM }}>{`durée réelle : ${s.reel}`}</div>}</div>}
  </div>;
};
const SousTitre: React.FC<{ t: string }> = ({ t }) => {
  const f = useCurrentFrame(); const a = k(f, 0.2, 0.6);
  return <div style={{ position: "absolute", left: 160, right: 160, bottom: 34, textAlign: "center", fontSize: 30, lineHeight: 1.35, color: INK, opacity: a * 0.92,
    textShadow: "0 2px 12px rgba(0,0,0,.8)" }}>{t}</div>;
};

const Ouverture: React.FC = () => {
  const f = useCurrentFrame(); const a = spring({ frame: f, fps: FPS, config: { damping: 14 } });
  return <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 30, opacity: 1 - k(f, 2.2, 2.6) }}>
    <div style={{ display: "flex", alignItems: "center", gap: 24, scale: `${0.9 + a * 0.1}`, opacity: a }}>
      <div style={{ display: "flex" }}><Img src={staticFile("twiin/iris.png")} style={{ width: 120, height: 120 }} /><Img src={staticFile("twiin/ilo.png")} style={{ width: 120, height: 120, marginLeft: -16 }} /></div>
      <div style={{ fontSize: 130, fontWeight: 600, letterSpacing: "-0.05em" }}>Twiin</div></div>
    <div style={{ fontFamily: MONO, fontSize: 28, letterSpacing: "0.12em", color: LAV, opacity: k(f, 0.5, 1) }}>DÉMO RÉELLE · 20 NOVEMBRE 2026 · ACCÉLÉRÉE</div>
  </AbsoluteFill>;
};
const Fin: React.FC = () => {
  const f = useCurrentFrame(); const a = spring({ frame: f, fps: FPS, config: { damping: 14 } });
  return <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 34 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 22, scale: `${0.9 + a * 0.1}`, opacity: a }}>
      <div style={{ display: "flex" }}><Img src={staticFile("twiin/iris.png")} style={{ width: 110, height: 110 }} /><Img src={staticFile("twiin/ilo.png")} style={{ width: 110, height: 110, marginLeft: -14 }} /></div>
      <div style={{ fontSize: 120, fontWeight: 600, letterSpacing: "-0.05em" }}>Twiin</div></div>
    <div style={{ fontSize: 64, fontWeight: 600, letterSpacing: "-0.035em", opacity: k(f, 0.6, 1.2) }}>Montrez une fois. <span style={{ color: LAV }}>Twiin le fait partout.</span></div>
    <div style={{ fontFamily: MONO, fontSize: 26, letterSpacing: "0.12em", color: DIM, opacity: k(f, 1.2, 1.8) }}>POWERED BY H COMPANY</div>
  </AbsoluteFill>;
};

export const DemoFacture: React.FC<DemoFactureProps> = ({ plan }) => {
  let t = 0; const OUV = 2.6;
  return <Fond>
    <Audio src={staticFile("pub/musique-subclair.mp3")} volume={(f) => interpolate(f, [0, 30, S(OUV + t0(plan)) - 60, S(OUV + t0(plan))], [0, 0.12, 0.12, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />
    <Sequence durationInFrames={S(OUV)}><Ouverture /></Sequence>
    {plan.map((s, i) => {
      const a = OUV + t; t += s.d;
      const n = plan.slice(0, i + 1).filter((x) => x.id !== "fin").length;
      return <Sequence key={s.id} from={S(a)} durationInFrames={S(s.d)} name={s.id}>
        {s.id === "fin" ? <Fin /> : <>
          <Bandeau s={s} n={n} />
          {s.mac && <Mac src={s.mac} seul={!s.tel} ratio={s.safari ? 2940 / 1682 : 2940 / 1912} />}
          {s.tel && <Tel src={s.tel} seul={!s.mac} />}
          {s.texte && <SousTitre t={s.texte} />}
        </>}
        {s.voix && <Sequence from={S(0.3)}><Audio src={staticFile(s.voix)} /></Sequence>}
      </Sequence>;
    })}
  </Fond>;
};
export const OUVERTURE_S = 2.6;
