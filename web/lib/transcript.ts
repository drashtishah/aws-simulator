import fs from 'node:fs';
import path from 'node:path';
import { SESSIONS_DIR } from './paths.js';

export interface TranscriptTurn {
  turn: number;
  player?: string | null;
  narrator?: string | null;
  console?: string | null;
  coaching?: string | null;
  mode?: string;
  service?: string | null;
}

export interface TranscriptEntry {
  turn: number;
  ts: string;
  player: string | null;
  narrator: string | null;
  console: string | null;
  coaching: string | null;
  mode: string;
  service: string | null;
}

let sessionsDir: string = SESSIONS_DIR;

export function appendTurn(simId: string, turn: TranscriptTurn): void {
  const dir = path.join(sessionsDir, simId);
  fs.mkdirSync(dir, { recursive: true });
  const entry: TranscriptEntry = {
    turn: turn.turn,
    ts: new Date().toISOString(),
    player: turn.player ?? null,
    narrator: turn.narrator ?? null,
    console: turn.console ?? null,
    coaching: turn.coaching ?? null,
    mode: turn.mode ?? 'narrator',
    service: turn.service ?? null,
  };
  fs.appendFileSync(path.join(dir, 'transcript.jsonl'), JSON.stringify(entry) + '\n');
}

export function readTranscript(simId: string): TranscriptEntry[] {
  const file = path.join(sessionsDir, simId, 'transcript.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter((line: string) => line.trim())
    .map((line: string) => JSON.parse(line) as TranscriptEntry);
}

export function hasTranscript(simId: string): boolean {
  return fs.existsSync(path.join(sessionsDir, simId, 'transcript.jsonl'));
}

export function _setSessionsDir(dir: string): void {
  sessionsDir = dir;
}
