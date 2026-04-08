#!/usr/bin/env tsx
/**
 * scripts/note.ts
 *
 * Small CLI agents call to record findings, negative results, workarounds,
 * and decisions to learning/logs/notes.jsonl. The Stop hook (Commit 8 of
 * the fluffy-hugging-wilkes plan) blocks session end until at least one
 * note has been recorded for the current session. The kind=none escape
 * hatch is the explicit "nothing worth recording" path.
 *
 * Schema: {ts, kind, topic, body}.
 * Kinds: finding, negative_result, workaround, decision, none.
 * Topic: slug ^[a-z0-9][a-z0-9-]{0,63}$ (or "none" for kind=none).
 * Body: freeform text, no length cap (Issue #119).
 *
 * Integrity signal: agents MUST record a note whenever they feel tempted
 * to cheat, take a shortcut, weaken a test, relax an assertion, downgrade
 * a FAIL to a WARN, skip a test, broaden a regex past precision, or add
 * to a skip list to dodge a real signal. Even if the shortcut is
 * ultimately justified, the note creates the paper trail. Use
 * kind=workaround or kind=decision. Body: what was tempting, why you
 * resisted or gave in, what you did instead. This matters MORE for test
 * code than any other category — tests are the safety net.
 *
 * Usage:
 *   tsx scripts/note.ts --kind finding --topic <slug> --body "<one to three sentences>"
 *   tsx scripts/note.ts --kind negative_result --topic <slug> --body "tried X, did not work because Y"
 *   tsx scripts/note.ts --kind workaround --topic <slug> --body "<what you did>"
 *   tsx scripts/note.ts --kind decision --topic <slug> --body "<what was decided and why>"
 *   tsx scripts/note.ts --kind none --reason "<one-line reason>"
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const KINDS = new Set(['finding', 'negative_result', 'workaround', 'decision', 'none']);
const TOPIC_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

interface ParsedArgs {
  kind?: string;
  topic?: string;
  body?: string;
  reason?: string;
}

interface NoteEntry {
  ts: string;
  kind: string;
  topic: string;
  body: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!flag || !flag.startsWith('--')) continue;
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`flag ${flag} requires a value`);
    }
    const key = flag.slice(2);
    (out as Record<string, string>)[key] = value;
    i++;
  }
  return out;
}

function validate(args: ParsedArgs): NoteEntry {
  if (!args.kind || !KINDS.has(args.kind)) {
    throw new Error(`--kind must be one of: ${[...KINDS].join(', ')}`);
  }
  const ts = new Date().toISOString();
  if (args.kind === 'none') {
    if (!args.reason) {
      throw new Error('--kind none requires --reason "<one-line reason>"');
    }
    return {
      ts,
      kind: 'none',
      topic: 'none',
      body: `none: ${args.reason}`,
    };
  }
  if (!args.topic || !TOPIC_RE.test(args.topic)) {
    throw new Error('--topic must be a slug matching ^[a-z0-9][a-z0-9-]{0,63}$');
  }
  if (!args.body) {
    throw new Error('--body is required');
  }
  return {
    ts,
    kind: args.kind,
    topic: args.topic,
    body: args.body,
  };
}

function appendEntry(entry: NoteEntry, notesPath: string): void {
  mkdirSync(path.dirname(notesPath), { recursive: true });
  appendFileSync(notesPath, JSON.stringify(entry) + '\n');
}

function main(): void {
  try {
    const args = parseArgs(process.argv.slice(2));
    const entry = validate(args);
    const notesPath = path.resolve(process.cwd(), 'learning', 'logs', 'notes.jsonl');
    appendEntry(entry, notesPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`note: ${message}\n`);
    process.exit(2);
  }
}

main();

export { parseArgs, validate, appendEntry, KINDS, TOPIC_RE };
