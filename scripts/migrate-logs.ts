#!/usr/bin/env npx tsx
// migrate-logs.ts: one-time (and idempotent) migration that collapses the
// legacy `learning/logs/activity.jsonl` + `learning/logs/system.jsonl` split
// into the unified `learning/logs/raw.jsonl` introduced by PR-B of the
// giggly-riding-comet plan.
//
// Behaviour:
//   - Reads activity.jsonl and system.jsonl if either exists.
//   - Merges every line into raw.jsonl in chronological order by `ts`.
//   - Lines without a parseable `ts` field sort to the end, preserving
//     the order they were read in.
//   - Existing raw.jsonl content is preserved: legacy lines are appended
//     and the whole file is then re-sorted, so re-running the script is
//     a no-op when nothing has changed.
//   - After a successful merge, the legacy files are moved (not copied)
//     to `learning/logs/archive/<basename>.<YYYY-MM-DD>.jsonl` so a fresh
//     run never re-imports them.
//   - All operations are local; learning/logs/ is gitignored.
//
// RETENTION POLICY (Issue #77): option 1, keep all archive shards
// forever. learning/logs/archive/ grows unbounded by design; storage
// is cheap and the shards are gzipped. Any future TTL policy would
// need a shard-consumed ledger (not currently tracked).
//
// Usage:
//   npx tsx scripts/migrate-logs.ts                # migrate the real repo
//   AWS_SIMULATOR_LOGS_DIR=/tmp/foo npx tsx ...    # tests stub the dir
//
// Exit code is always 0 unless the script throws on a filesystem error;
// missing legacy files are treated as "nothing to migrate".

import fs from 'node:fs';
import path from 'node:path';

interface LogLine {
  raw: string;
  ts: number; // ms since epoch; Number.POSITIVE_INFINITY if unparseable
}

const ROOT: string = path.resolve(__dirname, '..');
const LOGS_DIR: string = process.env.AWS_SIMULATOR_LOGS_DIR ?? path.join(ROOT, 'learning', 'logs');
const ACTIVITY_FILE: string = path.join(LOGS_DIR, 'activity.jsonl');
const SYSTEM_FILE: string = path.join(LOGS_DIR, 'system.jsonl');
const RAW_FILE: string = path.join(LOGS_DIR, 'raw.jsonl');
const ARCHIVE_DIR: string = path.join(LOGS_DIR, 'archive');

function readLines(filePath: string): LogLine[] {
  if (!fs.existsSync(filePath)) return [];
  const content: string = fs.readFileSync(filePath, 'utf8');
  if (!content.trim()) return [];
  return content.split('\n').filter((l: string) => l.length > 0).map((raw: string) => {
    let ts: number = Number.POSITIVE_INFINITY;
    try {
      const parsed: { ts?: string } = JSON.parse(raw);
      if (parsed.ts) {
        const ms: number = new Date(parsed.ts).getTime();
        if (!Number.isNaN(ms)) ts = ms;
      }
    } catch {
      // Unparseable line: keep it but sort to the end so we don't lose it.
    }
    return { raw, ts };
  });
}

function archive(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  const base: string = path.basename(filePath, '.jsonl');
  const date: string = new Date().toISOString().slice(0, 10);
  let target: string = path.join(ARCHIVE_DIR, `${base}.${date}.jsonl`);
  // If a same-day archive already exists (rare: re-running on the same day
  // after partial run), append a counter so we never clobber prior archives.
  let counter: number = 1;
  while (fs.existsSync(target)) {
    target = path.join(ARCHIVE_DIR, `${base}.${date}.${counter}.jsonl`);
    counter += 1;
  }
  fs.renameSync(filePath, target);
}

interface MigrationResult {
  totalLines: number;
  fromActivity: number;
  fromSystem: number;
  fromRaw: number;
  archived: string[];
  rawLogPath: string;
}

function migrate(): MigrationResult {
  fs.mkdirSync(LOGS_DIR, { recursive: true });

  const activityLines: LogLine[] = readLines(ACTIVITY_FILE);
  const systemLines: LogLine[] = readLines(SYSTEM_FILE);
  const rawLines: LogLine[] = readLines(RAW_FILE);

  if (activityLines.length === 0 && systemLines.length === 0) {
    // Nothing legacy to migrate. raw.jsonl (if any) is already the source
    // of truth; leave it alone so the script is a true no-op.
    return {
      totalLines: rawLines.length,
      fromActivity: 0,
      fromSystem: 0,
      fromRaw: rawLines.length,
      archived: [],
      rawLogPath: RAW_FILE
    };
  }

  const merged: LogLine[] = [...rawLines, ...activityLines, ...systemLines];
  // Stable sort by ts; ties keep input order. Lines without a ts go last.
  merged.sort((a: LogLine, b: LogLine) => a.ts - b.ts);

  // Deduplicate exact-string raw lines so re-running the script is idempotent
  // even if a previous partial run already wrote some lines into raw.jsonl.
  const seen: Set<string> = new Set();
  const deduped: LogLine[] = [];
  for (const line of merged) {
    if (seen.has(line.raw)) continue;
    seen.add(line.raw);
    deduped.push(line);
  }

  fs.writeFileSync(RAW_FILE, deduped.map((l: LogLine) => l.raw).join('\n') + '\n', 'utf8');

  const archived: string[] = [];
  if (fs.existsSync(ACTIVITY_FILE)) {
    archive(ACTIVITY_FILE);
    archived.push(ACTIVITY_FILE);
  }
  if (fs.existsSync(SYSTEM_FILE)) {
    archive(SYSTEM_FILE);
    archived.push(SYSTEM_FILE);
  }

  return {
    totalLines: deduped.length,
    fromActivity: activityLines.length,
    fromSystem: systemLines.length,
    fromRaw: rawLines.length,
    archived,
    rawLogPath: RAW_FILE
  };
}

function main(): void {
  const result: MigrationResult = migrate();
  if (result.fromActivity === 0 && result.fromSystem === 0) {
    process.stdout.write(`migrate-logs: nothing to migrate (raw.jsonl has ${result.fromRaw} lines)\n`);
    return;
  }
  process.stdout.write(
    `migrate-logs: merged ${result.fromActivity} activity + ${result.fromSystem} system + ${result.fromRaw} raw = ${result.totalLines} lines into ${path.relative(ROOT, result.rawLogPath)}\n`
  );
  for (const a of result.archived) {
    process.stdout.write(`migrate-logs: archived ${path.relative(ROOT, a)}\n`);
  }
}

if (require.main === module) {
  main();
}

export { migrate };
export type { MigrationResult };
