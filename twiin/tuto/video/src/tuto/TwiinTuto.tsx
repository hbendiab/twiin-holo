import { fade } from "@remotion/transitions/fade";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import type React from "react";
import { type CalculateMetadataFunction, staticFile, useVideoConfig } from "remotion";
import { StepScene } from "./StepScene";
import { TitleScene } from "./TitleScene";
import { type TutoData, TRANSITION_FRAMES } from "./types";

export type TwiinTutoProps = {
  readonly dataFile: string; // ex. "tutos/veille-loreal/props.json" (écrit par tuto/build_tuto.py)
  readonly data?: TutoData;
};

// Les données du tuto sont lues dans public/ ; la durée de la vidéo en découle.
export const calculateTutoMetadata: CalculateMetadataFunction<TwiinTutoProps> = async ({ props }) => {
  const data: TutoData = await fetch(staticFile(props.dataFile)).then((r) => r.json());
  const scenes = data.introFrames + data.outroFrames + data.scenes.reduce((n, s) => n + s.durationInFrames, 0);
  const transitions = (data.scenes.length + 1) * TRANSITION_FRAMES;
  return { durationInFrames: scenes - transitions, props: { ...props, data } };
};

// Vidéo générée à partir d'un modèle unique : intro, une scène par étape du rejeu de Holo, conclusion.
export const TwiinTuto: React.FC<TwiinTutoProps> = ({ data }) => {
  const { fps } = useVideoConfig();
  if (!data) return null;
  const timing = linearTiming({ durationInFrames: TRANSITION_FRAMES });

  return (
    <TransitionSeries>
      <TransitionSeries.Sequence name="Intro" durationInFrames={data.introFrames} premountFor={fps}>
        <TitleScene eyebrow="TWIIN · TUTO" title={data.title} text={data.intro} audio={data.introAudio} />
      </TransitionSeries.Sequence>
      {data.scenes.flatMap((scene, i) => [
        <TransitionSeries.Transition key={`t${i}`} presentation={fade()} timing={timing} />,
        <TransitionSeries.Sequence key={`s${i}`} name={`Étape ${i + 1}`} durationInFrames={scene.durationInFrames} premountFor={fps}>
          <StepScene scene={scene} index={i + 1} total={data.scenes.length} />
        </TransitionSeries.Sequence>,
      ])}
      <TransitionSeries.Transition presentation={fade()} timing={timing} />
      <TransitionSeries.Sequence name="Conclusion" durationInFrames={data.outroFrames} premountFor={fps}>
        <TitleScene eyebrow="TWIIN" title="C'est fait !" text={data.outro} audio={data.outroAudio} />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  );
};
