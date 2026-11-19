import { Composition } from "remotion";
import { calculateTutoMetadata, TwiinTuto } from "./tuto/TwiinTuto";
import { calculatePitchMetadata, TwiinPitch } from "./pitch/Pitch";

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
