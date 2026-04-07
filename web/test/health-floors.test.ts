'use strict';

/**
 * health-floors.test.ts
 *
 * Asserts the per-bucket file-count floor invariant: floors can only go UP
 * unless --rebase-floors is passed. Going below the floor zeros the bucket.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  scoreAllBuckets,
} = require('../../scripts/code-health');
const { BUCKETS } = require('../../scripts/lib/classify');

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

  it('dropping below floor zeros the bucket and records a violation', () => {
    const d = makeDiscovery({ code: ['web/lib/a.ts'] });
    const cfg = makeCfg({ code: 5 });
    const { report, violations, floors } = scoreAllBuckets(d, cfg);
    const v = violations.find((x: any) => x.invariant === 'bucket_floor' && x.bucket === 'code');
    assert.ok(v, 'expected floor violation for code bucket');
    assert.equal(report.scores.code.score, 0);
    // Floor must NOT lower.
    assert.equal(floors.code, 5);
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
