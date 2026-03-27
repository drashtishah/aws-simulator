import { useCallback, useEffect, useRef } from "react";
import { useCurrentFrame, useVideoConfig, staticFile } from "remotion";
import * as AsciinemaPlayer from "asciinema-player";
import "asciinema-player/dist/bundle/asciinema-player.css";
import styles from "./Terminal.module.css";

interface TerminalProps {
  castFile: string;
  cols: number;
  rows: number;
  speed?: number;
}

export const Terminal: React.FC<TerminalProps> = ({
  castFile,
  cols,
  rows,
  speed = 1,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const setupPlayer = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el || playerRef.current) return;
      containerRef.current = el;

      playerRef.current = AsciinemaPlayer.create(staticFile(castFile), el, {
        cols,
        rows,
        autoPlay: false,
        controls: false,
        terminalFontSize: "16px",
        fit: "both",
        theme: "monokai",
      });
    },
    [castFile, cols, rows]
  );

  useEffect(() => {
    if (!playerRef.current) return;
    const currentTime = (frame / fps) * speed;
    playerRef.current.seek(currentTime);
  }, [frame, fps, speed]);

  return <div className={styles.playerWrap} ref={setupPlayer} />;
};
