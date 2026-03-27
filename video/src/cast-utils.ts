import fs from "fs";

export interface CastMeta {
  cols: number;
  rows: number;
  totalDuration: number;
}

export function parseCastMeta(castPath: string): CastMeta {
  const content = fs.readFileSync(castPath, "utf-8");
  const lines = content.trim().split("\n");
  const header = JSON.parse(lines[0]);

  // v3 format: term.cols/term.rows; v2 format: width/height
  const cols = header.term?.cols ?? header.width ?? 80;
  const rows = header.term?.rows ?? header.height ?? 24;

  // v3 uses relative timestamps, v2 uses absolute
  // Sum all event timestamps to get total duration
  let totalDuration = 0;
  for (let i = 1; i < lines.length; i++) {
    const event = JSON.parse(lines[i]);
    totalDuration += event[0];
  }

  return { cols, rows, totalDuration };
}
