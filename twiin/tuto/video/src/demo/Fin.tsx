import { Audio } from "@remotion/media";
import type React from "react";
import { AbsoluteFill, Easing, Img, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

// Fin du pitch : Iris et Ilo saluent le jury (voix : public/demo/fin.json). Déclenchée à la fin des 6 minutes.
type Voix = { f: string; qui: "iris" | "ilo"; texte: string; s: number };
export type FinProps = { voix: Voix[] };
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
const STRONG = "#56669c", LAV = "#c9d2e7";
const GAP = 0.3;
export const dureeFin = (v: Voix[]) => Math.ceil((1.2 + v.reduce((n, x) => n + x.s + GAP, 0) + 2.5) * 30);

const Jumeau: React.FC<{ qui: "iris" | "ilo"; parle: boolean; i: number }> = ({ qui, parle, i }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const entree = spring({ frame: f - i * 8, fps, config: { damping: 12, mass: 0.8 } });
  const saut = parle ? -Math.abs(Math.sin(f / 3.6)) * 28 : Math.sin(f / 18 + i) * 6;
  return <Img src={staticFile(`twiin/${qui}.png`)} style={{ width: 380, height: 380, scale: `${entree * (parle ? 1.06 : 1)}`,
    translate: `0px ${saut + (1 - entree) * 300}px`, rotate: `${parle ? Math.sin(f / 5) * 4 : 0}deg`,
    filter: `drop-shadow(0 40px 50px rgba(30,34,60,.4))`, opacity: parle ? 1 : 0.75, transition: "opacity .2s" }} />;
};

export const TwiinFin: React.FC<FinProps> = ({ voix }) => {
  const f = useCurrentFrame();
  let t = 1.2;
  const moments = voix.map((v) => { const a = t; t += v.s + GAP; return { ...v, a }; });
  const enCours = moments.find((m) => f / 30 >= m.a && f / 30 < m.a + m.s) || null;
  const fin = f / 30 >= t;
  const finA = interpolate(f / 30, [t, t + 0.8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) });
  return (
    <AbsoluteFill style={{ background: "#fff", fontFamily: FONT, color: "#161615", alignItems: "center", justifyContent: "center",
      backgroundImage: `radial-gradient(60% 70% at 85% 10%, ${LAV}cc 0%, transparent 70%), radial-gradient(50% 60% at 10% 100%, ${LAV}aa 0%, transparent 65%)` }}>
      <AbsoluteFill style={{ backgroundImage: `radial-gradient(circle, ${STRONG}22 1.6px, transparent 2px)`, backgroundSize: "34px 34px" }} />
      {moments.map((m, i) => <Sequence key={i} from={Math.round(m.a * 30)}><Audio src={staticFile(m.f)} /></Sequence>)}
      <div style={{ display: "flex", gap: 80, translate: `0px ${-finA * 90}px` }}>
        <Jumeau qui="iris" i={0} parle={enCours?.qui === "iris"} />
        <Jumeau qui="ilo" i={1} parle={enCours?.qui === "ilo"} />
      </div>
      <div style={{ position: "absolute", bottom: 150, left: 160, right: 160, textAlign: "center", fontSize: 54, fontWeight: 600, letterSpacing: "-0.03em",
        minHeight: 140, opacity: fin ? 0 : 1 }}>{enCours?.texte || ""}</div>
      <div style={{ position: "absolute", bottom: 120, textAlign: "center", opacity: finA, translate: `0px ${(1 - finA) * 30}px` }}>
        <div style={{ fontSize: 120, fontWeight: 600, letterSpacing: "-0.06em" }}>Merci !</div>
        <div style={{ fontFamily: MONO, fontSize: 28, color: STRONG, letterSpacing: "0.06em", marginTop: 10 }}>TWIIN · POWERED BY H COMPANY · AND NOT A LOT OF SLEEP</div>
      </div>
    </AbsoluteFill>
  );
};
