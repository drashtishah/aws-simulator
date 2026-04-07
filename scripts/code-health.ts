#!/usr/bin/env node
'use strict';

import * as acorn from 'acorn';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const ROOT: string = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface Weights {
  modularity: number;
  encapsulation: number;
  size_balance: number;
  dep_depth: number;
  complexity: number;
  test_sync: number;
  references_health: number;
}

interface MetricsConfig {
  health_scores?: {
    weights?: Weights;
  };
}

interface MetricResult {
  score: number;
  sub: Record<string, string | number>;
}

interface HealthScores {
  modularity: MetricResult;
  encapsulation: MetricResult;
  size_balance: MetricResult;
  dep_depth: MetricResult;
  complexity: MetricResult;
  test_sync: MetricResult;
  references_health: MetricResult;
}

interface ParsedFile {
  ast: acorn.Program;
  source: string;
  loc: number;
}

interface ExportCounts {
  fnCount: number;
  constCount: number;
}

interface FunctionComplexity {
  name: string;
  complexity: number;
}

interface FunctionComplexityWithFile extends FunctionComplexity {
  file: string;
}

interface CrossBoundaryEdge {
  from: string;
  to: string;
}

/** Loose AST node type for walking acorn trees with arbitrary properties. */
interface ASTNode {
  type: string;
  [key: string]: unknown;
}

type VisitorCallback = (node: ASTNode) => void;

// ---------------------------------------------------------------------------
// Load weights from config, fall back to defaults
// ---------------------------------------------------------------------------

// Equal weight across all 7 metrics (1/7 each).
const EQUAL_WEIGHT: number = 1 / 7;
const DEFAULT_WEIGHTS: Weights = {
  modularity: EQUAL_WEIGHT,
  encapsulation: EQUAL_WEIGHT,
  size_balance: EQUAL_WEIGHT,
  dep_depth: EQUAL_WEIGHT,
  complexity: EQUAL_WEIGHT,
  test_sync: EQUAL_WEIGHT,
  references_health: EQUAL_WEIGHT
};

function loadWeights(): Weights {
  try {
    const cfg: MetricsConfig = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'scripts', 'metrics.config.json'), 'utf8')
    );
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

function parseFile(filePath: string): ParsedFile {
  const source: string = fs.readFileSync(filePath, 'utf8');
  // For .ts files, strip type annotations before parsing with acorn
  let jsSource: string = source;
  if (filePath.endsWith('.ts')) {
    const result: ts.TranspileOutput = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    });
    jsSource = result.outputText;
  }
  return {
    ast: acorn.parse(jsSource, { ecmaVersion: 2022, sourceType: 'script', allowReturnOutsideFunction: true }),
    source,
    loc: source.split('\n').length
  };
}

function walk(node: unknown, visitor: VisitorCallback): void {
  if (!node || typeof node !== 'object') return;
  const n = node as ASTNode;
  if (n.type) visitor(n);
  for (const key of Object.keys(n)) {
    const child: unknown = n[key];
    if (Array.isArray(child)) {
      for (const item of child) walk(item, visitor);
    } else if (child && typeof child === 'object' && (child as ASTNode).type) {
      walk(child, visitor);
    }
  }
}

function extractRequires(ast: acorn.Program): string[] {
  const requires: string[] = [];
  walk(ast, (node: ASTNode) => {
    if (
      node.type === 'CallExpression' &&
      (node.callee as ASTNode)?.type === 'Identifier' &&
      (node.callee as ASTNode)?.name === 'require' &&
      Array.isArray(node.arguments) &&
      (node.arguments as ASTNode[]).length > 0 &&
      (node.arguments as ASTNode[])[0]!.type === 'Literal' &&
      typeof ((node.arguments as ASTNode[])[0] as unknown as { value: unknown }).value === 'string'
    ) {
      requires.push(((node.arguments as ASTNode[])[0] as unknown as { value: string }).value);
    }
  });
  return requires;
}

function extractExportCount(ast: acorn.Program): ExportCounts {
  let fnCount = 0;
  let constCount = 0;

  // First pass: collect top-level declarations to know what each identifier resolves to.
  // Maps binding name -> 'function' | 'const' | 'unknown'
  type DeclType = 'function' | 'const' | 'unknown';
  const declarations = new Map<string, DeclType>();
  const body = (ast as unknown as ASTNode).body as ASTNode[];
  for (const stmt of body) {
    if (stmt.type === 'FunctionDeclaration' && stmt.id) {
      declarations.set((stmt.id as ASTNode).name as string, 'function');
    }
    if (stmt.type === 'VariableDeclaration') {
      for (const decl of stmt.declarations as ASTNode[]) {
        if (!decl.id || (decl.id as ASTNode).type !== 'Identifier') continue;
        if (!decl.init) {
          declarations.set((decl.id as ASTNode).name as string, 'unknown');
        } else if (
          (decl.init as ASTNode).type === 'ArrowFunctionExpression' ||
          (decl.init as ASTNode).type === 'FunctionExpression'
        ) {
          declarations.set((decl.id as ASTNode).name as string, 'function');
        } else if ((decl.init as ASTNode).type === 'CallExpression') {
          // require() calls, path.join(), etc. return values, not functions
          declarations.set((decl.id as ASTNode).name as string, 'const');
        } else {
          declarations.set((decl.id as ASTNode).name as string, 'const');
        }
      }
    }
  }

  // Second pass: find module.exports and classify each property
  walk(ast, (node: ASTNode) => {
    // Pattern 1: module.exports = { ... }
    if (
      node.type === 'AssignmentExpression' &&
      (node.left as ASTNode).type === 'MemberExpression' &&
      ((node.left as ASTNode).object as ASTNode).type === 'Identifier' &&
      ((node.left as ASTNode).object as ASTNode).name === 'module' &&
      ((node.left as ASTNode).property as ASTNode).name === 'exports' &&
      (node.right as ASTNode).type === 'ObjectExpression'
    ) {
      for (const prop of (node.right as ASTNode).properties as ASTNode[]) {
        if (
          (prop.value as ASTNode).type === 'FunctionExpression' ||
          (prop.value as ASTNode).type === 'ArrowFunctionExpression'
        ) {
          fnCount++;
        } else if ((prop.value as ASTNode).type === 'Identifier') {
          const declType = declarations.get((prop.value as ASTNode).name as string);
          if (declType === 'function') {
            fnCount++;
          } else if (declType === 'const') {
            constCount++;
          } else {
            fnCount++;
          }
        } else {
          constCount++;
        }
      }
    }
    // Pattern 2: exports.X = ... (TS transpiler output)
    if (
      node.type === 'AssignmentExpression' &&
      (node.left as ASTNode).type === 'MemberExpression' &&
      ((node.left as ASTNode).object as ASTNode).type === 'Identifier' &&
      ((node.left as ASTNode).object as ASTNode).name === 'exports' &&
      ((node.left as ASTNode).property as ASTNode).type === 'Identifier'
    ) {
      const name = ((node.left as ASTNode).property as ASTNode).name as string;
      // Skip __esModule marker
      if (name === '__esModule') return;
      const declType = declarations.get(name);
      if (declType === 'function') {
        fnCount++;
      } else if (declType === 'const') {
        constCount++;
      } else {
        // Check the RHS: if it's a function, count as function
        if (
          (node.right as ASTNode).type === 'FunctionExpression' ||
          (node.right as ASTNode).type === 'ArrowFunctionExpression'
        ) {
          fnCount++;
        } else {
          constCount++;
        }
      }
    }
  });

  return { fnCount, constCount };
}

function computeComplexity(ast: acorn.Program): FunctionComplexity[] {
  const DECISION_TYPES = new Set([
    'IfStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement',
    'WhileStatement', 'DoWhileStatement', 'CatchClause'
  ]);

  const functions: FunctionComplexity[] = [];
  let currentFn: FunctionComplexity | null = null;

  function walkBody(node: unknown, entry: FunctionComplexity): void {
    if (!node || typeof node !== 'object') return;
    const n = node as ASTNode;
    if (n.type) {
      if (DECISION_TYPES.has(n.type)) entry.complexity++;
      // SwitchCase: each case adds complexity
      if (n.type === 'SwitchCase') entry.complexity++;
      // Logical operators: && and ||
      if (n.type === 'LogicalExpression' && (n.operator === '&&' || n.operator === '||')) {
        entry.complexity++;
      }
      // Ternary
      if (n.type === 'ConditionalExpression') entry.complexity++;
      // Skip nested function declarations/expressions (they get their own entry)
      if (
        n.type === 'FunctionDeclaration' ||
        n.type === 'FunctionExpression' ||
        n.type === 'ArrowFunctionExpression'
      ) {
        return;
      }
    }
    for (const key of Object.keys(n)) {
      if (key === 'type') continue;
      const child: unknown = n[key];
      if (Array.isArray(child)) {
        for (const item of child) walkBody(item, entry);
      } else if (child && typeof child === 'object') {
        walkBody(child, entry);
      }
    }
  }

  walk(ast, (node: ASTNode) => {
    if (
      node.type === 'FunctionDeclaration' ||
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression'
    ) {
      const id = node.id as ASTNode | null;
      const name: string = id ? (id.name as string) : '(anonymous)';
      const entry: FunctionComplexity = { name, complexity: 1 }; // base complexity of 1
      const parentFn = currentFn;
      currentFn = entry;

      // Walk the function body for decision points
      walkBody(node.body, entry);

      functions.push(entry);
      currentFn = parentFn;
    }
  });

  return functions;
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

function discoverFiles(dirs: string[], extensions: string[]): string[] {
  const files: string[] = [];
  for (const dir of dirs) {
    const absDir: string = path.join(ROOT, dir);
    if (!fs.existsSync(absDir)) continue;
    const stat: fs.Stats = fs.statSync(absDir);
    if (stat.isFile()) {
      if (extensions.some(ext => absDir.endsWith(ext))) files.push(absDir);
      continue;
    }
    for (const entry of fs.readdirSync(absDir)) {
      const full: string = path.join(absDir, entry);
      if (fs.statSync(full).isFile() && extensions.some(ext => entry.endsWith(ext))) {
        files.push(full);
      }
    }
  }
  return files;
}

function relPath(absPath: string): string {
  return path.relative(ROOT, absPath);
}

function topDir(relativePath: string): string {
  return relativePath.split(path.sep)[0]!;
}

// ---------------------------------------------------------------------------
// Score: Modularity
// ---------------------------------------------------------------------------

function scoreModularity(libFiles: string[], allProdFiles: string[]): MetricResult {
  // 1. Fan-out: for each lib file, count requires to other project files
  const fanOuts: number[] = [];
  const crossBoundary: CrossBoundaryEdge[] = [];

  for (const f of allProdFiles) {
    try {
      const { ast } = parseFile(f);
      const reqs: string[] = extractRequires(ast);
      const rel: string = relPath(f);
      const srcDir: string = topDir(rel);
      let localFanOut = 0;

      for (const req of reqs) {
        // Skip node built-ins and npm packages
        if (!req.startsWith('.') && !req.startsWith('/')) continue;
        let resolved: string = path.resolve(path.dirname(f), req);
        // Handle .js -> .ts resolution
        if (resolved.endsWith('.js') && !fs.existsSync(resolved) && fs.existsSync(resolved.replace(/\.js$/, '.ts'))) {
          resolved = resolved.replace(/\.js$/, '.ts');
        }
        const basePath: string = resolved.replace(/\.(js|ts)$/, '');
        const resolvedRel: string = relPath(basePath + (fs.existsSync(basePath + '.ts') ? '.ts' : '.js'));

        // Count if it resolves to another project file
        if (fs.existsSync(resolved) || fs.existsSync(resolved + '.js') || fs.existsSync(resolved + '.ts')) {
          localFanOut++;
          const targetDir: string = topDir(resolvedRel);
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

  const avgFanOut: number = fanOuts.length > 0
    ? fanOuts.reduce((a, b) => a + b, 0) / fanOuts.length
    : 0;

  // 2. Path registry density
  let registryDensity = 0;
  const registryPath: string = path.join(ROOT, 'references', 'registries', 'path-registry.csv');
  if (fs.existsSync(registryPath)) {
    const csv: string[] = fs.readFileSync(registryPath, 'utf8').trim().split('\n').slice(1); // skip header
    const pathCounts = new Map<string, number>();
    for (const row of csv) {
      const cols: string[] = row.split(',');
      if (cols.length >= 2) {
        const p: string = cols[1]!;
        pathCounts.set(p, (pathCounts.get(p) || 0) + 1);
      }
    }
    if (pathCounts.size > 0) {
      registryDensity = [...pathCounts.values()].reduce((a, b) => a + b, 0) / pathCounts.size;
    }
  }

  const score: number = Math.max(0, Math.min(100,
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

function scoreEncapsulation(libFiles: string[]): MetricResult {
  const weightedExports: number[] = [];

  for (const f of libFiles) {
    try {
      const { ast } = parseFile(f);
      const { fnCount, constCount } = extractExportCount(ast);
      weightedExports.push(fnCount * 1.0 + constCount * 0.3);
    } catch {
      // Skip
    }
  }

  const avg: number = weightedExports.length > 0
    ? weightedExports.reduce((a, b) => a + b, 0) / weightedExports.length
    : 0;

  const score: number = Math.max(0, Math.min(100, 100 - (avg * 8)));

  return {
    score: round(score),
    sub: { avg_weighted_exports: round(avg) }
  };
}

// ---------------------------------------------------------------------------
// Score: Size Balance
// ---------------------------------------------------------------------------

function scoreSizeBalance(prodFiles: string[]): MetricResult {
  const locs: number[] = [];

  for (const f of prodFiles) {
    try {
      const content: string = fs.readFileSync(f, 'utf8');
      locs.push(content.split('\n').length);
    } catch {
      // Skip
    }
  }

  if (locs.length === 0) return { score: 100, sub: { max_median_ratio: 0, file_count: 0 } };

  locs.sort((a, b) => a - b);
  const median: number = locs[Math.floor(locs.length / 2)]!;
  const max: number = locs[locs.length - 1]!;
  const ratio: number = median > 0 ? max / median : 0;

  const score: number = Math.max(0, Math.min(100, 100 - (ratio * 5)));

  return {
    score: round(score),
    sub: { max_median_ratio: round(ratio), file_count: locs.length }
  };
}

// ---------------------------------------------------------------------------
// Score: Dependency Depth
// ---------------------------------------------------------------------------

function scoreDepDepth(libFiles: string[]): MetricResult {
  // Build adjacency list from require() calls
  const graph = new Map<string, string[]>();
  const fileSet = new Set<string>();

  for (const f of libFiles) {
    const rel: string = relPath(f);
    fileSet.add(rel);
    graph.set(rel, []);
  }

  for (const f of libFiles) {
    try {
      const { ast } = parseFile(f);
      const reqs: string[] = extractRequires(ast);
      const rel: string = relPath(f);

      for (const req of reqs) {
        if (!req.startsWith('.') && !req.startsWith('/')) continue;
        let resolved: string = path.resolve(path.dirname(f), req);
        if (!resolved.endsWith('.js') && !resolved.endsWith('.ts')) {
          resolved += fs.existsSync(resolved + '.ts') ? '.ts' : '.js';
        }
        // Handle .js -> .ts resolution (TS imports use .js extension but file is .ts)
        if (resolved.endsWith('.js') && !fs.existsSync(resolved) && fs.existsSync(resolved.replace(/\.js$/, '.ts'))) {
          resolved = resolved.replace(/\.js$/, '.ts');
        }
        const resolvedRel: string = relPath(resolved);
        if (fileSet.has(resolvedRel)) {
          graph.get(rel)!.push(resolvedRel);
        }
      }
    } catch {
      // Skip
    }
  }

  // DFS to find longest path (no memoization: graph is small, and memoization
  // produces wrong results when cycles exist because a node visited during cycle
  // detection gets cached as depth 0)
  function maxDepth(node: string, visited: Set<string>): number {
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

  const score: number = Math.max(0, Math.min(100, 100 - (globalMax * 15)));

  return {
    score: round(score),
    sub: { max_depth: globalMax }
  };
}

// ---------------------------------------------------------------------------
// Score: Cyclomatic Complexity
// ---------------------------------------------------------------------------

function scoreComplexity(prodFiles: string[]): MetricResult {
  const allFunctions: FunctionComplexityWithFile[] = [];

  for (const f of prodFiles) {
    try {
      const { ast } = parseFile(f);
      const fns: FunctionComplexity[] = computeComplexity(ast);
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
  const trivialCount: number = allFunctions.filter(f => f.complexity === 1).length;
  const nonTrivial: FunctionComplexityWithFile[] = allFunctions.filter(f => f.complexity > 1);

  // Use non-trivial functions for avg, fall back to all if everything is trivial
  const scoredFns: FunctionComplexityWithFile[] = nonTrivial.length > 0 ? nonTrivial : allFunctions;
  const complexities: number[] = scoredFns.map(f => f.complexity);
  const avg: number = complexities.reduce((a, b) => a + b, 0) / complexities.length;

  // Use p90 (90th percentile) instead of raw max so a single outlier function
  // doesn't dominate the entire score
  complexities.sort((a, b) => a - b);
  const p90Index: number = Math.floor(complexities.length * 0.9);
  const p90: number = complexities[Math.min(p90Index, complexities.length - 1)]!;
  const maxVal: number = complexities[complexities.length - 1]!;
  const maxFn: FunctionComplexityWithFile | undefined = allFunctions.find(f => f.complexity === maxVal);

  const score: number = Math.max(0, Math.min(100,
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

function scoreTestSync(libFiles: string[]): MetricResult {
  let covered = 0;
  const total: number = libFiles.length;

  for (const f of libFiles) {
    const ext: string = path.extname(f);
    const base: string = path.basename(f, ext);
    const testPathTs: string = path.join(ROOT, 'web', 'test', `${base}.test.ts`);
    const testPathJs: string = path.join(ROOT, 'web', 'test', `${base}.test.js`);
    if (fs.existsSync(testPathTs) || fs.existsSync(testPathJs)) covered++;
  }

  const pct: number = total > 0 ? (covered / total) * 100 : 100;

  return {
    score: round(pct),
    sub: { covered: `${covered}/${total}` }
  };
}

// ---------------------------------------------------------------------------
// Score: References Health
// ---------------------------------------------------------------------------

const STALE_DAYS: number = 180;
const STALE_MS: number = STALE_DAYS * 24 * 3600 * 1000;

function scoreReferencesHealth(rootDir: string): MetricResult {
  const refsDir: string = path.join(rootDir, 'references');
  const indexPath: string = path.join(refsDir, 'registries', 'agent-index.md');

  if (!fs.existsSync(refsDir) || !fs.existsSync(indexPath)) {
    return {
      score: 0,
      sub: { unlisted_files: 0, missing_targets: 0, stale_files: 0, error: 'references/ or agent-index.md missing' }
    };
  }

  // Walk references/** for all files.
  function walkAll(dir: string, out: string[]): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full: string = path.join(dir, entry.name);
      if (entry.isDirectory()) walkAll(full, out);
      else if (entry.isFile()) out.push(full);
    }
  }
  const allFiles: string[] = [];
  walkAll(refsDir, allFiles);

  const indexContent: string = fs.readFileSync(indexPath, 'utf8');

  // Count unlisted files. The agent-index file itself is exempt.
  let unlistedFiles = 0;
  let staleFiles = 0;
  const now: number = Date.now();
  for (const abs of allFiles) {
    const rel: string = path.relative(rootDir, abs);
    if (rel === path.relative(rootDir, indexPath)) continue;
    if (!indexContent.includes(rel)) unlistedFiles++;
    try {
      const stat: fs.Stats = fs.statSync(abs);
      if (now - stat.mtimeMs > STALE_MS) staleFiles++;
    } catch {
      // ignore
    }
  }

  // Find every backtick-quoted path in the index that starts with references/
  // and check if it exists on disk.
  let missingTargets = 0;
  const matches: RegExpMatchArray | null = indexContent.match(/`(references\/[^`]+)`/g);
  if (matches) {
    for (const raw of matches) {
      const p: string = raw.replace(/`/g, '');
      // Skip glob/template patterns
      if (p.includes('*') || p.includes('{')) continue;
      const abs: string = path.join(rootDir, p);
      if (!fs.existsSync(abs)) missingTargets++;
    }
  }

  const penalty: number = (unlistedFiles * 10) + (missingTargets * 10) + (staleFiles * 5);
  const score: number = Math.max(0, 100 - penalty);

  return {
    score: round(score),
    sub: {
      unlisted_files: unlistedFiles,
      missing_targets: missingTargets,
      stale_files: staleFiles
    }
  };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function printReport(scores: HealthScores, composite: number): void {
  console.log('--- code-health ---');
  const order: (keyof HealthScores)[] = ['modularity', 'encapsulation', 'size_balance', 'dep_depth', 'complexity', 'test_sync', 'references_health'];
  for (const key of order) {
    const s: MetricResult = scores[key];
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

interface HealthReport {
  scores: HealthScores;
  composite: number;
}

function main(): HealthReport {
  const weights: Weights = loadWeights();

  const libFiles: string[] = discoverFiles(['web/lib'], ['.js', '.ts']);
  const prodFiles: string[] = discoverFiles(
    ['web/lib', 'web/server.ts', 'web/public', '.claude/hooks', 'scripts'],
    ['.js', '.ts']
  );
  // Exclude this script itself from production analysis
  const filteredProd: string[] = prodFiles.filter(f => relPath(f) !== 'scripts/code-health.js' && relPath(f) !== 'scripts/code-health.ts');

  const scores: HealthScores = {
    modularity: scoreModularity(libFiles, filteredProd),
    encapsulation: scoreEncapsulation(libFiles),
    size_balance: scoreSizeBalance(filteredProd),
    dep_depth: scoreDepDepth(libFiles),
    complexity: scoreComplexity(filteredProd),
    test_sync: scoreTestSync(libFiles),
    references_health: scoreReferencesHealth(ROOT)
  };

  const composite: number = Object.entries(weights)
    .reduce((sum, [k, w]) => sum + (scores[k as keyof HealthScores] ? scores[k as keyof HealthScores].score : 0) * w, 0);

  printReport(scores, round(composite));

  return { scores, composite: round(composite) };
}

// Run if called directly
if (require.main === module) {
  main();
}

export {
  parseFile, walk, extractRequires, extractExportCount, computeComplexity,
  discoverFiles, scoreModularity, scoreEncapsulation, scoreSizeBalance,
  scoreDepDepth, scoreComplexity, scoreTestSync, scoreReferencesHealth,
  loadWeights, main, round
};
