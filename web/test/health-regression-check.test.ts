import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * Tests for scripts/health-regression-check.ts.
 *
 * The script reads two newline-delimited JSON files containing
 * health-scores entries (the same shape as learning/logs/health-scores.jsonl)
 * and exits 1 if any bucket score on the PR head is strictly lower than the
 * same bucket on master. Exits 0 otherwise. Issue #143.
 */

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts/health-regression-check.ts');

function runCheck(prJsonl: string, masterJsonl: string): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'health-regression-'));
  const prPath = path.join(tmp, 'pr.jsonl');
  const masterPath = path.join(tmp, 'master.jsonl');
  fs.writeFileSync(prPath, prJsonl);
  fs.writeFileSync(masterPath, masterJsonl);
  const r = spawnSync('npx', ['tsx', SCRIPT, prPath, masterPath], {
    encoding: 'utf8',
    cwd: ROOT,
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const masterEntry = JSON.stringify({
  ts: '2026-04-08T00:00:00Z',
  composite: 95.0,
  buckets: {
    code: 70,
    test: 100,
    skill: 90,
    command: 100,
    hook: 100,
    sim: 100,
    reference: 100,
    registry: 90,
    config: 100,
    memory_link: 100,
  },
});

describe('scripts/health-regression-check.ts', () => {
  it('exits 0 when no bucket regresses', () => {
    const pr = JSON.stringify({
      ts: '2026-04-08T01:00:00Z',
      composite: 95.5,
      buckets: {
        code: 70,
        test: 100,
        skill: 90,
        command: 100,
        hook: 100,
        sim: 100,
        reference: 100,
        registry: 90,
        config: 100,
        memory_link: 100,
      },
    });
    const r = runCheck(pr, masterEntry);
    assert.strictEqual(r.status, 0, 'expected exit 0, got ' + r.status + '\n' + r.stderr);
  });

  it('exits 0 when a bucket improves', () => {
    const pr = JSON.stringify({
      ts: '2026-04-08T01:00:00Z',
      composite: 96.0,
      buckets: {
        code: 75,
        test: 100,
        skill: 90,
        command: 100,
        hook: 100,
        sim: 100,
        reference: 100,
        registry: 90,
        config: 100,
        memory_link: 100,
      },
    });
    const r = runCheck(pr, masterEntry);
    assert.strictEqual(r.status, 0, 'expected exit 0, got ' + r.status);
  });

  it('exits 1 when a single bucket regresses', () => {
    const pr = JSON.stringify({
      ts: '2026-04-08T01:00:00Z',
      composite: 94.0,
      buckets: {
        code: 65,
        test: 100,
        skill: 90,
        command: 100,
        hook: 100,
        sim: 100,
        reference: 100,
        registry: 90,
        config: 100,
        memory_link: 100,
      },
    });
    const r = runCheck(pr, masterEntry);
    assert.strictEqual(r.status, 1, 'expected exit 1');
    assert.match(r.stdout + r.stderr, /code/, 'must name the regressing bucket');
    assert.match(r.stdout + r.stderr, /70/, 'must show the master score');
    assert.match(r.stdout + r.stderr, /65/, 'must show the PR score');
  });

  it('exits 1 when multiple buckets regress and names all of them', () => {
    const pr = JSON.stringify({
      ts: '2026-04-08T01:00:00Z',
      composite: 90.0,
      buckets: {
        code: 65,
        test: 100,
        skill: 85,
        command: 100,
        hook: 100,
        sim: 100,
        reference: 100,
        registry: 90,
        config: 100,
        memory_link: 100,
      },
    });
    const r = runCheck(pr, masterEntry);
    assert.strictEqual(r.status, 1);
    const out = r.stdout + r.stderr;
    assert.match(out, /code/);
    assert.match(out, /skill/);
  });

  it('uses the LAST entry of each jsonl file (tail semantics)', () => {
    const masterMulti =
      JSON.stringify({
        ts: '2026-04-07T00:00:00Z',
        composite: 50,
        buckets: { code: 50, test: 50, skill: 50, command: 50, hook: 50, sim: 50, reference: 50, registry: 50, config: 50, memory_link: 50 },
      }) +
      '\n' +
      masterEntry;
    const pr = JSON.stringify({
      ts: '2026-04-08T01:00:00Z',
      composite: 95.0,
      buckets: {
        code: 70,
        test: 100,
        skill: 90,
        command: 100,
        hook: 100,
        sim: 100,
        reference: 100,
        registry: 90,
        config: 100,
        memory_link: 100,
      },
    });
    const r = runCheck(pr, masterMulti);
    assert.strictEqual(r.status, 0, 'should compare against the LAST master entry, not the first');
  });

  it('exits 2 with a usage message when given no arguments', () => {
    const r = spawnSync('npx', ['tsx', SCRIPT], { encoding: 'utf8', cwd: ROOT });
    assert.strictEqual(r.status, 2);
    assert.match(r.stderr, /usage/i);
  });
});
