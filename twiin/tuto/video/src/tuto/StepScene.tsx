import { Audio } from "@remotion/media";
import type React from "react";
import {
  AbsoluteFill,
  CanvasImage,
  Img,
  Easing,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS, MONO, type Scene, type Shot } from "./types";

// Zone où s'affiche la capture (sous le bandeau, au-dessus des sous-titres)
const AREA = { x: 80, y: 140, w: 1760, h: 620 };

type ShotProps = { readonly shot: Shot; readonly duration: number };

// Mouvement calme, au rythme de la voix off :
//  1. plan large et fixe (on découvre l'écran) ;
//  2. zoom doux vers l'endroit cliqué pendant que la voix l'explique ;
//  3. cercle sur le clic, qui pulse lentement.
// Sans clic (résultat d'une saisie) : très léger travelling, presque fixe.
const ZOOM = 1.6;
const ShotView: React.FC<ShotProps> = ({ shot, duration }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ratio = Math.min(AREA.w / shot.w, AREA.h / shot.h);
  const w = shot.w * ratio;
  const h = shot.h * ratio;
  const cx = shot.click ? shot.click.x * 100 : 50;
  const cy = shot.click ? shot.click.y * 100 : 50;
  const zoomStart = Math.round(duration * 0.3);
  const zoomEnd = Math.max(zoomStart + Math.round(1.2 * fps), Math.round(duration * 0.62));
  const scale = shot.click
    ? interpolate(frame, [zoomStart, zoomEnd], [1, ZOOM], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.45, 0, 0.2, 1) })
    : interpolate(frame, [0, duration], [1, 1.03], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const ringFrom = zoomEnd - Math.round(0.2 * fps);
  const period = Math.round(1.6 * fps);
  const pulse = frame < ringFrom ? 0 : ((frame - ringFrom) % period) / period;

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", top: AREA.y, height: AREA.h }}>
      <div
        style={{
          position: "relative",
          width: w,
          height: h,
          overflow: "hidden",
          borderRadius: 18,
          border: `2px solid ${COLORS.line}`,
          background: COLORS.panel,
          boxShadow: "0 40px 80px -40px rgba(56,66,110,0.55)",
          opacity: interpolate(frame, [0, 0.5 * fps], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        }}
      >
        <div style={{ position: "absolute", inset: 0, transformOrigin: `${cx}% ${cy}%`, scale }}>
          <CanvasImage src={staticFile(shot.src)} width={w} height={h} fit="fill" premountFor={fps} />
          {shot.click ? (
            <div
              style={{
                position: "absolute",
                left: `${cx}%`,
                top: `${cy}%`,
                width: 46 / ZOOM,
                height: 46 / ZOOM,
                marginLeft: -23 / ZOOM,
                marginTop: -23 / ZOOM,
                borderRadius: "50%",
                border: `${4 / ZOOM}px solid ${COLORS.click}`,
                boxShadow: `0 0 0 ${pulse * 18 / ZOOM}px rgba(255,107,91,${0.35 * (1 - pulse)})`,
                opacity: interpolate(frame, [ringFrom, ringFrom + 0.4 * fps], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
              }}
            />
          ) : null}
        </div>
      </div>
    </AbsoluteFill>
  );
};

type Props = { readonly scene: Scene; readonly index: number; readonly total: number; readonly accent?: string };

// Une étape du tuto : bandeau, captures de Holo, narration en sous-titre, astuce, voix off.
export const StepScene: React.FC<Props> = ({ scene, index, total, accent = COLORS.accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const per = Math.max(1, Math.floor(scene.durationInFrames / Math.max(1, scene.shots.length)));
  const overlap = Math.round(0.5 * fps); // fondu entre deux images

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bg, backgroundImage: `radial-gradient(60% 50% at 100% 0%, ${accent}1f 0%, transparent 70%)` }}>
      {scene.audio ? <Audio src={staticFile(scene.audio)} premountFor={fps} /> : null}

      <div style={{ position: "absolute", left: 80, top: 56, right: 80, display: "flex", alignItems: "baseline", gap: 28 }}>
        <div style={{ color: accent, fontFamily: MONO, fontSize: 28, fontWeight: 500, letterSpacing: "0.08em", padding: "8px 18px", borderRadius: 999, background: `${accent}1a`, alignSelf: "center" }}>
          ÉTAPE {index}/{total}
        </div>
        <div style={{ color: COLORS.text, fontSize: 62, fontWeight: 600, letterSpacing: "-0.035em" }}>{scene.title}</div>
      </div>

      {scene.shots.map((shot, i) => (
        <Sequence
          key={shot.src}
          name={`Capture ${i + 1}`}
          from={Math.max(0, i * per - (i ? overlap : 0))}
          durationInFrames={i === scene.shots.length - 1 ? scene.durationInFrames - Math.max(0, i * per - (i ? overlap : 0)) : per}
          premountFor={fps}
        >
          <ShotView shot={shot} duration={i === scene.shots.length - 1 ? scene.durationInFrames - i * per + overlap : per} />
        </Sequence>
      ))}

      <div
        style={{
          position: "absolute",
          left: 80,
          right: 80,
          bottom: 36,
          justifyContent: "flex-end",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          opacity: interpolate(frame, [0.2 * fps, 0.7 * fps], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        }}
      >
        {/* le jumeau qui parle (Iris ou Ilo, à tour de rôle) et sa bulle */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 22 }}>
          <Img src={staticFile(`twiin/${scene.qui || (index % 2 ? "iris" : "ilo")}.png`)}
            style={{ width: 104, height: 104, flex: "none", filter: "drop-shadow(0 14px 18px rgba(30,34,60,.35))",
              translate: `0px ${-Math.abs(Math.sin(frame / 4.2)) * 7}px`, rotate: `${Math.sin(frame / 9) * 3}deg` }} />
          <div style={{ color: COLORS.text, fontSize: 34, lineHeight: 1.3, fontWeight: 500, background: "#ffffff", border: `2px solid ${COLORS.line}`,
            borderRadius: "8px 28px 28px 28px", padding: "18px 26px", boxShadow: "0 24px 40px -28px rgba(56,66,110,.55)", maxWidth: 1560 }}>
            <div style={{ fontFamily: MONO, fontSize: 20, letterSpacing: "0.08em", color: accent, marginBottom: 4 }}>
              {(scene.qui || (index % 2 ? "iris" : "ilo")).toUpperCase()}
            </div>
            {scene.narration}
          </div>
        </div>
        {scene.tip ? (
          <div
            style={{
              alignSelf: "flex-start",
              color: accent,
              backgroundColor: `${accent}1a`,
              fontSize: 30,
              fontWeight: 500,
              padding: "10px 22px",
              borderRadius: 999,
            }}
          >
            <span style={{ fontFamily: MONO, fontSize: 24, letterSpacing: "0.08em", marginRight: 14 }}>ASTUCE</span>{scene.tip}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
