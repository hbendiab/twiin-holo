import { Composition } from "remotion";
import { calculateTutoMetadata, TwiinTuto } from "./tuto/TwiinTuto";

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
    </>
  );
};
