import { useEffect, useRef, useState } from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  staticFile,
  delayRender,
  continueRender,
} from "remotion";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

interface TerminalProps {
  castFile: string;
  cols: number;
  rows: number;
  speed?: number;
}

interface CastEvent {
  absoluteTime: number;
  data: string;
}

export const Terminal: React.FC<TerminalProps> = ({
  castFile,
  cols,
  rows,
  speed = 1,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const eventsRef = useRef<CastEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [handle] = useState(() => delayRender("Loading cast file"));
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Load cast data and create terminal ONCE on mount
  useEffect(() => {
    if (!containerRef.current) return;

    fetch(staticFile(castFile))
      .then((r) => r.text())
      .then((text) => {
        const lines = text.trim().split("\n");
        const header = JSON.parse(lines[0]);
        const isV3 = header.version === 3;

        // Parse all events with absolute timestamps
        const events: CastEvent[] = [];
        let absTime = 0;
        for (let i = 1; i < lines.length; i++) {
          const ev = JSON.parse(lines[i]);
          if (isV3) {
            absTime += ev[0];
          } else {
            absTime = ev[0];
          }
          if (ev[1] === "o") {
            events.push({ absoluteTime: absTime, data: ev[2] });
          }
        }
        eventsRef.current = events;

        // Create xterm instance
        const termCols = header.term?.cols ?? header.width ?? cols;
        const termRows = header.term?.rows ?? header.height ?? rows;

        const term = new XTerm({
          cols: termCols,
          rows: termRows,
          fontSize: 20,
          fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
          theme: {
            background: "#1e1e1e",
            foreground: "#d4d4d4",
            cursor: "#d4d4d4",
            black: "#000000",
            red: "#cd3131",
            green: "#0dbc79",
            yellow: "#e5e510",
            blue: "#2472c8",
            magenta: "#bc3fbc",
            cyan: "#11a8cd",
            white: "#e5e5e5",
            brightBlack: "#666666",
            brightRed: "#f14c4c",
            brightGreen: "#23d18b",
            brightYellow: "#f5f543",
            brightBlue: "#3b8eea",
            brightMagenta: "#d670d6",
            brightCyan: "#29b8db",
            brightWhite: "#e5e5e5",
          },
          allowTransparency: false,
          cursorBlink: false,
          disableStdin: true,
        });

        term.open(containerRef.current!);
        termRef.current = term;
        setLoaded(true);
        continueRender(handle);
      });
  }, [castFile, cols, rows, handle]);

  // On every frame change, reset terminal and replay events up to current time
  useEffect(() => {
    if (!loaded || !termRef.current) return;

    const currentTime = (frame / fps) * speed;
    const term = termRef.current;
    const events = eventsRef.current;

    // Reset terminal state
    term.reset();

    // Replay all output events up to current time
    for (const ev of events) {
      if (ev.absoluteTime > currentTime) break;
      term.write(ev.data);
    }
  }, [frame, fps, speed, loaded]);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#1e1e1e",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "10px 20px",
      }}
    >
      <div ref={containerRef} />
    </AbsoluteFill>
  );
};
