#!/usr/bin/env npx tsx
/**
 * Stop hook: refuses to let the session end until at least one note has
 * been recorded for the current session via tsx scripts/note.ts (or
 * --kind none --reason "..." to skip explicitly).
 *
 * Reads its session_id from the JSON payload Claude Code passes on stdin
 * (see .claude/hooks/log-hook.ts:166-180 for the canonical example of the
 * hook protocol). Time-window matching: find the most recent SessionStart
 * event in raw.jsonl with the same session_id, capture its ts, then scan
 * notes.jsonl for any entry with ts >= start_ts. If at least one match,
 * exit 0. Otherwise print a reminder to stderr and exit 2 (the canonical
 * Claude Code "block" exit code, see .claude/hooks/guard-write.ts:122).
 *
 * Permissive on edge cases (missing files, missing session_id, no
 * SessionStart baseline) so the hook never blocks unrelated Stop events.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

interface HookInput {
  session_id?: string;
  hook_event_name?: string;
}

const REMINDER = [
  '',
  'This session has not recorded any notes yet.',
  'Before stopping, run one of:',
  '  tsx scripts/note.ts --kind finding --topic <slug> --body "<one to three sentences>"',
  '  tsx scripts/note.ts --kind negative_result --topic <slug> --body "tried X, did not work because Y"',
  '  tsx scripts/note.ts --kind workaround --topic <slug> --body "<what you did>"',
  '  tsx scripts/note.ts --kind decision --topic <slug> --body "<what was decided and why>"',
  '  tsx scripts/note.ts --kind none --reason "<one-line reason, used when nothing is worth recording>"',
  '',
  'See CLAUDE.md > Logging for the schema and intent.',
  '',
].join('\n');

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function findSessionStartTs(rawPath: string, sessionId: string): string | null {
  if (!existsSync(rawPath)) return null;
  const lines = readFileSync(rawPath, 'utf8').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.event === 'SessionStart' && obj.session_id === sessionId) {
        return typeof obj.ts === 'string' ? obj.ts : null;
      }
    } catch {
      // skip malformed lines
    }
  }
  return null;
}

function hasNoteSince(notesPath: string, startTs: string): boolean {
  if (!existsSync(notesPath)) return false;
  const lines = readFileSync(notesPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (typeof obj.ts === 'string' && obj.ts >= startTs) return true;
    } catch {
      // skip malformed lines
    }
  }
  return false;
}

function main(): void {
  const raw = readStdin();
  let input: HookInput = {};
  try {
    input = JSON.parse(raw);
  } catch {
    // permissive: malformed stdin should not block stop
  }

  const sessionId = input.session_id;
  if (!sessionId) {
    process.exit(0);
  }

  const cwd = process.cwd();
  const rawPath = path.join(cwd, 'learning', 'logs', 'raw.jsonl');
  const notesPath = path.join(cwd, 'learning', 'logs', 'notes.jsonl');

  const startTs = findSessionStartTs(rawPath, sessionId);
  if (!startTs) {
    // permissive: no baseline to compare against
    process.exit(0);
  }

  if (hasNoteSince(notesPath, startTs)) {
    process.exit(0);
  }

  process.stderr.write(REMINDER);
  process.exit(2);
}

main();

export { findSessionStartTs, hasNoteSince };
