import { Audio } from "@remotion/media";
import type React from "react";
import { AbsoluteFill, Easing, Img, interpolate, Loop, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

// Briques communes des films Twiin (fonctionnalités, stack) : fond lavande, jumeaux, bulles, écrans filmés, schémas.
export const FPS = 30;
export const INK = "#161615", DIM = "#5d5d58", STRONG = "#56669c", LAV = "#c9d2e7", RULE = "#dce2f0";
export const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
export const MONO = '"Geist Mono", ui-monospace, "SF Mono", Menlo, monospace';
export const ease = Easing.bezier(0.16, 1, 0.3, 1);

export type Voix = { f: string; qui: "iris" | "ilo"; texte: string; s: number };
export type Scene = { id: string; repliques: number[]; min?: number; rendu: React.FC };

export const useApparait = (from = 0, dur = 0.7) => {
  const f = useCurrentFrame();
  return interpolate(f, [from * FPS, (from + dur) * FPS], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
};

export const Fond: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: "#fff", fontFamily: FONT, color: INK,
      backgroundImage: `radial-gradient(60% 70% at ${88 - Math.sin(f / 90) * 6}% 12%, ${LAV}aa 0%, transparent 70%), radial-gradient(50% 60% at ${6 + Math.sin(f / 70) * 5}% 100%, ${LAV}88 0%, transparent 65%)` }}>
      <AbsoluteFill style={{ backgroundImage: `radial-gradient(circle, ${STRONG}22 1.6px, transparent 2px)`, backgroundSize: "34px 34px" }} />
      {children}
    </AbsoluteFill>
  );
};

export const Kicker: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ display: "inline-block", fontFamily: MONO, fontSize: 26, letterSpacing: "0.08em", textTransform: "uppercase", color: STRONG,
    padding: "10px 20px", borderRadius: 999, background: `${STRONG}1a`, whiteSpace: "nowrap" }}>{children}</div>
);

export const Jumeau: React.FC<{ qui: "iris" | "ilo"; size: number; parle?: boolean }> = ({ qui, size, parle }) => {
  const f = useCurrentFrame();
  return <Img src={staticFile(`twiin/${qui}.png`)} style={{ width: size, height: size, filter: `drop-shadow(0 ${size * 0.12}px ${size * 0.18}px rgba(30,34,60,.35))`,
    translate: `0px ${parle ? -Math.abs(Math.sin(f / 4)) * size * 0.06 : Math.sin(f / 20) * size * 0.02}px` }} />;
};

export const Bulle: React.FC<{ v: Voix }> = ({ v }) => {
  const t = useApparait(0, 0.35);
  return (
    <div style={{ position: "absolute", left: 70, right: 70, bottom: 40, display: "flex", alignItems: "flex-end", gap: 18, opacity: t, translate: `0px ${(1 - t) * 20}px` }}>
      <Jumeau qui={v.qui} size={92} parle />
      <div style={{ background: "rgba(255,255,255,.96)", border: `2px solid ${RULE}`, borderRadius: "8px 26px 26px 26px", padding: "14px 24px",
        fontSize: 31, lineHeight: 1.3, fontWeight: 500, boxShadow: "0 24px 40px -26px rgba(56,66,110,.6)", maxWidth: 1560 }}>
        <div style={{ fontFamily: MONO, fontSize: 18, letterSpacing: "0.08em", color: STRONG }}>{v.qui.toUpperCase()}</div>{v.texte}
      </div>
    </div>
  );
};

// Écran filmé (vidéo) ou capture (image), avec un léger zoom continu
// Une vidéo qui recommence si la scène dure plus longtemps que l'extrait (dur = durée de l'extrait en secondes)
const Clip: React.FC<{ src: string; debut: number; dur: number; style: React.CSSProperties }> = ({ src, debut, dur, style }) => (
  <Loop durationInFrames={Math.max(1, Math.floor((dur - debut) * FPS) - 2)} layout="none">
    <OffthreadVideo src={staticFile(src)} startFrom={Math.round(debut * FPS)} muted style={style} /></Loop>);

export const Ecran: React.FC<{ src: string; w?: number; x?: number; y?: number; h?: number; debut?: number; dur?: number; image?: boolean; zoom?: boolean }> =
  ({ src, w = 1240, x = 70, y = 120, h, debut = 0, dur = 999, image, zoom = true }) => {
  const t = useApparait(0, 0.6);
  const f = useCurrentFrame();
  const z = zoom ? 1 + Math.min(f / FPS, 20) * 0.004 : 1;
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, height: h, borderRadius: 18, overflow: "hidden", border: `2px solid ${RULE}`, background: "#fff",
      boxShadow: "0 50px 90px -50px rgba(56,66,110,.7)", opacity: t, scale: `${0.94 + t * 0.06}`, translate: `0px ${(1 - t) * 40}px` }}>
      <div style={{ scale: `${z}`, transformOrigin: "50% 30%" }}>
        {image ? <Img src={staticFile(src)} style={{ width: "100%", display: "block" }} />
          : <Clip src={src} debut={debut} dur={dur} style={{ width: "100%", display: "block" }} />}
      </div>
    </div>
  );
};

export const Telephone: React.FC<{ src: string; x?: number; y?: number; h?: number; debut?: number; dur?: number }> = ({ src, x = 1400, y = 90, h = 740, debut = 0, dur = 999 }) => {
  const t = useApparait(0.15, 0.6);
  return (
    <div style={{ position: "absolute", left: x, top: y, height: h, aspectRatio: "393 / 659", borderRadius: 54, padding: 12, background: "#111",
      boxShadow: "0 50px 90px -40px rgba(20,22,40,.75)", opacity: t, translate: `0px ${(1 - t) * 60}px`, rotate: `${(1 - t) * 4}deg` }}>
      <div style={{ width: "100%", height: "100%", borderRadius: 42, overflow: "hidden", background: "#fff" }}>
        <Clip src={src} debut={debut} dur={dur} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} />
      </div>
    </div>
  );
};

export const Titre: React.FC<{ k: string; t: string; x?: number; y?: number; w?: number }> = ({ k, t, x = 70, y = 40, w = 1780 }) => {
  const a = useApparait(0, 0.6);
  return <div style={{ position: "absolute", left: x, top: y, width: w, display: "flex", alignItems: "center", gap: 20, opacity: a, translate: `${(1 - a) * -30}px 0px` }}>
    <Kicker>{k}</Kicker><div style={{ fontSize: 44, fontWeight: 600, letterSpacing: "-0.03em" }}>{t}</div></div>;
};

// Carte « Pourquoi » : le choix fait, et l'alternative écartée
export const Pourquoi: React.FC<{ oui: string; non: string; at?: number; x?: number; y?: number; w?: number }> = ({ oui, non, at = 0.8, x = 1360, y = 200, w = 490 }) => {
  const a = useApparait(at, 0.7);
  return <div style={{ position: "absolute", left: x, top: y, width: w, opacity: a, translate: `${(1 - a) * 60}px 0px`, display: "flex", flexDirection: "column", gap: 18 }}>
    <div style={{ padding: "26px 30px", borderRadius: 26, background: "#fff", border: `2px solid ${STRONG}`, boxShadow: "0 30px 60px -40px rgba(56,66,110,.6)" }}>
      <div style={{ fontFamily: MONO, fontSize: 20, letterSpacing: "0.08em", color: STRONG }}>NOTRE CHOIX</div>
      <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: "-0.02em", marginTop: 8, lineHeight: 1.2 }}>{oui}</div></div>
    <div style={{ padding: "22px 30px", borderRadius: 26, background: "rgba(255,255,255,.6)", border: `2px dashed ${RULE}` }}>
      <div style={{ fontFamily: MONO, fontSize: 20, letterSpacing: "0.08em", color: DIM }}>PLUTÔT QUE</div>
      <div style={{ fontSize: 30, marginTop: 8, color: DIM, lineHeight: 1.25, textDecoration: "line-through", textDecorationColor: `${DIM}88` }}>{non}</div></div>
  </div>;
};

export const Carte: React.FC<{ n: string; l: string; at: number; petit?: boolean }> = ({ n, l, at, petit }) => {
  const a = useApparait(at, 0.7);
  return <div style={{ opacity: a, translate: `0px ${(1 - a) * 40}px`, flex: 1, padding: petit ? "26px 28px" : "34px 38px", borderRadius: 28, background: "#fff", border: `2px solid ${RULE}`,
    boxShadow: "0 30px 60px -40px rgba(56,66,110,.6)" }}>
    <div style={{ fontSize: petit ? 50 : 84, fontWeight: 600, letterSpacing: "-0.04em", color: STRONG, lineHeight: 1.05 }}>{n}</div>
    <div style={{ fontSize: petit ? 26 : 30, marginTop: 12, color: DIM, lineHeight: 1.3 }}>{l}</div></div>;
};

export const Ouverture: React.FC<{ titre: string; sous: string }> = ({ titre, sous }) => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const s = spring({ frame: f, fps, config: { damping: 14 } });
  return (<Fond><AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 28, paddingBottom: 120 }}>
    <div style={{ display: "flex", gap: 40, scale: `${s}` }}><Jumeau qui="iris" size={240} parle /><Jumeau qui="ilo" size={240} /></div>
    <div style={{ fontSize: 140, fontWeight: 600, letterSpacing: "-0.06em", lineHeight: 1, opacity: s }}>{titre}</div>
    <Kicker>{sous}</Kicker></AbsoluteFill></Fond>);
};

const GAP = 0.35;
const dureeScene = (sc: Scene, voix: Voix[]) => Math.max(sc.min || 0, sc.repliques.reduce((n, i) => n + (voix[i]?.s || 0) + GAP, 0.7));
export const dureeFilm = (scenes: Scene[], voix: Voix[]) => Math.ceil(scenes.reduce((n, sc) => n + dureeScene(sc, voix), 0) * FPS);

// Transition : chaque scène glisse et se fond dans la suivante
const Entree: React.FC<{ children: React.ReactNode; d: number }> = ({ children, d }) => {
  const f = useCurrentFrame();
  const a = interpolate(f, [0, 10], [0, 1], { extrapolateRight: "clamp", easing: ease });
  const b = interpolate(f, [d * FPS - 8, d * FPS], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ opacity: Math.min(a, b), translate: `${(1 - a) * 80}px 0px` }}>{children}</AbsoluteFill>;
};

export const Film: React.FC<{ scenes: Scene[]; voix: Voix[] }> = ({ scenes, voix }) => {
  let t = 0;
  return (
    <AbsoluteFill style={{ background: "#fff", fontFamily: FONT, color: INK }}>
      {scenes.map((sc) => {
        const d = dureeScene(sc, voix);
        const debut = t; t += d;
        let r = 0.45;
        return (
          <Sequence key={sc.id} name={sc.id} from={Math.round(debut * FPS)} durationInFrames={Math.round(d * FPS)}>
            <Entree d={d}><sc.rendu /></Entree>
            {sc.repliques.map((i) => {
              const v = voix[i]; if (!v) return null;
              const at = r; r += v.s + GAP;
              return (
                <Sequence key={i} from={Math.round(at * FPS)} durationInFrames={Math.round((v.s + GAP) * FPS)}>
                  <Audio src={staticFile(v.f)} /><Bulle v={v} />
                </Sequence>
              );
            })}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
