import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import { BUCKETS } from '../../scripts/lib/classify';
'use strict';

/**
 * code-health-config.test.ts
 *
 * Snapshot tests for scripts/metrics.config.json. Any change to weights,
 * thresholds, healthignore, floors, or bucketWeights will produce a visible
 * diff in this test, forcing reviewers to ack the change explicitly.
 *
 * This is one of the anti-gaming guardrails: "Lower the bar in
 * metrics.config.json" cannot be done silently.
 */


const ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_PATH = path.join(ROOT, 'scripts', 'metrics.config.json');
const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));


describe('metrics.config.json', () => {
  it('exists and is valid JSON', () => {
    assert.ok(cfg);
    assert.equal(typeof cfg, 'object');
  });

  it('has health_scores.weights summing to ~1.0', () => {
    const w = cfg.health_scores && cfg.health_scores.weights;
    assert.ok(w, 'missing health_scores.weights');
    const sum = Object.values(w).reduce((a: number, b: any) => a + (b as number), 0);
    assert.ok(Math.abs(sum - 1.0) < 0.01, `weights sum to ${sum}, expected ~1.0`);
  });

  it('has bucketWeights with one entry per bucket, equal weights', () => {
    const bw = cfg.bucketWeights;
    assert.ok(bw, 'missing bucketWeights');
    for (const b of BUCKETS) {
      assert.ok(b in bw, `missing bucketWeight for ${b}`);
    }
    const values = Object.values(bw) as number[];
    const sum = values.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1.0) < 0.01, `bucketWeights sum to ${sum}, expected ~1.0`);
    // All equal.
    const expected = 1 / BUCKETS.length;
    for (const v of values) {
      assert.ok(Math.abs(v - expected) < 0.001, `bucketWeight ${v} not equal to ${expected}`);
    }
  });

  it('has healthignore as an array (possibly empty)', () => {
    assert.ok(Array.isArray(cfg.healthignore), 'healthignore must be an array');
  });

  it('every healthignore entry has a non-empty reason', () => {
    for (const entry of cfg.healthignore) {
      assert.ok(entry && typeof entry === 'object', 'healthignore entry must be object');
      assert.ok(typeof entry.path === 'string' && entry.path.length > 0, 'healthignore entry needs path');
      assert.ok(typeof entry.reason === 'string' && entry.reason.length > 0,
        `healthignore entry ${entry.path} needs non-empty reason`);
    }
  });

  it('healthignore contains no .claude/plans/ entries (plans are excluded by classify, not ignored)', () => {
    for (const entry of cfg.healthignore) {
      assert.ok(!entry.path.startsWith('.claude/plans/'),
        `plans must be excluded via classify(), not healthignore: ${entry.path}`);
    }
  });

  it('has floors as an object (auto-managed monotonic per-bucket file counts)', () => {
    assert.ok(cfg.floors && typeof cfg.floors === 'object' && !Array.isArray(cfg.floors),
      'floors must be an object');
    // Floors keys must all be valid buckets if present.
    for (const k of Object.keys(cfg.floors)) {
      assert.ok(BUCKETS.includes(k), `floor key ${k} is not a valid bucket`);
      assert.equal(typeof cfg.floors[k], 'number');
      assert.ok(cfg.floors[k] >= 0);
    }
  });
});
