#!/usr/bin/env node
'use strict';

const acorn = require('acorn');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Load weights from config, fall back to defaults
const DEFAULT_WEIGHTS = {
  modularity: 0.30, encapsulation: 0.20, size_balance: 0.15,
  dep_depth: 0.10, complexity: 0.15, test_sync: 0.10
};

function loadWeights() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'metrics.config.json'), 'utf8'));
    return cfg.health_scores && cfg.health_scores.weights
      ? cfg.health_scores.weights
      : DEFAULT_WEIGHTS;
  } catch {
    return DEFAULT_WEIGHTS;
  }
}

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------

function parseFile(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  return {
    ast: acorn.parse(source, { ecmaVersion: 2022, sourceType: 'script', allowReturnOutsideFunction: true }),
    source,
    loc: source.split('\n').length
  };
}

function walk(node, visitor) {
  if (!node || typeof node !== 'object') return;
  if (node.type) visitor(node);
  for (const key of Object.keys(node)) {
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) walk(item, visitor);
    } else if (child && typeof child === 'object' && child.type) {
      walk(child, visitor);
    }
  }
}

function extractRequires(ast) {
  const requires = [];
  walk(ast, (node) => {
    if (
      node.type === 'CallExpression' &&
      node.callee.type === 'Identifier' &&
      node.callee.name === 'require' &&
      node.arguments.length > 0 &&
      node.arguments[0].type === 'Literal' &&
      typeof node.arguments[0].value === 'string'
    ) {
      requires.push(node.arguments[0].value);
    }
  });
  return requires;
}

function extractExportCount(ast) {
  let fnCount = 0;
  let constCount = 0;

  // First pass: collect top-level declarations to know what each identifier resolves to.
  // Maps binding name -> 'function' | 'const' | 'unknown'
  const declarations = new Map();
  for (const stmt of ast.body) {
    if (stmt.type === 'FunctionDeclaration' && stmt.id) {
      declarations.set(stmt.id.name, 'function');
    }
    if (stmt.type === 'VariableDeclaration') {
      for (const decl of stmt.declarations) {
        if (!decl.id || decl.id.type !== 'Identifier') continue;
        if (!decl.init) {
          declarations.set(decl.id.name, 'unknown');
        } else if (
          decl.init.type === 'ArrowFunctionExpression' ||
          decl.init.type === 'FunctionExpression'
        ) {
          declarations.set(decl.id.name, 'function');
        } else if (decl.init.type === 'CallExpression') {
          // require() calls, path.join(), etc. return values, not functions
          declarations.set(decl.id.name, 'const');
        } else {
          declarations.set(decl.id.name, 'const');
        }
      }
    }
  }

  // Second pass: find module.exports and classify each property
  walk(ast, (node) => {
    if (
      node.type === 'AssignmentExpression' &&
      node.left.type === 'MemberExpression' &&
      node.left.object.type === 'Identifier' &&
      node.left.object.name === 'module' &&
      node.left.property.name === 'exports' &&
      node.right.type === 'ObjectExpression'
    ) {
      for (const prop of node.right.properties) {
        if (
          prop.value.type === 'FunctionExpression' ||
          prop.value.type === 'ArrowFunctionExpression'
        ) {
          fnCount++;
        } else if (prop.value.type === 'Identifier') {
          const declType = declarations.get(prop.value.name);
          if (declType === 'function') {
            fnCount++;
          } else if (declType === 'const') {
            constCount++;
          } else {
            // 'unknown' or not found: count as function (conservative, higher weight)
            fnCount++;
          }
        } else {
          constCount++;
        }
      }
    }
  });

  return { fnCount, constCount };
}

function computeComplexity(ast) {
  const DECISION_TYPES = new Set([
    'IfStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement',
    'WhileStatement', 'DoWhileStatement', 'CatchClause'
  ]);

  const functions = [];
  let currentFn = null;

  walk(ast, (node) => {
    if (
      node.type === 'FunctionDeclaration' ||
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression'
    ) {
      const name = node.id ? node.id.name : '(anonymous)';
      const entry = { name, complexity: 1 }; // base complexity of 1
      const parentFn = currentFn;
      currentFn = entry;

      // Walk the function body for decision points
      walkBody(node.body, entry);

      functions.push(entry);
      currentFn = parentFn;
    }
  });

  return functions;

  function walkBody(node, entry) {
    if (!node || typeof node !== 'object') return;
    if (node.type) {
      if (DECISION_TYPES.has(node.type)) entry.complexity++;
      // SwitchCase: each case adds complexity
      if (node.type === 'SwitchCase') entry.complexity++;
      // Logical operators: && and ||
      if (node.type === 'LogicalExpression' && (node.operator === '&&' || node.operator === '||')) {
        entry.complexity++;
      }
      // Ternary
      if (node.type === 'ConditionalExpression') entry.complexity++;
      // Skip nested function declarations/expressions (they get their own entry)
      if (
        node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression'
      ) {
        return;
      }
    }
    for (const key of Object.keys(node)) {
      if (key === 'type') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) walkBody(item, entry);
      } else if (child && typeof child === 'object') {
        walkBody(child, entry);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

function discoverFiles(dirs, extensions) {
  const files = [];
  for (const dir of dirs) {
    const absDir = path.join(ROOT, dir);
    if (!fs.existsSync(absDir)) continue;
    const stat = fs.statSync(absDir);
    if (stat.isFile()) {
      if (extensions.some(ext => absDir.endsWith(ext))) files.push(absDir);
      continue;
    }
    for (const entry of fs.readdirSync(absDir)) {
      const full = path.join(absDir, entry);
      if (fs.statSync(full).isFile() && extensions.some(ext => entry.endsWith(ext))) {
        files.push(full);
      }
    }
  }
  return files;
}

function relPath(absPath) {
  return path.relative(ROOT, absPath);
}

function topDir(relativePath) {
  return relativePath.split(path.sep)[0];
}

// ---------------------------------------------------------------------------
// Score: Modularity
// ---------------------------------------------------------------------------

function scoreModularity(libFiles, allProdFiles) {
  // 1. Fan-out: for each lib file, count requires to other project files
  const fanOuts = [];
  const crossBoundary = [];

  for (const f of allProdFiles) {
    try {
      const { ast } = parseFile(f);
      const reqs = extractRequires(ast);
      const rel = relPath(f);
      const srcDir = topDir(rel);
      let localFanOut = 0;

      for (const req of reqs) {
        // Skip node built-ins and npm packages
        if (!req.startsWith('.') && !req.startsWith('/')) continue;
        const resolved = path.resolve(path.dirname(f), req);
        const resolvedRel = relPath(resolved.replace(/\.js$/, '') + '.js');

        // Count if it resolves to another project file
        if (fs.existsSync(resolved) || fs.existsSync(resolved + '.js')) {
          localFanOut++;
          const targetDir = topDir(resolvedRel);
          if (srcDir !== targetDir) {
            crossBoundary.push({ from: rel, to: resolvedRel });
          }
        }
      }
      fanOuts.push(localFanOut);
    } catch {
      // Skip files that fail to parse
    }
  }

  const avgFanOut = fanOuts.length > 0
    ? fanOuts.reduce((a, b) => a + b, 0) / fanOuts.length
    : 0;

  // 2. Path registry density
  let registryDensity = 0;
  const registryPath = path.join(ROOT, 'references', 'path-registry.csv');
  if (fs.existsSync(registryPath)) {
    const csv = fs.readFileSync(registryPath, 'utf8').trim().split('\n').slice(1); // skip header
    const pathCounts = new Map();
    for (const row of csv) {
      const cols = row.split(',');
      if (cols.length >= 2) {
        const p = cols[1];
        pathCounts.set(p, (pathCounts.get(p) || 0) + 1);
      }
    }
    if (pathCounts.size > 0) {
      registryDensity = [...pathCounts.values()].reduce((a, b) => a + b, 0) / pathCounts.size;
    }
  }

  const score = Math.max(0, Math.min(100,
    100 - (avgFanOut * 10) - (crossBoundary.length * 5) - (registryDensity * 2)
  ));

  return {
    score: round(score),
    sub: {
      avg_fan_out: round(avgFanOut),
      cross_boundary: crossBoundary.length,
      registry_density: round(registryDensity)
    }
  };
}

// ---------------------------------------------------------------------------
// Score: Encapsulation
// ---------------------------------------------------------------------------

function scoreEncapsulation(libFiles) {
  const weightedExports = [];

  for (const f of libFiles) {
    try {
      const { ast } = parseFile(f);
      const { fnCount, constCount } = extractExportCount(ast);
      weightedExports.push(fnCount * 1.0 + constCount * 0.3);
    } catch {
      // Skip
    }
  }

  const avg = weightedExports.length > 0
    ? weightedExports.reduce((a, b) => a + b, 0) / weightedExports.length
    : 0;

  const score = Math.max(0, Math.min(100, 100 - (avg * 8)));

  return {
    score: round(score),
    sub: { avg_weighted_exports: round(avg) }
  };
}

// ---------------------------------------------------------------------------
// Score: Size Balance
// ---------------------------------------------------------------------------

function scoreSizeBalance(prodFiles) {
  const locs = [];

  for (const f of prodFiles) {
    try {
      const content = fs.readFileSync(f, 'utf8');
      locs.push(content.split('\n').length);
    } catch {
      // Skip
    }
  }

  if (locs.length === 0) return { score: 100, sub: { max_median_ratio: 0, file_count: 0 } };

  locs.sort((a, b) => a - b);
  const median = locs[Math.floor(locs.length / 2)];
  const max = locs[locs.length - 1];
  const ratio = median > 0 ? max / median : 0;

  const score = Math.max(0, Math.min(100, 100 - (ratio * 5)));

  return {
    score: round(score),
    sub: { max_median_ratio: round(ratio), file_count: locs.length }
  };
}

// ---------------------------------------------------------------------------
// Score: Dependency Depth
// ---------------------------------------------------------------------------

function scoreDepDepth(libFiles) {
  // Build adjacency list from require() calls
  const graph = new Map();
  const fileSet = new Set();

  for (const f of libFiles) {
    const rel = relPath(f);
    fileSet.add(rel);
    graph.set(rel, []);
  }

  for (const f of libFiles) {
    try {
      const { ast } = parseFile(f);
      const reqs = extractRequires(ast);
      const rel = relPath(f);

      for (const req of reqs) {
        if (!req.startsWith('.') && !req.startsWith('/')) continue;
        let resolved = path.resolve(path.dirname(f), req);
        if (!resolved.endsWith('.js')) resolved += '.js';
        const resolvedRel = relPath(resolved);
        if (fileSet.has(resolvedRel)) {
          graph.get(rel).push(resolvedRel);
        }
      }
    } catch {
      // Skip
    }
  }

  // DFS to find longest path (no memoization: graph is small, and memoization
  // produces wrong results when cycles exist because a node visited during cycle
  // detection gets cached as depth 0)
  function maxDepth(node, visited) {
    if (visited.has(node)) return 0; // cycle protection
    visited.add(node);
    let best = 0;
    for (const dep of (graph.get(node) || [])) {
      best = Math.max(best, 1 + maxDepth(dep, visited));
    }
    visited.delete(node);
    return best;
  }

  let globalMax = 0;
  for (const node of graph.keys()) {
    globalMax = Math.max(globalMax, maxDepth(node, new Set()));
  }

  const score = Math.max(0, Math.min(100, 100 - (globalMax * 15)));

  return {
    score: round(score),
    sub: { max_depth: globalMax }
  };
}

// ---------------------------------------------------------------------------
// Score: Cyclomatic Complexity
// ---------------------------------------------------------------------------

function scoreComplexity(prodFiles) {
  const allFunctions = [];

  for (const f of prodFiles) {
    try {
      const { ast } = parseFile(f);
      const fns = computeComplexity(ast);
      for (const fn of fns) {
        allFunctions.push({ ...fn, file: relPath(f) });
      }
    } catch {
      // Skip files that fail to parse
    }
  }

  if (allFunctions.length === 0) {
    return { score: 100, sub: { avg_complexity: 0, max_complexity: 0, p90_complexity: 0, max_complexity_fn: 'none', trivial_filtered: 0 } };
  }

  // Filter out trivial functions (complexity 1, no branching at all).
  // These are one-liner callbacks, getters, and simple arrow functions that
  // dilute the average and hide real complexity.
  const trivialCount = allFunctions.filter(f => f.complexity === 1).length;
  const nonTrivial = allFunctions.filter(f => f.complexity > 1);

  // Use non-trivial functions for avg, fall back to all if everything is trivial
  const scoredFns = nonTrivial.length > 0 ? nonTrivial : allFunctions;
  const complexities = scoredFns.map(f => f.complexity);
  const avg = complexities.reduce((a, b) => a + b, 0) / complexities.length;

  // Use p90 (90th percentile) instead of raw max so a single outlier function
  // doesn't dominate the entire score
  complexities.sort((a, b) => a - b);
  const p90Index = Math.floor(complexities.length * 0.9);
  const p90 = complexities[Math.min(p90Index, complexities.length - 1)];
  const maxVal = complexities[complexities.length - 1];
  const maxFn = allFunctions.find(f => f.complexity === maxVal);

  const score = Math.max(0, Math.min(100,
    100 - (avg * 5) - (Math.max(0, p90 - 10) * 2)
  ));

  return {
    score: round(score),
    sub: {
      avg_complexity: round(avg),
      max_complexity: maxVal,
      p90_complexity: p90,
      max_complexity_fn: maxFn ? `${maxFn.name} (${maxFn.file})` : 'none',
      trivial_filtered: trivialCount
    }
  };
}

// ---------------------------------------------------------------------------
// Score: Test Sync
// ---------------------------------------------------------------------------

function scoreTestSync(libFiles) {
  let covered = 0;
  const total = libFiles.length;

  for (const f of libFiles) {
    const base = path.basename(f, '.js');
    const testPath = path.join(ROOT, 'web', 'test', `${base}.test.js`);
    if (fs.existsSync(testPath)) covered++;
  }

  const pct = total > 0 ? (covered / total) * 100 : 100;

  return {
    score: round(pct),
    sub: { covered: `${covered}/${total}` }
  };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function round(n) {
  return Math.round(n * 10) / 10;
}

function printReport(scores, composite) {
  console.log('--- code-health ---');
  const order = ['modularity', 'encapsulation', 'size_balance', 'dep_depth', 'complexity', 'test_sync'];
  for (const key of order) {
    const s = scores[key];
    console.log(`${key}: ${s.score.toFixed(1)}`);
    for (const [sk, sv] of Object.entries(s.sub)) {
      console.log(`  ${sk}: ${sv}`);
    }
  }
  console.log(`composite: ${composite.toFixed(1)}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const weights = loadWeights();

  const libFiles = discoverFiles(['web/lib'], ['.js']);
  const prodFiles = discoverFiles(
    ['web/lib', 'web/server.js', 'web/public', '.claude/hooks', 'scripts'],
    ['.js']
  );
  // Exclude this script itself from production analysis
  const filteredProd = prodFiles.filter(f => relPath(f) !== 'scripts/code-health.js');

  const scores = {
    modularity: scoreModularity(libFiles, filteredProd),
    encapsulation: scoreEncapsulation(libFiles),
    size_balance: scoreSizeBalance(filteredProd),
    dep_depth: scoreDepDepth(libFiles),
    complexity: scoreComplexity(filteredProd),
    test_sync: scoreTestSync(libFiles)
  };

  const composite = Object.entries(weights)
    .reduce((sum, [k, w]) => sum + (scores[k] ? scores[k].score : 0) * w, 0);

  printReport(scores, round(composite));

  return { scores, composite: round(composite) };
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = {
  parseFile, walk, extractRequires, extractExportCount, computeComplexity,
  discoverFiles, scoreModularity, scoreEncapsulation, scoreSizeBalance,
  scoreDepDepth, scoreComplexity, scoreTestSync, loadWeights, main, round
};
