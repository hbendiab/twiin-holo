import { Audio } from "@remotion/media";
import type React from "react";
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Jumeaux } from "./Jumeaux";
import { COLORS, type Marque, MONO } from "./types";

type Props = {
  readonly eyebrow: string;
  readonly title: string;
  readonly text: string;
  readonly audio: string | null;
  readonly marque?: Marque | null;
  readonly facts?: readonly string[];
  readonly logos?: readonly string[];
};

const ease = Easing.bezier(0.16, 1, 0.3, 1);

// Couverture du tuto (et conclusion) dans la DA Twiin : comme une miniature YouTube, lisible d'un coup d'œil.
// Avec la marque de l'entreprise cliente : son logo à côté de Twiin et sa couleur à la place du lavande.
export const TitleScene: React.FC<Props> = ({ eyebrow, title, text, audio, marque, facts = [], logos = [] }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fort = marque?.couleur || COLORS.accent;
  const voile = marque?.couleur2 ? `${marque.couleur2}cc` : marque?.couleur ? `${marque.couleur}33` : `${COLORS.lavender}cc`;
  const appear = (from: number, to: number) => interpolate(frame, [from * fps, to * fps], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
  const look = interpolate(frame, [0, 2 * fps, 4 * fps], [-1, 1, 0], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#ffffff",
        backgroundImage: `radial-gradient(60% 70% at 88% 18%, ${voile} 0%, transparent 70%), radial-gradient(50% 60% at 8% 100%, ${voile} 0%, transparent 65%)`,
        color: COLORS.text,
      }}
    >
      {audio ? <Audio src={staticFile(audio)} premountFor={fps} /> : null}
      {/* points en fond, comme la toile des automatisations */}
      <AbsoluteFill style={{ backgroundImage: `radial-gradient(circle, ${fort}26 1.6px, transparent 2px)`, backgroundSize: "34px 34px", opacity: 0.6 }} />

      {/* en-tête : Twiin (× entreprise) */}
      <div style={{ position: "absolute", top: 72, left: 120, display: "flex", alignItems: "center", gap: 18, opacity: appear(0, 0.5) }}>
        <Jumeaux size={40} gap={4} look={look} />
        <div style={{ fontSize: 40, fontWeight: 600, letterSpacing: "-0.035em" }}>Twiin</div>
        {marque && (marque.logo || marque.nom) ? (
          <>
            <div style={{ fontSize: 34, opacity: 0.4 }}>×</div>
            {marque.logo ? (
              <Img src={staticFile(marque.logo)} style={{ maxHeight: 54, maxWidth: 260, objectFit: "contain" }} />
            ) : (
              <div style={{ fontSize: 40, fontWeight: 600 }}>{marque.nom}</div>
            )}
          </>
        ) : null}
      </div>

      {/* à droite : les logos des applis de la tâche (comme une miniature), sinon Iris et Ilo */}
      <div style={{ position: "absolute", right: 130, top: 0, bottom: 0, width: 620, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {logos.length ? (
          <div style={{ position: "relative", width: 560, height: 560 }}>
            {logos.slice(0, 4).map((src, i) => {
              const n = Math.min(4, logos.length);
              const pos = n === 1 ? [[140, 140]] : n === 2 ? [[40, 150], [260, 170]] : n === 3 ? [[20, 60], [270, 120], [120, 310]] : [[20, 40], [290, 20], [60, 300], [320, 290]];
              const [x, y] = pos[i];
              const t = appear(0.15 + i * 0.12, 0.75 + i * 0.12);
              const size = n === 1 ? 280 : 230;
              return (
                <div key={src} style={{ position: "absolute", left: x, top: y, width: size, height: size, borderRadius: size * 0.24, background: "#fff",
                  border: `2px solid ${COLORS.line}`, boxShadow: "0 40px 70px -36px rgba(56,66,110,.55)", display: "grid", placeItems: "center",
                  opacity: t, rotate: `${(i % 2 ? 6 : -6) * (1 - t * 0.5)}deg`, translate: `0px ${interpolate(t, [0, 1], [50, 0])}px` }}>
                  <Img src={staticFile(src)} style={{ width: size * 0.62, height: size * 0.62, objectFit: "contain" }} />
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ opacity: appear(0.1, 0.8), translate: `0px ${interpolate(appear(0.1, 0.8), [0, 1], [60, 0])}px` }}>
            <Jumeaux size={230} gap={24} look={look} />
          </div>
        )}
      </div>

      <div style={{ position: "absolute", left: 120, top: 0, bottom: 0, width: 1000, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-start" }}>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 28,
            fontWeight: 500,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: fort,
            padding: "10px 22px",
            borderRadius: 999,
            background: `${fort}1a`,
            opacity: appear(0.1, 0.6),
          }}
        >
          {eyebrow}
        </div>
        <div
          style={{
            fontSize: title.length > 34 ? 104 : 128,
            fontWeight: 600,
            lineHeight: 1.02,
            letterSpacing: "-0.045em",
            marginTop: 34,
            opacity: appear(0.2, 1),
            translate: `0px ${interpolate(appear(0.2, 1), [0, 1], [40, 0])}px`,
          }}
        >
          {title}
        </div>
        {text ? (
          <div style={{ color: COLORS.dim, fontSize: 40, lineHeight: 1.35, marginTop: 36, maxWidth: 1000, opacity: appear(0.6, 1.4) }}>{text}</div>
        ) : null}
        {facts.length ? (
          <div style={{ display: "flex", gap: 14, marginTop: 44, opacity: appear(0.4, 1) }}>
            {facts.map((f) => (
              <div key={f} style={{ fontFamily: MONO, fontSize: 28, padding: "12px 24px", borderRadius: 999, background: "#fff", border: `2px solid ${COLORS.line}` }}>
                {f}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
