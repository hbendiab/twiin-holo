import { fade } from "@remotion/transitions/fade";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import type React from "react";
import { useEffect, useState } from "react";
import { AbsoluteFill, type CalculateMetadataFunction, continueRender, delayRender, staticFile, useVideoConfig } from "remotion";
import { StepScene } from "./StepScene";
import { TitleScene } from "./TitleScene";
import { FONT, type TutoData, TRANSITION_FRAMES } from "./types";

export type TwiinTutoProps = {
  readonly dataFile: string; // ex. "tutos/veille-loreal/props.json" (écrit par tuto/build_tuto.py)
  readonly data?: TutoData;
};

// Les données du tuto sont lues dans public/ ; la durée de la vidéo en découle.
export const calculateTutoMetadata: CalculateMetadataFunction<TwiinTutoProps> = async ({ props }) => {
  const data: TutoData = await fetch(staticFile(props.dataFile)).then((r) => r.json());
  // marque de l'entreprise cliente (réglée dans Twiin, copiée dans public/marque.json) : facultative
  data.marque = await fetch(staticFile("marque.json")).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const scenes = data.introFrames + data.outroFrames + data.scenes.reduce((n, s) => n + s.durationInFrames, 0);
  const transitions = (data.scenes.length + 1) * TRANSITION_FRAMES;
  return { durationInFrames: scenes - transitions, props: { ...props, data } };
};

// Police de la charte de l'entreprise (Google Fonts) : chargée avant le rendu des images
const PoliceMarque: React.FC<{ readonly police: string }> = ({ police }) => {
  const [h] = useState(() => delayRender(`police ${police}`));
  useEffect(() => {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(police).replace(/%20/g, "+")}:wght@400;500;600;700&display=swap`;
    l.onload = () => { Promise.all([document.fonts.load(`600 60px "${police}"`), document.fonts.load(`500 30px "${police}"`)]).finally(() => continueRender(h)); };
    l.onerror = () => continueRender(h);
    document.head.append(l);
  }, [h, police]);
  return null;
};

// Vidéo générée à partir d'un modèle unique : intro, une scène par étape du rejeu de Holo, conclusion.
export const TwiinTuto: React.FC<TwiinTutoProps> = ({ data }) => {
  const { fps } = useVideoConfig();
  if (!data) return null;
  const timing = linearTiming({ durationInFrames: TRANSITION_FRAMES });

  const police = data.marque?.police || null;
  return (
    <AbsoluteFill style={{ fontFamily: police ? `"${police}", ${FONT}` : FONT }}>
    {police ? <PoliceMarque police={police} /> : null}
    <TransitionSeries>
      <TransitionSeries.Sequence name="Intro" durationInFrames={data.introFrames} premountFor={fps}>
        <TitleScene eyebrow={`Tuto · ${data.scenes.length} étapes`} title={data.title} text="" audio={data.introAudio} marque={data.marque} logos={data.logos} />
      </TransitionSeries.Sequence>
      {data.scenes.flatMap((scene, i) => [
        <TransitionSeries.Transition key={`t${i}`} presentation={fade()} timing={timing} />,
        <TransitionSeries.Sequence key={`s${i}`} name={`Étape ${i + 1}`} durationInFrames={scene.durationInFrames} premountFor={fps}>
          <StepScene scene={scene} index={i + 1} total={data.scenes.length} accent={data.marque?.couleur || undefined} />
        </TransitionSeries.Sequence>,
      ])}
      <TransitionSeries.Transition presentation={fade()} timing={timing} />
      <TransitionSeries.Sequence name="Conclusion" durationInFrames={data.outroFrames} premountFor={fps}>
        <TitleScene eyebrow="Terminé" title="C'est fait !" text={data.outro} audio={data.outroAudio} marque={data.marque} />
      </TransitionSeries.Sequence>
    </TransitionSeries>
    </AbsoluteFill>
  );
};
