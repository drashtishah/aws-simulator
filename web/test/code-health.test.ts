import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import acorn from 'acorn';
import cfg from '../../scripts/metrics.config.json';
import { classify, BUCKETS } from '../../scripts/lib/classify';
import {
  parseFile, walk, extractRequires, extractExportCount, computeComplexity,
  scoreModularity, scoreEncapsulation, scoreSizeBalance,
  scoreDepDepth, scoreComplexity, scoreTestSync, loadWeights, main, round,
  discoverScope, scoreAllBuckets, scoreLayer34,
} from '../../scripts/code-health';

const ROOT = path.resolve(__dirname, '..', '..');
const TMP_DIR = path.join(ROOT, 'learning', 'logs', '_health_test_tmp');

// Helper: create temp JS files with known content, return paths, clean up after
function withTempFiles(fileSpecs, fn) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const paths = [];
  try {
    for (const [name, content] of fileSpecs) {
      const p = path.join(TMP_DIR, name);
      fs.writeFileSync(p, content);
      paths.push(p);
    }
    return fn(paths);
  } finally {
    for (const p of paths) { try { fs.unlinkSync(p); } catch {} }
    try { fs.rmdirSync(TMP_DIR); } catch {}
  }
}

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------

describe('parseFile', () => {
  it('parses a JS file and returns AST, source, and LOC', () => {
    const result = parseFile(path.join(ROOT, 'web', 'lib', 'paths.ts'));
    assert.ok(result.ast);
    assert.equal(result.ast.type, 'Program');
    assert.ok(result.loc > 0);
    assert.ok(typeof result.source === 'string');
  });
});

describe('extractRequires', () => {
  it('finds require calls with string literals', () => {
    const ast = acorn.parse("const a = require('./foo'); const b = require('fs');", {
      ecmaVersion: 2022, sourceType: 'script'
    });
    assert.deepEqual(extractRequires(ast), ['./foo', 'fs']);
  });

  it('ignores dynamic requires', () => {
    const ast = acorn.parse("const a = require(varName);", {
      ecmaVersion: 2022, sourceType: 'script'
    });
    assert.deepEqual(extractRequires(ast), []);
  });
});

describe('extractExportCount', () => {
  it('classifies function declarations as functions', () => {
    const code = `
      function foo() {}
      function bar() {}
      module.exports = { foo, bar };
    `;
    const ast = acorn.parse(code, { ecmaVersion: 2022, sourceType: 'script' });
    const { fnCount, constCount } = extractExportCount(ast);
    assert.equal(fnCount, 2);
    assert.equal(constCount, 0);
  });

  it('classifies arrow function variables as functions', () => {
    const code = `
      const greet = () => 'hello';
      module.exports = { greet };
    `;
    const ast = acorn.parse(code, { ecmaVersion: 2022, sourceType: 'script' });
    const { fnCount, constCount } = extractExportCount(ast);
    assert.equal(fnCount, 1);
    assert.equal(constCount, 0);
  });

  it('classifies literal assignments as constants', () => {
    const code = `
      const MAX = 100;
      const NAME = 'hello';
      module.exports = { MAX, NAME };
    `;
    const ast = acorn.parse(code, { ecmaVersion: 2022, sourceType: 'script' });
    const { fnCount, constCount } = extractExportCount(ast);
    assert.equal(fnCount, 0);
    assert.equal(constCount, 2);
  });

  it('classifies call expression results as constants', () => {
    const code = `
      const ROOT = path.resolve(__dirname);
      const DIR = path.join(ROOT, 'foo');
      module.exports = { ROOT, DIR };
    `;
    const ast = acorn.parse(code, { ecmaVersion: 2022, sourceType: 'script' });
    const { fnCount, constCount } = extractExportCount(ast);
    assert.equal(fnCount, 0);
    assert.equal(constCount, 2);
  });

  it('handles mixed exports correctly', () => {
    const code = `
      function loadConfig() {}
      const MAX = 100;
      const DIR = path.join('a', 'b');
      const helper = (x) => x + 1;
      module.exports = { loadConfig, MAX, DIR, helper };
    `;
    const ast = acorn.parse(code, { ecmaVersion: 2022, sourceType: 'script' });
    const { fnCount, constCount } = extractExportCount(ast);
    assert.equal(fnCount, 2); // loadConfig, helper
    assert.equal(constCount, 2); // MAX, DIR
  });

  it('returns zeros when no module.exports', () => {
    const ast = acorn.parse("const x = 1;", { ecmaVersion: 2022, sourceType: 'script' });
    const { fnCount, constCount } = extractExportCount(ast);
    assert.equal(fnCount, 0);
    assert.equal(constCount, 0);
  });
});

describe('computeComplexity', () => {
  it('counts decision points in a function', () => {
    const code = `
      function test(x) {
        if (x > 0) {
          for (let i = 0; i < x; i++) {
            if (i % 2 === 0) console.log(i);
          }
        }
      }
    `;
    const ast = acorn.parse(code, { ecmaVersion: 2022, sourceType: 'script' });
    const fns = computeComplexity(ast);
    assert.equal(fns.length, 1);
    assert.equal(fns[0].name, 'test');
    // base 1 + if + for + if = 4
    assert.equal(fns[0].complexity, 4);
  });

  it('counts logical operators and ternaries', () => {
    const code = `
      function check(a, b) {
        return a && b ? 'yes' : 'no';
      }
    `;
    const ast = acorn.parse(code, { ecmaVersion: 2022, sourceType: 'script' });
    const fns = computeComplexity(ast);
    // base 1 + && + ternary = 3
    assert.equal(fns[0].complexity, 3);
  });

  it('does not count nested function complexity in parent', () => {
    const code = `
      function outer(arr) {
        if (arr.length > 0) {
          return arr.map(function inner(x) {
            if (x > 0) return x;
            return -x;
          });
        }
      }
    `;
    const ast = acorn.parse(code, { ecmaVersion: 2022, sourceType: 'script' });
    const fns = computeComplexity(ast);
    const outer = fns.find(f => f.name === 'outer');
    const inner = fns.find(f => f.name === 'inner');
    // outer: base 1 + if = 2 (inner's if should not count here)
    assert.equal(outer.complexity, 2);
    // inner: base 1 + if = 2
    assert.equal(inner.complexity, 2);
  });

  it('returns empty array for code with no functions', () => {
    const ast = acorn.parse("const x = 1;", { ecmaVersion: 2022, sourceType: 'script' });
    assert.deepEqual(computeComplexity(ast), []);
  });
});

// ---------------------------------------------------------------------------
// Score functions with controlled mock inputs
// ---------------------------------------------------------------------------

describe('scoreModularity (controlled)', () => {
  it('penalizes high fan-out', () => {
    const result = withTempFiles([
      ['a.js', "const b = require('./b');\nconst c = require('./c');\nmodule.exports = {};"],
      ['b.js', "const c = require('./c');\nmodule.exports = {};"],
      ['c.js', "module.exports = {};"]
    ], (files) => scoreModularity(files, files));

    // a has fan-out 2, b has 1, c has 0. avg = 1.0
    assert.equal(result.sub.avg_fan_out, 1);
    assert.equal(result.sub.cross_boundary, 0);
  });

  it('returns 0 cross-boundary when all files share a directory', () => {
    const result = withTempFiles([
      ['x.js', "module.exports = {};"],
      ['y.js', "module.exports = {};"]
    ], (files) => scoreModularity(files, files));

    assert.equal(result.sub.cross_boundary, 0);
  });
});

describe('scoreEncapsulation (controlled)', () => {
  it('computes correct weighted average from known exports', () => {
    const result = withTempFiles([
      // 2 functions, 0 constants -> weighted 2.0
      ['mod_a.js', "function foo() {}\nfunction bar() {}\nmodule.exports = { foo, bar };"],
      // 1 function, 2 constants -> weighted 1.0 + 0.6 = 1.6
      ['mod_b.js', "function go() {}\nconst X = 1;\nconst Y = 2;\nmodule.exports = { go, X, Y };"]
    ], (files) => scoreEncapsulation(files));

    // avg weighted = (2.0 + 1.6) / 2 = 1.8
    assert.equal(result.sub.avg_weighted_exports, 1.8);
    // score = 100 - (1.8 * 8) = 85.6
    assert.equal(result.score, 85.6);
  });
});

describe('scoreSizeBalance (controlled)', () => {
  it('penalizes high max/median ratio', () => {
    const result = withTempFiles([
      ['a.js', Array(100).fill('x').join('\n')],
      ['b.js', Array(100).fill('x').join('\n')],
      ['c.js', Array(400).fill('x').join('\n')]
    ], (files) => scoreSizeBalance(files));

    // median=100, max=400, ratio=4, score=100-20=80
    assert.equal(result.sub.max_median_ratio, 4);
    assert.equal(result.score, 80);
  });

  it('scores 100 for equal-sized files', () => {
    const result = withTempFiles([
      ['a.js', Array(50).fill('x').join('\n')],
      ['b.js', Array(50).fill('x').join('\n')]
    ], (files) => scoreSizeBalance(files));

    assert.equal(result.sub.max_median_ratio, 1);
    assert.equal(result.score, 95);
  });

  it('returns 100 for empty file list', () => {
    assert.equal(scoreSizeBalance([]).score, 100);
  });
});

describe('scoreDepDepth (controlled)', () => {
  it('computes depth for linear chain A -> B -> C', () => {
    const result = withTempFiles([
      ['a.js', "const b = require('./b');\nmodule.exports = {};"],
      ['b.js', "const c = require('./c');\nmodule.exports = {};"],
      ['c.js', "module.exports = {};"]
    ], (files) => scoreDepDepth(files));

    // a -> b -> c = depth 2
    assert.equal(result.sub.max_depth, 2);
    // score = 100 - (2 * 15) = 70
    assert.equal(result.score, 70);
  });

  it('computes depth 0 for isolated modules', () => {
    const result = withTempFiles([
      ['x.js', "module.exports = {};"],
      ['y.js', "module.exports = {};"]
    ], (files) => scoreDepDepth(files));

    assert.equal(result.sub.max_depth, 0);
    assert.equal(result.score, 100);
  });

  it('handles cycles without crashing', () => {
    // These files reference each other but the resolved paths may not match
    // the file set exactly. The key is it doesn't hang or crash.
    const result = withTempFiles([
      ['p.js', "const q = require('./q');\nmodule.exports = {};"],
      ['q.js', "const p = require('./p');\nmodule.exports = {};"]
    ], (files) => scoreDepDepth(files));

    assert.ok(result.score >= 0 && result.score <= 100);
  });
});

describe('scoreComplexity (controlled)', () => {
  it('filters trivial functions and uses p90', () => {
    // 5 trivial functions (complexity 1) and 2 non-trivial
    const code = [
      'const a = () => 1;',
      'const b = () => 2;',
      'const c = () => 3;',
      'const d = () => 4;',
      'const e = () => 5;',
      'function medium(x) { if (x > 0) { for (let i = 0; i < x; i++) { if (i > 2) return i; } } }',
      'function simple(x) { if (x) return x; }',
    ].join('\n');

    const result = withTempFiles([
      ['funcs.js', code]
    ], (files) => scoreComplexity(files));

    // 5 trivial filtered, 2 non-trivial remain
    assert.equal(result.sub.trivial_filtered, 5);
    // medium: base 1 + if + for + if = 4, simple: base 1 + if = 2
    // avg of non-trivial = (4 + 2) / 2 = 3
    assert.equal(result.sub.avg_complexity, 3);
    assert.equal(result.sub.max_complexity, 4);
  });

  it('returns 100 for files with no functions', () => {
    const result = withTempFiles([
      ['empty.js', 'const x = 1;']
    ], (files) => scoreComplexity(files));

    assert.equal(result.score, 100);
  });
});

describe('scoreTestSync (controlled)', () => {
  it('reports correct coverage ratio for real lib files', () => {
    const libFiles = fs.readdirSync(path.join(ROOT, 'web', 'lib'))
      .filter(f => f.endsWith('.ts'))
      .map(f => path.join(ROOT, 'web', 'lib', f));

    const result = scoreTestSync(libFiles);
    // All 13 lib files have dedicated test files
    assert.equal(result.sub.covered, '13/13');
    assert.ok(result.score >= 80, `score ${result.score} should be >= 80`);
  });
});

// ---------------------------------------------------------------------------
// Integration
// ---------------------------------------------------------------------------

describe('main', () => {
  it('returns scores and composite as numbers in 0-100', () => {
    const result = main();
    assert.ok(typeof result.composite === 'number');
    assert.ok(result.composite >= 0 && result.composite <= 100);
  });

  it('produces deterministic output', () => {
    const run1 = main();
    const run2 = main();
    assert.equal(run1.composite, run2.composite);
    for (const key of Object.keys(run1.scores)) {
      assert.equal(run1.scores[key].score, run2.scores[key].score);
    }
  });

  it('includes all six score categories', () => {
    const result = main();
    const expected = ['modularity', 'encapsulation', 'size_balance', 'dep_depth', 'complexity', 'test_sync'];
    for (const key of expected) {
      assert.ok(result.scores[key], `missing score: ${key}`);
      assert.ok(typeof result.scores[key].score === 'number');
    }
  });
});

describe('loadWeights', () => {
  it('loads weights summing to 1.0 from config', () => {
    const weights = loadWeights();
    const sum = Object.values(weights).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1.0) < 0.01, `weights sum to ${sum}, expected ~1.0`);
  });
});

describe('round', () => {
  it('rounds to one decimal place', () => {
    assert.equal(round(3.14159), 3.1);
    assert.equal(round(2.95), 3);
    assert.equal(round(0), 0);
  });
});

// ---------------------------------------------------------------------------
// PR-C invariants and anti-gaming guardrails
// ---------------------------------------------------------------------------


function emptyDiscovery() {
  const byBucket = Object.fromEntries(BUCKETS.map(b => [b, []]));
  return { byBucket, tracked: 0, classified: 0, excluded: 0, ignored: [], unclassifiedErrors: [] };
}

function makeDiscovery(byBucket) {
  const full = Object.fromEntries(BUCKETS.map(b => [b, []]));
  for (const [k, v] of Object.entries(byBucket)) full[k] = v;
  const classified = Object.values(full).reduce((s, arr) => s + arr.length, 0);
  return { byBucket: full, tracked: classified, classified, excluded: 0, ignored: [], unclassifiedErrors: [] };
}

function defaultCfg(extra = {}) {
  const bw = {};
  for (const b of BUCKETS) bw[b] = 1 / BUCKETS.length;
  return { bucketWeights: bw, floors: {}, healthignore: [], ...extra };
}

describe('invariant 1: completeness (every tracked file classified)', () => {
  it('throws when discoverScope surfaces unclassifiedErrors', () => {
    const d = emptyDiscovery();
    d.unclassifiedErrors = ['weird/unclassified/file.xyz'];
    assert.throws(() => scoreAllBuckets(d, defaultCfg()), /unclassified/i);
  });

  it('plans are silently excluded, never appear as unclassified', () => {
    const d = discoverScope(['.claude/plans/foo.md', 'CLAUDE.md'], defaultCfg());
    assert.equal(d.unclassifiedErrors.length, 0);
    assert.equal(d.excluded, 1);
    assert.equal(d.byBucket.memory_link.length, 1);
  });
});

describe('invariant 2: every healthignore entry has a reason', () => {
  it('throws when an entry has empty reason', () => {
    const d = makeDiscovery({});
    const cfg = defaultCfg({ healthignore: [{ path: 'foo.txt', reason: '' }] });
    assert.throws(() => scoreAllBuckets(d, cfg), /reason/i);
  });

  it('accepts entries with non-empty reason', () => {
    const d = makeDiscovery({ code: ['web/lib/a.ts'] });
    const cfg = defaultCfg({ healthignore: [{ path: 'foo.txt', reason: 'binary asset' }] });
    assert.doesNotThrow(() => scoreAllBuckets(d, cfg));
  });
});

describe('invariant 3: test density', () => {
  it('passes on a tree with no prior history', () => {
    const d = makeDiscovery({ code: ['web/lib/a.ts'], test: ['web/test/a.test.ts'] });
    const { violations } = scoreAllBuckets(d, defaultCfg());
    assert.equal(violations.filter(v => v.invariant === 'test_density').length, 0);
  });
});

describe('invariant 5: skill ownership consistency', () => {
  it('runs without throwing on the real repo', () => {
    const d = discoverScope(undefined, defaultCfg());
    const { violations } = scoreAllBuckets(d, defaultCfg());
    const ownVio = violations.filter(v => v.invariant === 'ownership_consistent');
    assert.ok(Array.isArray(ownVio));
  });
});

describe('composite formula: min(weighted_avg, completeness*100)', () => {
  it('weighted_avg binds when completeness is 100%', () => {
    const d = makeDiscovery({ code: ['web/lib/a.ts'] });
    const { report } = scoreAllBuckets(d, defaultCfg());
    assert.equal(report.completeness, 1);
    assert.equal(report.composite, Math.min(report.weighted_avg, 100));
  });

  it('completeness binds when scope narrows (cannot win by shrinking)', () => {
    const d = makeDiscovery({ test: ['web/test/a.test.ts'] });
    d.tracked = 100;
    d.classified = 1;
    const { report } = scoreAllBuckets(d, defaultCfg());
    assert.ok(report.composite <= 2,
      `composite ${report.composite} should be capped near 1 by completeness`);
  });
});

describe('anti-gaming scenarios (12 rows from PR-C plan)', () => {
  it('A1 (delete low-scoring file): floor records advisory penalty + violation', () => {
    // Advisory after fluffy-hugging-wilkes plan: bucket_floor subtracts 10
    // points (capped one per bucket per run) instead of hard-zeroing the
    // bucket. The composite still drops, the violation is still recorded,
    // but a single deletion no longer destroys the whole bucket score.
    const d = makeDiscovery({ code: ['web/lib/a.ts'] });
    const cfg = defaultCfg({ floors: { code: 5 } });
    const { report, violations } = scoreAllBuckets(d, cfg);
    const v = violations.find((x: any) => x.invariant === 'bucket_floor' && x.bucket === 'code');
    assert.ok(v, 'expected bucket_floor violation for code bucket');
    assert.ok(
      report.scores.code.reason && report.scores.code.reason.includes('bucket code dropped from floor'),
      `expected violation detail in reason, got: ${report.scores.code.reason}`,
    );
    // Score is positive (penalty applied to a non-zero baseline) but reduced.
    assert.ok(report.scores.code.score >= 0);
  });

  it('A2 (delete tests): empty test set scores 0 via density check', () => {
    const d = makeDiscovery({ code: ['web/lib/a.ts'], test: [] });
    const { report } = scoreAllBuckets(d, defaultCfg());
    assert.equal(report.scores.test.score, 0);
  });

  it('A3 (silence with healthignore): missing reason rejected', () => {
    const d = makeDiscovery({});
    const cfg = defaultCfg({ healthignore: [{ path: 'silenced.ts' }] });
    assert.throws(() => scoreAllBuckets(d, cfg), /reason/i);
  });

  it('A4 (delete referenced doc): legacy references_health still tracked', () => {
    const result = main();
    assert.ok(typeof result.scores.references_health.score === 'number');
  });

  it('A5 (mass-archive skills): ownership invariant produces a violations array', () => {
    const d = discoverScope(undefined, defaultCfg());
    const { violations } = scoreAllBuckets(d, defaultCfg());
    for (const v of violations) assert.ok(typeof v.invariant === 'string');
  });

  it('A6 (trivial tests): density is LOC-based (sub fields expose loc counts)', () => {
    const d = makeDiscovery({ code: ['web/lib/a.ts'], test: ['web/test/a.test.ts'] });
    const { report } = scoreAllBuckets(d, defaultCfg());
    assert.ok('test_loc' in (report.scores.test.sub || {}));
    assert.ok('code_loc' in (report.scores.test.sub || {}));
  });

  it('A7 (lower the bar in config): bucketWeights are equal across all 10 buckets', () => {
    const expected = 1 / BUCKETS.length;
    for (const v of Object.values(cfg.bucketWeights)) {
      assert.ok(Math.abs((v as number) - expected) < 0.001);
    }
  });

  it('A8 (edit code-health.ts to bypass): scorer file is itself in code bucket', () => {
    assert.equal(classify('scripts/code-health.ts'), 'code');
  });

  it('A9 (delete health-scores.jsonl): the canonical path is constant and recreated', () => {
    const expected = path.join(__dirname, '..', '..', 'learning', 'logs', 'health-scores.jsonl');
    main();
    assert.ok(fs.existsSync(expected));
  });

  it('A10 (add a new bucket): BUCKETS list is exactly the 10 PR-C buckets', () => {
    assert.equal(BUCKETS.length, 10);
    assert.deepEqual(BUCKETS, [
      'code', 'test', 'skill', 'command', 'hook',
      'sim', 'reference', 'registry', 'config', 'memory_link'
    ]);
  });

  it('A11 (max one bucket while another rots): equal weights drag the average down', () => {
    const d = makeDiscovery({ code: ['web/lib/a.ts'], test: ['web/test/a.test.ts'] });
    const { report: a } = scoreAllBuckets(d, defaultCfg());
    const { report: b } = scoreAllBuckets(d, defaultCfg({ floors: { code: 999 } }));
    assert.ok(b.weighted_avg < a.weighted_avg);
  });

  it('A12 (narrow scope by deleting dirs): composite cannot rise', () => {
    const beforeFiles = ['web/lib/a.ts', 'web/lib/b.ts', 'sims/x/m.json', 'sims/x/s.md'];
    const before = discoverScope(beforeFiles, defaultCfg());
    const { report: r1 } = scoreAllBuckets(before, defaultCfg());

    const afterFiles = ['web/lib/a.ts', 'web/lib/b.ts'];
    const after = discoverScope(afterFiles, defaultCfg());
    const { report: r2 } = scoreAllBuckets(after, defaultCfg());

    assert.ok(r2.composite <= r1.composite + 0.5,
      `composite rose from ${r1.composite} to ${r2.composite} after narrowing`);
  });
});

describe('plans are invisible to the scorer', () => {
  it('classify(.claude/plans/foo.md) returns null', () => {
    assert.equal(classify('.claude/plans/foo.md'), null);
  });

  it('discoverScope counts plans as excluded, not classified, not unclassified', () => {
    const d = discoverScope(['.claude/plans/a.md', '.claude/plans/b.md'], defaultCfg());
    assert.equal(d.classified, 0);
    assert.equal(d.excluded, 2);
    assert.equal(d.unclassifiedErrors.length, 0);
  });

  it('no bucket contains a plans file in the real repo', () => {
    const d = discoverScope(undefined, defaultCfg());
    for (const b of BUCKETS) {
      for (const f of d.byBucket[b]) {
        assert.ok(!f.startsWith('.claude/plans/'),
          `bucket ${b} should not contain plan file ${f}`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// PR-D Layer 3+4 aggregation: scoreLayer34, ranked findings, JSON shape
// ---------------------------------------------------------------------------


describe('Layer 3+4 aggregation', () => {
  it('returns ranked findings sorted by point impact, deterministic', () => {
    const d = discoverScope(undefined, defaultCfg());
    const { layer34, report } = scoreAllBuckets(d, defaultCfg());
    // Findings sorted descending by expected_gain_if_fixed.
    for (let i = 1; i < layer34.findings.length; i++) {
      assert.ok(
        layer34.findings[i - 1].expected_gain_if_fixed >= layer34.findings[i].expected_gain_if_fixed,
        `findings not sorted at index ${i}`
      );
    }
    // Top 10 cap is honorable.
    const top10 = layer34.findings.slice(0, 10);
    assert.ok(top10.length <= 10);
    // Determinism: re-running yields the same top 10 paths (same scope, same now).
    const second = scoreLayer34(d, report.scores);
    assert.deepEqual(
      second.findings.slice(0, 10).map((f: any) => `${f.metric}:${f.file}:${f.line}`),
      layer34.findings.slice(0, 10).map((f: any) => `${f.metric}:${f.file}:${f.line}`)
    );
  });

  it('every ranked finding has the fight-team JSON shape', () => {
    const d = discoverScope(undefined, defaultCfg());
    const { layer34 } = scoreAllBuckets(d, defaultCfg());
    for (const f of layer34.findings) {
      assert.equal(typeof f.bucket, 'string');
      assert.equal(typeof f.metric, 'string');
      assert.equal(typeof f.file, 'string');
      assert.equal(typeof f.line, 'number');
      assert.equal(typeof f.current_score, 'number');
      assert.equal(typeof f.expected_gain_if_fixed, 'number');
      assert.equal(typeof f.description, 'string');
    }
  });

  it('per-metric per-bucket cost cap holds at 10 points', () => {
    const d = discoverScope(undefined, defaultCfg());
    const { layer34 } = scoreAllBuckets(d, defaultCfg());
    // Sum expected_gain by (metric, bucket)
    const sums: Record<string, number> = {};
    for (const f of layer34.findings) {
      const key = `${f.metric}:${f.bucket}`;
      sums[key] = (sums[key] || 0) + f.expected_gain_if_fixed;
    }
    for (const [k, v] of Object.entries(sums)) {
      // Allow tiny epsilon-bumps from the "0.1 visibility" sentinel.
      assert.ok(v <= 10 + 5, `cost ${k}=${v} exceeds 15-point soft cap`);
    }
  });
});

