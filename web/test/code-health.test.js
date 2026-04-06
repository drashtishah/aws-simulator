'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const acorn = require('acorn');

const {
  parseFile, walk, extractRequires, extractExportCount, computeComplexity,
  scoreModularity, scoreEncapsulation, scoreSizeBalance,
  scoreDepDepth, scoreComplexity, scoreTestSync, loadWeights, main, round
} = require('../../scripts/code-health');

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
    const result = parseFile(path.join(ROOT, 'web', 'lib', 'paths.js'));
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
      .filter(f => f.endsWith('.js'))
      .map(f => path.join(ROOT, 'web', 'lib', f));

    const result = scoreTestSync(libFiles);
    // 9 of 10 lib files have dedicated test files (question-quality.js tested via vault.test.js)
    assert.equal(result.sub.covered, '9/10');
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
