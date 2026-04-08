#!/usr/bin/env npx tsx
/**
 * scripts/health-regression-check.ts
 *
 * Compares the LAST entry of two newline-delimited JSON health-scores
 * files (the same shape as learning/logs/health-scores.jsonl) and exits
 * non-zero if any bucket score on the PR head is strictly lower than the
 * same bucket on master. Read-only.
 *
 * This is a regression-only check, NOT a ratchet. It complements the
 * absolute-floor gate already enforced by `npm run health` (which fails
 * when a bucket falls below scripts/metrics.config.json's bucket_floors).
 *
 * Issue #143. Used by .github/workflows/ci.yml to fail PRs that ship
 * test-green AND above-floor but quietly degrade a bucket against master.
 *
 * Usage:
 *   npx tsx scripts/health-regression-check.ts <pr.jsonl> <master.jsonl>
 *
 * Exit codes:
 *   0 = no bucket regressed
 *   1 = at least one bucket regressed (named in stderr with master vs PR scores)
 *   2 = usage error
 */

import { existsSync, readFileSync } from 'node:fs';

interface HealthEntry {
  ts?: string;
  composite?: number;
  buckets?: Record<string, number>;
}

function readLastEntry(filePath: string): HealthEntry {
  if (!existsSync(filePath)) {
    process.stderr.write('health-regression-check: file not found: ' + filePath + '\n');
    process.exit(2);
  }
  const lines = readFileSync(filePath, 'utf8').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim();
    if (!line) continue;
    try {
      return JSON.parse(line) as HealthEntry;
    } catch {
      // skip malformed lines and keep walking backwards
    }
  }
  process.stderr.write('health-regression-check: no parseable entry in ' + filePath + '\n');
  process.exit(2);
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    process.stderr.write(
      'usage: npx tsx scripts/health-regression-check.ts <pr.jsonl> <master.jsonl>\n',
    );
    process.exit(2);
  }

  const prPath = args[0]!;
  const masterPath = args[1]!;

  const prEntry = readLastEntry(prPath);
  const masterEntry = readLastEntry(masterPath);

  const prBuckets = prEntry.buckets || {};
  const masterBuckets = masterEntry.buckets || {};

  const regressions: { bucket: string; master: number; pr: number }[] = [];
  for (const bucket of Object.keys(masterBuckets)) {
    const masterScore = masterBuckets[bucket];
    const prScore = prBuckets[bucket];
    if (typeof masterScore !== 'number' || typeof prScore !== 'number') continue;
    if (prScore < masterScore) {
      regressions.push({ bucket, master: masterScore, pr: prScore });
    }
  }

  if (regressions.length === 0) {
    process.stdout.write('health-regression-check: no bucket regressed\n');
    process.exit(0);
  }

  process.stderr.write('health-regression-check: ' + regressions.length + ' bucket(s) regressed against master:\n');
  for (const r of regressions) {
    process.stderr.write('  ' + r.bucket + ': master=' + r.master + ' pr=' + r.pr + '\n');
  }
  process.exit(1);
}

main();
