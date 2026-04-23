import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { proseDuplication, danglingReferences, activityFreshness } from '../../scripts/lib/graph-metrics';
'use strict';

// Tests for scripts/lib/graph-metrics.ts (PR-D Layers 3+4).
// Pure unit tests over inline string fixtures and tmp dirs. No git, no
// real raw.jsonl. Each metric: positive case, negative case, edge case.



function mkTmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `gm-${prefix}-`));
}
function rmTmp(d: string): void {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
}
function writeFile(root: string, rel: string, body: string): string {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
  return full;
}

// ---------------------------------------------------------------------------
// proseDuplication
// ---------------------------------------------------------------------------

describe('proseDuplication', () => {
  it('clusters two near-identical reference files (positive)', () => {
    const root = mkTmp('prose-pos');
    try {
      const sharedPara =
        'the quick brown fox jumps over the lazy dog and then keeps running through the forest until it finds a place to rest peacefully under a tree near the river';
      writeFile(root, 'references/a.md', sharedPara + ' alpha alpha alpha');
      writeFile(root, 'references/b.md', sharedPara + ' beta beta beta');
      writeFile(root, 'references/c.md', 'totally unrelated content about widgets and gizmos and other things entirely different');
      const files = [
        { path: 'references/a.md', bucket: 'reference', abs: path.join(root, 'references/a.md') },
        { path: 'references/b.md', bucket: 'reference', abs: path.join(root, 'references/b.md') },
        { path: 'references/c.md', bucket: 'reference', abs: path.join(root, 'references/c.md') },
      ];
      const findings = proseDuplication(files);
      assert.ok(findings.length >= 1, 'expected at least one cluster');
      const cluster = findings[0];
      assert.ok(cluster.cluster.includes('references/a.md'));
      assert.ok(cluster.cluster.includes('references/b.md'));
      assert.ok(!cluster.cluster.includes('references/c.md'));
      assert.equal(cluster.score, (cluster.cluster.length - 1) * 3);
    } finally { rmTmp(root); }
  });

  it('returns no findings when files are distinct (negative)', () => {
    const root = mkTmp('prose-neg');
    try {
      writeFile(root, 'references/a.md', 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar');
      writeFile(root, 'references/b.md', 'sierra tango uniform victor whiskey xray yankee zulu one two three four five six seven');
      const files = [
        { path: 'references/a.md', bucket: 'reference', abs: path.join(root, 'references/a.md') },
        { path: 'references/b.md', bucket: 'reference', abs: path.join(root, 'references/b.md') },
      ];
      assert.deepEqual(proseDuplication(files), []);
    } finally { rmTmp(root); }
  });

  it('handles empty input (edge)', () => {
    assert.deepEqual(proseDuplication([]), []);
  });

  it('skips buckets outside reference/skill/command (edge)', () => {
    const root = mkTmp('prose-edge');
    try {
      const txt = 'identical sentence repeated many many times across both files for sure across both files for sure across both files for sure';
      writeFile(root, 'sims/a.md', txt);
      writeFile(root, 'sims/b.md', txt);
      const files = [
        { path: 'sims/a.md', bucket: 'sim', abs: path.join(root, 'sims/a.md') },
        { path: 'sims/b.md', bucket: 'sim', abs: path.join(root, 'sims/b.md') },
      ];
      assert.deepEqual(proseDuplication(files), []);
    } finally { rmTmp(root); }
  });
});

// ---------------------------------------------------------------------------
// danglingReferences
// ---------------------------------------------------------------------------

describe('danglingReferences', () => {
  it('finds a markdown link to a missing path (positive)', () => {
    const root = mkTmp('dr-pos');
    try {
      writeFile(root, 'references/a.md', 'see [target](references/missing.md) for more.\nalso `web/nope.md`.\n');
      writeFile(root, 'references/exists.md', '# heading\n');
      const files = [
        { path: 'references/a.md', bucket: 'reference', abs: path.join(root, 'references/a.md') },
      ];
      const tracked = new Set(['references/a.md', 'references/exists.md']);
      const findings = danglingReferences(files, tracked, root);
      const targets = findings.map((f: any) => f.target).sort();
      assert.deepEqual(targets, ['references/missing.md', 'web/nope.md']);
      assert.ok(findings.every((f: any) => f.source === 'references/a.md' && typeof f.line === 'number'));
    } finally { rmTmp(root); }
  });

  it('accepts http(s) URLs and resolved paths (negative)', () => {
    const root = mkTmp('dr-neg');
    try {
      writeFile(root, 'references/a.md', 'see [ok](references/exists.md) and [web](https://example.com)\nbacktick `references/exists.md`\n');
      writeFile(root, 'references/exists.md', '# heading\n');
      const files = [
        { path: 'references/a.md', bucket: 'reference', abs: path.join(root, 'references/a.md') },
      ];
      const tracked = new Set(['references/a.md', 'references/exists.md']);
      assert.deepEqual(danglingReferences(files, tracked, root), []);
    } finally { rmTmp(root); }
  });

  it('handles empty input (edge)', () => {
    assert.deepEqual(danglingReferences([], new Set(), '/tmp'), []);
  });
});

// ---------------------------------------------------------------------------
// activityFreshness
// ---------------------------------------------------------------------------

describe('activityFreshness', () => {
  it('flags a stale code file with no activity in 90 days (positive)', () => {
    const root = mkTmp('af-pos');
    try {
      const oldTs = Date.now() - 100 * 24 * 3600 * 1000;
      const stalePath = writeFile(root, 'web/lib/stale.ts', 'export const x = 1;');
      fs.utimesSync(stalePath, new Date(oldTs), new Date(oldTs));
      const rawJsonl = path.join(root, 'raw.jsonl');
      fs.writeFileSync(rawJsonl, ''); // empty
      const files = [
        { path: 'web/lib/stale.ts', bucket: 'code', abs: stalePath },
      ];
      const findings = activityFreshness(files, rawJsonl, Date.now(), root);
      assert.equal(findings.length, 1);
      assert.equal(findings[0].path, 'web/lib/stale.ts');
      assert.equal(findings[0].cost, -1);
    } finally { rmTmp(root); }
  });

  it('does not flag freshly touched files (negative)', () => {
    const root = mkTmp('af-neg');
    try {
      const fresh = writeFile(root, 'web/lib/fresh.ts', 'export const x = 1;');
      const files = [{ path: 'web/lib/fresh.ts', bucket: 'code', abs: fresh }];
      assert.deepEqual(activityFreshness(files, path.join(root, 'missing.jsonl'), Date.now(), root), []);
    } finally { rmTmp(root); }
  });

  it('respects archived: true frontmatter (edge)', () => {
    const root = mkTmp('af-arch');
    try {
      const oldTs = Date.now() - 200 * 24 * 3600 * 1000;
      const p = writeFile(root, 'references/old.md', '---\narchived: true\n---\n# old\n');
      fs.utimesSync(p, new Date(oldTs), new Date(oldTs));
      const files = [{ path: 'references/old.md', bucket: 'reference', abs: p }];
      assert.deepEqual(activityFreshness(files, path.join(root, 'missing.jsonl'), Date.now(), root), []);
    } finally { rmTmp(root); }
  });

  it('returns paths from most recent activity-archive-*.jsonl when raw.jsonl is empty', () => {
    const root = mkTmp('af-archive');
    try {
      const rawJsonl = path.join(root, 'raw.jsonl');
      fs.writeFileSync(rawJsonl, ''); // empty
      const recentTs = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString();
      const archiveEntry = JSON.stringify({ ts: recentTs, target: 'scripts/lib/graph-metrics.ts' });
      fs.writeFileSync(path.join(root, 'activity-archive-2026-04-23.jsonl'), archiveEntry + '\n');
      const oldTs = Date.now() - 200 * 24 * 3600 * 1000;
      const stalePath = writeFile(root, 'scripts/lib/graph-metrics.ts', 'export const x = 1;');
      fs.utimesSync(stalePath, new Date(oldTs), new Date(oldTs));
      const files = [{ path: 'scripts/lib/graph-metrics.ts', bucket: 'code', abs: stalePath }];
      const findings = activityFreshness(files, rawJsonl, Date.now(), root);
      assert.equal(findings.length, 0, 'archive reference should suppress stale finding');
    } finally { rmTmp(root); }
  });

  it('caps cost at -10 per bucket (edge)', () => {
    const root = mkTmp('af-cap');
    try {
      const oldTs = Date.now() - 200 * 24 * 3600 * 1000;
      const files: any[] = [];
      for (let i = 0; i < 15; i++) {
        const p = writeFile(root, `web/lib/s${i}.ts`, 'export const x = 1;');
        fs.utimesSync(p, new Date(oldTs), new Date(oldTs));
        files.push({ path: `web/lib/s${i}.ts`, bucket: 'code', abs: p });
      }
      const findings = activityFreshness(files, path.join(root, 'missing.jsonl'), Date.now(), root);
      const totalCost = findings.reduce((s: number, f: any) => s + f.cost, 0);
      assert.ok(totalCost >= -10, `cap should hold, got ${totalCost}`);
    } finally { rmTmp(root); }
  });
});

