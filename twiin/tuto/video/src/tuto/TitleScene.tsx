import { Audio } from "@remotion/media";
import type React from "react";
import { AbsoluteFill, Easing, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, FONT } from "./types";

type Props = {
  readonly eyebrow: string;
  readonly title: string;
  readonly text: string;
  readonly audio: string | null;
};

// Écran d'ouverture et de conclusion du tuto.
export const TitleScene: React.FC<Props> = ({ eyebrow, title, text, audio }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.bg,
        backgroundImage: "radial-gradient(ellipse at top, #141a26 0%, #0e1014 60%)",
        justifyContent: "center",
        padding: "0 160px",
        fontFamily: FONT,
      }}
    >
      {audio ? <Audio src={staticFile(audio)} premountFor={fps} /> : null}
      <div
        style={{
          color: COLORS.accent,
          fontSize: 34,
          fontWeight: 700,
          letterSpacing: "0.18em",
          opacity: interpolate(frame, [0, 0.6 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        {eyebrow}
      </div>
      <div
        style={{
          color: COLORS.text,
          fontSize: 96,
          fontWeight: 800,
          lineHeight: 1.08,
          marginTop: 24,
          opacity: interpolate(frame, [0.2 * fps, 1 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          translate: interpolate(frame, [0.2 * fps, 1 * fps], ["0px 40px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        {title}
      </div>
      <div
        style={{
          color: COLORS.dim,
          fontSize: 48,
          lineHeight: 1.35,
          marginTop: 36,
          maxWidth: 1500,
          opacity: interpolate(frame, [0.6 * fps, 1.4 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};
