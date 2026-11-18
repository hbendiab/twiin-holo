import { Audio } from "@remotion/media";
import type React from "react";
import {
  AbsoluteFill,
  CanvasImage,
  Easing,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS, FONT, type Scene, type Shot } from "./types";

// Zone où s'affiche la capture (sous le bandeau, au-dessus des sous-titres)
const AREA = { x: 80, y: 176, w: 1760, h: 590 };

type ShotProps = { readonly shot: Shot; readonly duration: number };

// Une capture de Holo : zoom lent vers l'endroit cliqué + cercle qui pulse sur le clic.
const ShotView: React.FC<ShotProps> = ({ shot, duration }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ratio = Math.min(AREA.w / shot.w, AREA.h / shot.h);
  const w = shot.w * ratio;
  const h = shot.h * ratio;
  const cx = shot.click ? shot.click.x * 100 : 50;
  const cy = shot.click ? shot.click.y * 100 : 50;

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
          opacity: interpolate(frame, [0, 0.3 * fps], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            transformOrigin: `${cx}% ${cy}%`,
            scale: interpolate(frame, [0, duration], [1, shot.click ? 1.35 : 1.06], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.33, 0, 0.2, 1),
            }),
          }}
        >
          <CanvasImage src={staticFile(shot.src)} width={w} height={h} fit="fill" premountFor={fps} />
          {shot.click ? (
            <div
              style={{
                position: "absolute",
                left: `${cx}%`,
                top: `${cy}%`,
                width: 54,
                height: 54,
                marginLeft: -27,
                marginTop: -27,
                borderRadius: "50%",
                border: `5px solid ${COLORS.click}`,
                boxShadow: `0 0 0 8px rgba(255,107,91,0.25)`,
                scale: interpolate(frame % (0.9 * fps), [0, 0.9 * fps], [0.7, 1.25], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                }),
                opacity: interpolate(frame, [0.3 * fps, 0.6 * fps], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                }),
              }}
            />
          ) : null}
        </div>
      </div>
    </AbsoluteFill>
  );
};

type Props = { readonly scene: Scene; readonly index: number; readonly total: number };

// Une étape du tuto : bandeau, captures de Holo, narration en sous-titre, astuce, voix off.
export const StepScene: React.FC<Props> = ({ scene, index, total }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const per = Math.max(1, Math.floor(scene.durationInFrames / Math.max(1, scene.shots.length)));

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bg, fontFamily: FONT }}>
      {scene.audio ? <Audio src={staticFile(scene.audio)} premountFor={fps} /> : null}

      <div style={{ position: "absolute", left: 80, top: 56, right: 80, display: "flex", alignItems: "baseline", gap: 28 }}>
        <div style={{ color: COLORS.accent, fontSize: 34, fontWeight: 700, letterSpacing: "0.12em" }}>
          ÉTAPE {index}/{total}
        </div>
        <div style={{ color: COLORS.text, fontSize: 64, fontWeight: 800 }}>{scene.title}</div>
      </div>

      {scene.shots.map((shot, i) => (
        <Sequence
          key={shot.src}
          name={`Capture ${i + 1}`}
          from={i * per}
          durationInFrames={i === scene.shots.length - 1 ? scene.durationInFrames - i * per : per}
          premountFor={fps}
        >
          <ShotView shot={shot} duration={per} />
        </Sequence>
      ))}

      <div
        style={{
          position: "absolute",
          left: 80,
          right: 80,
          bottom: 40,
          minHeight: 250,
          justifyContent: "flex-end",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          opacity: interpolate(frame, [0.2 * fps, 0.7 * fps], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        }}
      >
        <div style={{ color: COLORS.text, fontSize: 36, lineHeight: 1.3 }}>{scene.narration}</div>
        {scene.tip ? (
          <div
            style={{
              alignSelf: "flex-start",
              color: COLORS.bg,
              backgroundColor: COLORS.warn,
              fontSize: 30,
              fontWeight: 700,
              padding: "8px 18px",
              borderRadius: 12,
            }}
          >
            💡 {scene.tip}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
