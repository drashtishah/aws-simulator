import { Composition } from "remotion";
import { Terminal } from "./Terminal";

export interface VideoProps {
  castFile: string;
  cols: number;
  rows: number;
  totalDuration: number;
  speed?: number;
}

const FPS = 30;

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="Terminal"
      component={Terminal}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{
        castFile: "recording.cast",
        cols: 80,
        rows: 24,
        speed: 1,
      }}
      calculateMetadata={({ props }) => {
        const speed = props.speed ?? 1;
        const durationInFrames = Math.ceil(
          (props.totalDuration / speed) * FPS
        );
        return {
          durationInFrames,
          props,
        };
      }}
    />
  );
};
