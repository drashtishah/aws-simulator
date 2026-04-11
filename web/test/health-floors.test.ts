import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scoreAllBuckets } from '../../scripts/code-health';
import { BUCKETS } from '../../scripts/lib/classify';
'use strict';

/**
 * health-floors.test.ts
 *
 * Asserts the per-bucket file-count floor invariant: floors can only go UP
 * unless --rebase-floors is passed. Going below the floor zeros the bucket.
 */



function makeDiscovery(byBucket: Record<string, string[]>) {
  const full: Record<string, string[]> = Object.fromEntries(BUCKETS.map((b: string) => [b, []]));
  for (const [k, v] of Object.entries(byBucket)) full[k] = v;
  const classified = Object.values(full).reduce((s, arr) => s + arr.length, 0);
  return {
    byBucket: full,
    tracked: classified,
    classified,
    excluded: 0,
    ignored: [],
    unclassifiedErrors: [],
  };
}

function makeCfg(floors: Record<string, number>) {
  const bw: Record<string, number> = {};
  for (const b of BUCKETS) bw[b] = 1 / BUCKETS.length;
  return { bucketWeights: bw, floors, healthignore: [] };
}

describe('floor monotonicity', () => {
  it('a bucket with files = floor scores normally', () => {
    const d = makeDiscovery({ code: ['web/lib/a.ts', 'web/lib/b.ts'] });
    const cfg = makeCfg({ code: 2 });
    const { report, violations } = scoreAllBuckets(d, cfg);
    assert.equal(violations.filter((v: any) => v.invariant === 'bucket_floor').length, 0);
    assert.ok(report.scores.code.score > 0);
  });

  it('dropping below floor subtracts a 10-point advisory penalty and records a violation', () => {
    const d = makeDiscovery({ code: ['web/lib/a.ts'] });
    const cfg = makeCfg({ code: 5 });
    // Baseline: same discovery but with floor at 1 (no violation), to capture
    // the natural pre-violation score.
    const baseline = scoreAllBuckets(d, makeCfg({ code: 1 }));
    const preScore = baseline.report.scores.code.score;

    const { report, violations, floors } = scoreAllBuckets(d, cfg);
    const v = violations.find((x: any) => x.invariant === 'bucket_floor' && x.bucket === 'code');
    assert.ok(v, 'expected floor violation for code bucket');
    // Advisory penalty: pre - 10 (clamped to >= 0), NOT hard-zero.
    const expected = Math.max(0, Math.round((preScore - 10) * 1000) / 1000);
    assert.equal(report.scores.code.score, expected);
    // The reason field carries the violation detail so the operator sees it.
    assert.ok(
      report.scores.code.reason && report.scores.code.reason.includes('bucket code dropped from floor'),
      `expected violation detail in reason, got: ${report.scores.code.reason}`,
    );
    // Floor must NOT lower.
    assert.equal(floors.code, 5);
  });

  it('caps bucket_floor penalty at -10 even on consecutive floor drops in one run', () => {
    // Two buckets dropping below floor in the same scoring pass: each bucket
    // is penalized at most once. The cap is per-bucket-per-run, not global.
    const d = makeDiscovery({
      code: ['web/lib/a.ts'],
      test: ['web/test/a.test.ts'],
    });
    const cfg = makeCfg({ code: 5, test: 50 });
    const baseline = scoreAllBuckets(d, makeCfg({ code: 1, test: 1 }));
    const preCode = baseline.report.scores.code.score;
    const preTest = baseline.report.scores.test.score;

    const { report, violations } = scoreAllBuckets(d, cfg);
    const codeViolations = violations.filter(
      (x: any) => x.invariant === 'bucket_floor' && x.bucket === 'code',
    );
    const testViolations = violations.filter(
      (x: any) => x.invariant === 'bucket_floor' && x.bucket === 'test',
    );
    assert.equal(codeViolations.length, 1, 'one violation per bucket');
    assert.equal(testViolations.length, 1);
    // Each bucket: penalty of exactly 10, not 20.
    const expectedCode = Math.max(0, Math.round((preCode - 10) * 1000) / 1000);
    const expectedTest = Math.max(0, Math.round((preTest - 10) * 1000) / 1000);
    assert.equal(report.scores.code.score, expectedCode);
    assert.equal(report.scores.test.score, expectedTest);
  });

  it('floor rises automatically when count exceeds it', () => {
    const d = makeDiscovery({ skill: Array.from({ length: 10 }, (_, i) => `.claude/skills/s${i}/SKILL.md`) });
    const cfg = makeCfg({ skill: 5 });
    const { floors } = scoreAllBuckets(d, cfg);
    assert.equal(floors.skill, 10);
  });

  it('floor only lowers with --rebase-floors', () => {
    const d = makeDiscovery({ test: ['web/test/a.test.ts'] });
    const cfg = makeCfg({ test: 50 });
    // Without rebase: violation, floor stays at 50.
    const r1 = scoreAllBuckets(d, cfg);
    assert.equal(r1.floors.test, 50);
    // With rebase: floor snaps to 1.
    const r2 = scoreAllBuckets(d, cfg, { rebaseFloors: true });
    assert.equal(r2.floors.test, 1);
  });
});
