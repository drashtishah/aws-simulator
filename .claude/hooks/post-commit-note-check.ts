#!/usr/bin/env npx tsx
/**
 * .claude/hooks/post-commit-note-check.ts
 *
 * PostToolUse hook on Bash. After every Bash tool use, if the command was an
 * actual `git commit` invocation (not a substring inside another command),
 * check whether learning/logs/notes.jsonl has any entry with ts >= the
 * latest commit's committer timestamp. If not, emit a reminder to stdout
 * prompting the agent to write a note via scripts/note.ts.
 *
 * The reminder lands in the agent's tool-result context (stdout, exit 0)
 * rather than as a hard block (stderr, exit 2) so it nudges without
 * preventing forward progress.
 *
 * Permissive on edge cases: malformed stdin, missing notes.jsonl, missing
 * git commit history, missing session_id all exit 0 silently. The hook is
 * a nudge, not a gate.
 *
 * Rule: references/architecture/core-workflow.md §6b. Issue #146.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

interface HookInput {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  session_id?: string;
}

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function isCommitInvocation(cmd: string): boolean {
  // Split on shell separators and look for any segment that starts with a
  // git commit invocation. Avoids matching substrings inside body strings
  // of other commands (e.g. `gh issue create --body "fix git commit hook"`).
  const segments = cmd.split(/&&|\|\||;|\|/);
  return segments.some((s) => /^\s*git\s+commit\b/.test(s));
}

function latestCommit(cwd: string): { sha: string; epochMs: number } | null {
  // %ct is the committer date in unix epoch seconds, timezone-independent.
  // Avoids the cross-timezone string-comparison bug %cI causes when notes
  // use UTC ISO and git uses local-tz ISO.
  const r = spawnSync('git', ['log', '-1', '--pretty=%H %ct'], { cwd, encoding: 'utf8' });
  if (r.status !== 0) return null;
  const out = (r.stdout || '').trim();
  const m = out.match(/^([0-9a-f]+)\s+(\d+)$/);
  if (!m) return null;
  return { sha: m[1]!, epochMs: parseInt(m[2]!, 10) * 1000 };
}

function hasNoteSince(notesPath: string, sinceEpochMs: number): boolean {
  if (!existsSync(notesPath)) return false;
  const lines = readFileSync(notesPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (typeof obj.ts === 'string') {
        const noteMs = Date.parse(obj.ts);
        // git's %ct truncates to seconds; allow up to 1s of slop so a note
        // written in the same second as the commit still counts.
        if (!Number.isNaN(noteMs) && noteMs + 1000 >= sinceEpochMs) return true;
      }
    } catch {
      // skip malformed lines
    }
  }
  return false;
}

function main(): void {
  const raw = readStdin();
  let data: HookInput = {};
  try {
    data = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  if (data.tool_name !== 'Bash') process.exit(0);

  const cmd = (data.tool_input && (data.tool_input.command as string)) || '';
  if (!isCommitInvocation(cmd)) process.exit(0);

  const cwd = process.cwd();
  const commit = latestCommit(cwd);
  if (!commit) process.exit(0);

  const notesPath = path.join(cwd, 'learning', 'logs', 'notes.jsonl');
  if (hasNoteSince(notesPath, commit.epochMs)) process.exit(0);

  const shortSha = commit.sha.slice(0, 7);
  process.stdout.write(
    [
      '',
      '[Note check] commit ' + shortSha + ' has no corresponding note in learning/logs/notes.jsonl.',
      'Per core-workflow.md §6b, every commit gets one note. Run:',
      '',
      '  tsx scripts/note.ts --kind <finding|negative_result|workaround|decision|none> \\\\',
      '    --topic <slug> --body "<one or two sentences about ' + shortSha + '>"',
      '',
      'This is a nudge, not a hard block. Continue working if a note is not warranted.',
      '',
    ].join('\n'),
  );
  process.exit(0);
}

main();

export { isCommitInvocation, hasNoteSince, latestCommit };
