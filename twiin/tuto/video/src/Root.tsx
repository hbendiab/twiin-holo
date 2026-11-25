import { Composition } from "remotion";
import { calculateTutoMetadata, TwiinTuto } from "./tuto/TwiinTuto";
import { calculatePitchMetadata, TwiinPitch } from "./pitch/Pitch";
import { dureeDemo, TwiinDemo } from "./demo/Demo";
import { dureeFin, TwiinFin } from "./demo/Fin";
import { staticFile } from "remotion";
import { dureeFonctions, TwiinFonctions } from "./film/Fonctions";
import { dureeStack, TwiinStack } from "./film/Stack";
import { DUREE_PUB, TwiinPub } from "./pub/Pub";
import { dureePub2, TwiinPub2 } from "./pub/Pub2";
import { DemoFacture, dureeDemoFacture } from "./demo2/DemoFacture";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="TwiinTuto"
        component={TwiinTuto}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{ dataFile: "tutos/veille-loreal/props.json" }}
        calculateMetadata={calculateTutoMetadata}
      />
      {/* Vidéo démo : tests filmés + voix des jumeaux (public/demo) */}
      <Composition id="TwiinDemo" component={TwiinDemo} durationInFrames={300} fps={30} width={1920} height={1080} defaultProps={{ voix: [] }}
        calculateMetadata={async () => { const voix = await fetch(staticFile("demo/voix.json")).then((r) => r.json()); return { durationInFrames: dureeDemo(voix), props: { voix } }; }} />
      <Composition id="TwiinFin" component={TwiinFin} durationInFrames={300} fps={30} width={1920} height={1080} defaultProps={{ voix: [] }}
        calculateMetadata={async () => { const voix = await fetch(staticFile("demo/fin.json")).then((r) => r.json()); return { durationInFrames: dureeFin(voix), props: { voix } }; }} />
      {/* Pub (vidéo démo du hackathon) : motion design, une voix off (public/pub/voix.json), musique */}
      <Composition id="TwiinPub" component={TwiinPub} durationInFrames={DUREE_PUB} fps={30} width={1920} height={1080} defaultProps={{ voix: [] }}
        calculateMetadata={async () => { const voix = await fetch(staticFile("pub/voix.json")).then((r) => r.json()); return { props: { voix } }; }} />
      {/* Pub v2 : DA du SaaS, tagline unique, texte = voix off (public/pub/v2/voix.json) */}
      {["a", "b", "c"].map((m) => <Composition key={m} id={`TwiinPub2-${m}`} component={TwiinPub2} durationInFrames={300} fps={30} width={1920} height={1080}
        defaultProps={{ voix: [], final: { f: "pub/v2/final.mp3", s: 2 }, musique: `pub/musique-${m}.mp3` }}
        calculateMetadata={async ({ props }) => { const j = await fetch(staticFile("pub/v2/voix.json")).then((r) => r.json());
          return { durationInFrames: dureePub2(j.voix, j.final), props: { ...props, voix: j.voix, final: j.final } }; }} />)}
      {/* Démo réelle accélérée : facture saisie et transférée, automatisée, vidéo de formation (public/demo2/plan.json) */}
      <Composition id="DemoFacture" component={DemoFacture} durationInFrames={300} fps={30} width={1920} height={1080} defaultProps={{ plan: [] }}
        calculateMetadata={async () => { const plan = await fetch(staticFile("demo2/plan.json")).then((r) => r.json()); return { durationInFrames: dureeDemoFacture(plan), props: { plan } }; }} />
      {/* Films : fonctionnalités (public/film/f.json) et stack technique (public/film/s.json) */}
      <Composition id="TwiinFonctions" component={TwiinFonctions} durationInFrames={300} fps={30} width={1920} height={1080} defaultProps={{ voix: [] }}
        calculateMetadata={async () => { const voix = await fetch(staticFile("film/f.json")).then((r) => r.json()); return { durationInFrames: dureeFonctions(voix), props: { voix } }; }} />
      <Composition id="TwiinStack" component={TwiinStack} durationInFrames={300} fps={30} width={1920} height={1080} defaultProps={{ voix: [] }}
        calculateMetadata={async () => { const voix = await fetch(staticFile("film/s.json")).then((r) => r.json()); return { durationInFrames: dureeStack(voix), props: { voix } }; }} />
      {/* Pitch du hackathon (tuto/build_pitch.py) et ses images fixes : parcours, architecture, avancement, roadmap */}
      <Composition id="TwiinPitch" component={TwiinPitch} durationInFrames={300} fps={30} width={1920} height={1080}
        defaultProps={{}} calculateMetadata={calculatePitchMetadata} />
      {["parcours", "tester", "resultats", "archi", "avancement", "roadmap"].map((id) => (
        <Composition key={id} id={`Pitch-${id}`} component={TwiinPitch} durationInFrames={1} fps={30} width={1920} height={1080}
          defaultProps={{ only: id }} calculateMetadata={calculatePitchMetadata} />
      ))}
    </>
  );
};
