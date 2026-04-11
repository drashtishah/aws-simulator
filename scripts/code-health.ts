#!/usr/bin/env node
'use strict';

import * as acorn from 'acorn';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

import { classify, BUCKETS, defaultBucketWeights } from './lib/classify';
import type { Bucket } from './lib/classify';
import {
  proseDuplication,
  danglingReferences,
  activityFreshness,
  skillOwnershipIntegrity,
} from './lib/graph-metrics';
import type {
  ScopedFile,
  ProseCluster,
  DanglingFinding,
  FreshnessFinding,
  OwnershipFinding,
} from './lib/graph-metrics';

const ROOT: string = path.resolve(__dirname, '..');
const HEALTH_LOG_PATH: string = path.join(ROOT, 'learning', 'logs', 'health-scores.jsonl');

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
// Layer 1: scope discovery via git ls-files + classify()
// ---------------------------------------------------------------------------

interface HealthIgnoreEntry { path: string; reason: string; }
interface MetricsConfigFull extends MetricsConfig {
  bucketWeights?: Record<Bucket, number>;
  healthignore?: HealthIgnoreEntry[];
  floors?: Record<string, number>;
}

/** Run `git ls-files` from ROOT and return repo-relative paths. */
export function gitLsFiles(rootDir: string = ROOT): string[] {
  const out = cp.execSync('git ls-files', { cwd: rootDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.trim().split('\n').filter(Boolean);
}

export function loadFullConfig(): MetricsConfigFull {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'metrics.config.json'), 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Discover and classify every tracked file. Returns:
 * - byBucket: bucket -> [paths]
 * - tracked: total tracked files
 * - classified: tracked count minus excluded (e.g. plans)
 * - ignored: paths matched by healthignore (with reasons)
 * - unclassifiedErrors: any path that is neither classified nor ignored.
 *   Non-empty list is a HARD failure (completeness invariant 1).
 */
export interface DiscoveryResult {
  byBucket: Record<Bucket, string[]>;
  tracked: number;
  classified: number;
  excluded: number;
  ignored: HealthIgnoreEntry[];
  unclassifiedErrors: string[];
}

export function discoverScope(
  files: string[] = gitLsFiles(),
  cfg: MetricsConfigFull = loadFullConfig()
): DiscoveryResult {
  const ignoreSet = new Set((cfg.healthignore || []).map(e => e.path));
  const byBucket: Record<Bucket, string[]> = Object.fromEntries(
    BUCKETS.map(b => [b, [] as string[]])
  ) as Record<Bucket, string[]>;
  const unclassifiedErrors: string[] = [];
  let excluded = 0;

  for (const f of files) {
    if (ignoreSet.has(f)) continue;
    const b = classify(f);
    if (b === null) {
      // classify() returns null for explicitly excluded paths (.claude/plans/).
      // For everything else, null is a hard failure surfaced as unclassifiedErrors.
      if (f.startsWith('.claude/plans/')) {
        excluded++;
        continue;
      }
      unclassifiedErrors.push(f);
      continue;
    }
    byBucket[b].push(f);
  }

  const classified = BUCKETS.reduce((sum, b) => sum + byBucket[b].length, 0);
  return {
    byBucket,
    tracked: files.length,
    classified,
    excluded,
    ignored: cfg.healthignore || [],
    unclassifiedErrors,
  };
}

// ---------------------------------------------------------------------------
// Layer 2: per-bucket scoring + completeness + composite
// ---------------------------------------------------------------------------

export interface BucketScore {
  bucket: Bucket;
  files: number;
  score: number;
  reason?: string;
  sub?: Record<string, number | string>;
}

export interface BucketScoreReport {
  scores: Record<Bucket, BucketScore>;
  weighted_avg: number;
  completeness: number;
  composite: number;
  tracked: number;
  classified: number;
}

/** Strict invariants. Each violation zeros the offending bucket and records a reason. */
export interface InvariantViolation {
  invariant: string;
  bucket?: Bucket;
  detail: string;
}

/** Count source LOC across a file list (skipping unreadable). */
function countLoc(files: string[]): number {
  let loc = 0;
  for (const f of files) {
    try {
      loc += fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').length;
    } catch { /* skip */ }
  }
  return loc;
}

/**
 * Invariant 3: test_loc / code_loc cannot decrease unless code_loc shrinks
 * proportionally. We compare against the most recent prior entry in
 * health-scores.jsonl. If the ratio drops AND code_loc did NOT shrink by at
 * least the same proportion, the test bucket is zeroed.
 */
function checkTestDensityInvariant(
  testLoc: number,
  codeLoc: number,
  prior: HistoryEntry | null
): InvariantViolation | null {
  if (!prior || !prior.test_loc || !prior.code_loc) return null;
  const oldRatio = prior.test_loc / Math.max(1, prior.code_loc);
  const newRatio = testLoc / Math.max(1, codeLoc);
  if (newRatio >= oldRatio - 0.001) return null;
  // Ratio dropped. Allow only if code shrank proportionally.
  if (codeLoc < prior.code_loc * (newRatio / oldRatio + 0.01)) return null;
  return {
    invariant: 'test_density',
    bucket: 'test',
    detail: `test/code ratio dropped ${oldRatio.toFixed(3)} -> ${newRatio.toFixed(3)} without proportional code shrink`,
  };
}

/**
 * Invariant 4: Per-bucket file count floor is monotonic. Going below floor
 * subtracts 10 points from the bucket score (advisory penalty, capped at one
 * per bucket per run) and records a `bucket_floor` violation. Floors only
 * ever rise, except when --rebase-floors is passed, in which case they snap
 * to the current count.
 */
function applyFloors(
  byBucket: Record<Bucket, string[]>,
  floors: Record<string, number>,
  rebase: boolean
): { newFloors: Record<string, number>; violations: InvariantViolation[] } {
  const newFloors: Record<string, number> = { ...floors };
  const violations: InvariantViolation[] = [];
  for (const b of BUCKETS) {
    const count = byBucket[b].length;
    const floor = floors[b] ?? 0;
    if (rebase) {
      newFloors[b] = count;
      continue;
    }
    if (count < floor) {
      violations.push({
        invariant: 'bucket_floor',
        bucket: b,
        detail: `bucket ${b} dropped from floor ${floor} to ${count}`,
      });
      // Floor stays; do not lower it.
      newFloors[b] = floor;
    } else if (count > floor) {
      newFloors[b] = count;
    }
  }
  return { newFloors, violations };
}

/**
 * Invariant 5: Every skill dir has an ownership.json AND every ownership.json
 * lives in a real skill dir.
 */
function checkOwnershipConsistency(): InvariantViolation[] {
  const skillsDir = path.join(ROOT, '.claude', 'skills');
  if (!fs.existsSync(skillsDir)) return [];
  const violations: InvariantViolation[] = [];
  const dirs = fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);
  for (const d of dirs) {
    const op = path.join(skillsDir, d, 'ownership.json');
    if (!fs.existsSync(op)) {
      violations.push({
        invariant: 'ownership_consistent',
        bucket: 'skill',
        detail: `skill ${d} missing ownership.json`,
      });
    }
  }
  return violations;
}

interface HistoryEntry {
  ts: string;
  composite: number;
  buckets: Record<string, number>;
  bucket_files?: Record<string, number>;
  code_loc?: number;
  test_loc?: number;
  completeness?: number;
  findings?: unknown[];
}

function readHistory(): HistoryEntry[] {
  if (!fs.existsSync(HEALTH_LOG_PATH)) return [];
  try {
    const lines = fs.readFileSync(HEALTH_LOG_PATH, 'utf8').trim().split('\n').filter(Boolean);
    return lines.map(l => JSON.parse(l) as HistoryEntry);
  } catch {
    return [];
  }
}

function appendHistory(entry: HistoryEntry): void {
  fs.mkdirSync(path.dirname(HEALTH_LOG_PATH), { recursive: true });
  fs.appendFileSync(HEALTH_LOG_PATH, JSON.stringify(entry) + '\n');
}

/**
 * Score a single bucket. Layer 1+2 keeps this lightweight: code/test get a
 * real score by reusing the existing 7 metrics (test bucket adds a density
 * check); other buckets default to 100 unless an invariant fires. Layers 3+4
 * (PR-D) will replace these defaults with frontmatter/manifest/freshness
 * checks.
 */
export function scoreBucket(
  bucket: Bucket,
  files: string[],
  context: { allCode: string[]; allTest: string[]; priorEntry: HistoryEntry | null }
): BucketScore {
  if (bucket === 'code') {
    const tsJsFiles = files.filter(f => /\.(ts|js)$/.test(f) && f !== 'scripts/code-health.ts');
    const abs = tsJsFiles.map(f => path.join(ROOT, f));
    const lib = abs.filter(f => f.includes(`${path.sep}web${path.sep}lib${path.sep}`));
    const mod = scoreModularity(lib, abs);
    const enc = scoreEncapsulation(lib);
    const sz = scoreSizeBalance(abs);
    const dep = scoreDepDepth(lib);
    const cx = scoreComplexity(abs);
    const sync = scoreTestSync(lib);
    const avg = (mod.score + enc.score + sz.score + dep.score + cx.score + sync.score) / 6;
    return {
      bucket,
      files: files.length,
      score: round(avg),
      sub: {
        modularity: mod.score,
        encapsulation: enc.score,
        size_balance: sz.score,
        dep_depth: dep.score,
        complexity: cx.score,
        test_sync: sync.score,
      },
    };
  }
  if (bucket === 'test') {
    const codeLoc = countLoc(context.allCode);
    const testLoc = countLoc(context.allTest);
    const ratio = codeLoc > 0 ? testLoc / codeLoc : 0;
    const violation = checkTestDensityInvariant(testLoc, codeLoc, context.priorEntry);
    if (violation) {
      return { bucket, files: files.length, score: 0, reason: violation.detail, sub: { test_loc: testLoc, code_loc: codeLoc, ratio: round(ratio) } };
    }
    // Score: 100 if ratio >= 0.5, scaled below.
    const score = Math.min(100, Math.max(0, ratio * 200));
    return { bucket, files: files.length, score: round(score), sub: { test_loc: testLoc, code_loc: codeLoc, ratio: round(ratio) } };
  }
  // Default per-bucket: presence-only score.
  return { bucket, files: files.length, score: files.length > 0 ? 100 : 100 };
}

// ---------------------------------------------------------------------------
// Layer 3+4: graph metrics + ranked findings (PR-D)
// ---------------------------------------------------------------------------

/** Unified ranked finding shape. Fight-team (PR-H) consumes this from --json. */
export interface RankedFinding {
  bucket: Bucket;
  metric: 'prose_duplication' | 'dangling_reference' | 'activity_freshness' | 'ownership_integrity';
  file: string;
  line: number;
  current_score: number;
  expected_gain_if_fixed: number;
  description: string;
}

/** Per-bucket point cost from Layer 3+4 metrics. */
export interface Layer34Result {
  perBucketCost: Record<string, number>;
  findings: RankedFinding[];
  prose: ProseCluster[];
  dangling: DanglingFinding[];
  freshness: FreshnessFinding[];
  ownership: OwnershipFinding[];
}

/**
 * Run all four Layer 3+4 metrics over the classified scope and return
 * a unified ranked findings list plus per-bucket point costs to apply
 * to bucket scores. Pure-ish: only reads file content via the metric
 * libraries; no global state.
 */
export function scoreLayer34(
  discovery: DiscoveryResult,
  scoresBefore: Record<Bucket, BucketScore>,
  rootDir: string = ROOT,
  now: number = Date.now()
): Layer34Result {
  // Build the ScopedFile list across every bucket.
  const scoped: ScopedFile[] = [];
  for (const b of BUCKETS) {
    for (const p of discovery.byBucket[b]) {
      scoped.push({ path: p, bucket: b, abs: path.join(rootDir, p) });
    }
  }
  const tracked = new Set<string>();
  for (const b of BUCKETS) for (const p of discovery.byBucket[b]) tracked.add(p);

  const prose = proseDuplication(scoped);
  const dangling = danglingReferences(scoped, tracked, rootDir);
  const freshness = activityFreshness(
    scoped,
    path.join(rootDir, 'learning', 'logs', 'raw.jsonl'),
    now,
    rootDir
  );
  const ownership = skillOwnershipIntegrity(path.join(rootDir, '.claude', 'skills'));

  // Per-metric per-bucket caps so a single noisy metric cannot tank a bucket.
  const PER_METRIC_CAP = 10;
  const metricCost: Record<string, Record<string, number>> = {
    prose_duplication: {},
    dangling_reference: {},
    activity_freshness: {},
    ownership_integrity: {},
  };
  const addCost = (metric: string, b: string, c: number): number => {
    const used = metricCost[metric]![b] || 0;
    const remaining = PER_METRIC_CAP - used;
    const applied = Math.max(0, Math.min(remaining, c));
    metricCost[metric]![b] = used + applied;
    return applied;
  };
  const perBucketCost: Record<string, number> = {};
  const findings: RankedFinding[] = [];

  function bucketOf(file: string): Bucket {
    const b = classify(file);
    return (b ?? 'reference') as Bucket;
  }

  // Prose duplication: cost belongs to the cluster's owning bucket.
  for (const c of prose) {
    const owner = bucketOf(c.cluster[0]!);
    const applied = addCost('prose_duplication', owner, c.score);
    perBucketCost[owner] = (perBucketCost[owner] || 0) + applied;
    for (const f of c.cluster) {
      findings.push({
        bucket: bucketOf(f),
        metric: 'prose_duplication',
        file: f,
        line: 1,
        current_score: scoresBefore[bucketOf(f)]?.score ?? 0,
        expected_gain_if_fixed: applied / c.cluster.length,
        description: `prose duplication cluster of ${c.cluster.length} files (Jaccard >= 0.4)`,
      });
    }
  }

  // Dangling references: cost = 1 per finding to source bucket, capped per bucket.
  for (const d of dangling) {
    const b = bucketOf(d.source);
    const applied = addCost('dangling_reference', b, 1);
    perBucketCost[b] = (perBucketCost[b] || 0) + applied;
    findings.push({
      bucket: b,
      metric: 'dangling_reference',
      file: d.source,
      line: d.line,
      current_score: scoresBefore[b]?.score ?? 0,
      expected_gain_if_fixed: applied,
      description: `unresolved link to ${d.target}`,
    });
  }

  // Activity freshness: per-bucket capped at 10 in the lib already.
  for (const f of freshness) {
    const applied = addCost('activity_freshness', f.bucket, -f.cost);
    perBucketCost[f.bucket] = (perBucketCost[f.bucket] || 0) + applied;
    findings.push({
      bucket: f.bucket as Bucket,
      metric: 'activity_freshness',
      file: f.path,
      line: 1,
      current_score: scoresBefore[f.bucket as Bucket]?.score ?? 0,
      expected_gain_if_fixed: applied,
      description: f.reason,
    });
  }

  // Ownership integrity: 2 per finding against skill bucket, capped at 10.
  // The file key includes the disputed dir when available so two findings
  // about different dirs claimed by the same skill set produce visually
  // distinct lines in the top-10 ranker (issue #71).
  for (const o of ownership) {
    const applied = addCost('ownership_integrity', 'skill', 2);
    perBucketCost.skill = (perBucketCost.skill || 0) + applied;
    const skillFile = o.skills[0]
      ? `.claude/skills/${o.skills[0]}/ownership.json`
      : '.claude/skills';
    const fileKey = o.dir ? `${skillFile} (${o.dir})` : skillFile;
    findings.push({
      bucket: 'skill',
      metric: 'ownership_integrity',
      file: fileKey,
      line: 1,
      current_score: scoresBefore.skill?.score ?? 0,
      expected_gain_if_fixed: applied,
      description: `${o.kind}: ${o.detail}`,
    });
  }

  // Sort findings by point impact descending, then file/line stable.
  findings.sort((a, b) => {
    if (b.expected_gain_if_fixed !== a.expected_gain_if_fixed) {
      return b.expected_gain_if_fixed - a.expected_gain_if_fixed;
    }
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.line - b.line;
  });

  return { perBucketCost, findings, prose, dangling, freshness, ownership };
}

export function scoreAllBuckets(
  discovery: DiscoveryResult,
  cfg: MetricsConfigFull,
  options: { rebaseFloors?: boolean } = {}
): { report: BucketScoreReport; floors: Record<string, number>; violations: InvariantViolation[]; layer34: Layer34Result } {
  const violations: InvariantViolation[] = [];

  // Invariant 1: every tracked file is classified or in healthignore.
  if (discovery.unclassifiedErrors.length > 0) {
    throw new Error(
      `code-health: ${discovery.unclassifiedErrors.length} tracked files are neither ` +
      `classified by classify() nor listed in healthignore. First few:\n  ` +
      discovery.unclassifiedErrors.slice(0, 10).join('\n  ')
    );
  }

  // Invariant 2: every healthignore entry has a non-empty reason.
  for (const e of (cfg.healthignore || [])) {
    if (!e.reason || typeof e.reason !== 'string' || e.reason.trim().length === 0) {
      throw new Error(`code-health: healthignore entry ${e.path} missing required "reason" field`);
    }
  }

  // Invariant 5: ownership consistency.
  violations.push(...checkOwnershipConsistency());

  // Invariant 4: floor monotonicity.
  const floorResult = applyFloors(discovery.byBucket, cfg.floors || {}, options.rebaseFloors === true);
  violations.push(...floorResult.violations);

  // Score each bucket.
  const history = readHistory();
  const priorEntry: HistoryEntry | null = history.length > 0 ? history[history.length - 1]! : null;
  const allCode = discovery.byBucket.code;
  const allTest = discovery.byBucket.test;
  const scores: Record<Bucket, BucketScore> = Object.fromEntries(
    BUCKETS.map(b => [b, scoreBucket(b, discovery.byBucket[b], { allCode, allTest, priorEntry })])
  ) as Record<Bucket, BucketScore>;

  // Apply violations. bucket_floor is advisory (-10, capped one per bucket
  // per run) so a single file deletion below floor no longer drags the whole
  // bucket score to zero. Other invariants retain hard-zero behavior.
  const floorPenalized = new Set<Bucket>();
  for (const v of violations) {
    if (!v.bucket || !scores[v.bucket]) continue;
    if (v.invariant === 'bucket_floor') {
      if (floorPenalized.has(v.bucket)) continue;
      floorPenalized.add(v.bucket);
      const prev = scores[v.bucket];
      const newScore = Math.max(0, round(prev.score - 10));
      const newReason = prev.reason ? `${prev.reason}; ${v.detail}` : v.detail;
      scores[v.bucket] = { ...prev, score: newScore, reason: newReason };
    } else {
      scores[v.bucket] = { ...scores[v.bucket], score: 0, reason: v.detail };
    }
  }

  // Layer 3+4: graph metrics + freshness. Subtract per-bucket costs from
  // bucket scores (clamped to >= 0). Findings list is returned for the
  // top-10 aggregation block.
  const layer34 = scoreLayer34(discovery, scores);
  for (const b of BUCKETS) {
    const cost = layer34.perBucketCost[b] || 0;
    if (cost > 0 && scores[b].score > 0) {
      scores[b] = { ...scores[b], score: Math.max(0, round(scores[b].score - cost)) };
    }
  }

  const weights = cfg.bucketWeights || defaultBucketWeights();
  const weighted_avg = BUCKETS.reduce((sum, b) => sum + scores[b].score * (weights[b] ?? 1 / BUCKETS.length), 0);
  // Completeness = (classified + excluded) / tracked. Plans (excluded) are
  // counted as "accounted for" so excluding them does not penalize. Anything
  // in unclassifiedErrors already throws above.
  const denom = discovery.tracked > 0 ? discovery.tracked : 1;
  const completeness = (discovery.classified + discovery.excluded) / denom;
  const completenessPct = completeness * 100;
  const composite = Math.min(weighted_avg, completenessPct);

  return {
    report: {
      scores,
      weighted_avg: round(weighted_avg),
      completeness: round(completeness),
      composite: round(composite),
      tracked: discovery.tracked,
      classified: discovery.classified,
    },
    floors: floorResult.newFloors,
    violations,
    layer34,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface HealthReport {
  scores: HealthScores;
  composite: number;
  buckets?: BucketScoreReport;
  violations?: InvariantViolation[];
}

function printBucketReport(r: BucketScoreReport, violations: InvariantViolation[]): void {
  console.log('--- buckets ---');
  for (const b of BUCKETS) {
    const s = r.scores[b];
    // Pre-advisory: any reason meant the bucket was hard-zeroed. Post-advisory:
    // bucket_floor sets a reason but leaves a positive score, so the label
    // tracks the actual score state instead of assuming ZERO.
    const tag = s.reason ? ` ${s.score === 0 ? 'ZERO' : 'WARN'}: ${s.reason}` : '';
    console.log(`${b}: ${s.score.toFixed(1)} (${s.files} files)${tag}`);
  }
  console.log(`weighted_avg: ${r.weighted_avg.toFixed(1)}`);
  console.log(`completeness: ${(r.completeness * 100).toFixed(1)}% (${r.classified}/${r.tracked})`);
  console.log(`composite: ${r.composite.toFixed(1)} (= min(weighted_avg, completeness*100))`);
  if (violations.length > 0) {
    console.log('--- invariant violations ---');
    for (const v of violations) console.log(`  ${v.invariant}${v.bucket ? `[${v.bucket}]` : ''}: ${v.detail}`);
  }
}

/** Render the PR-D aggregation block: composite delta, bucket deltas, top 10. */
export function printAggregation(
  current: BucketScoreReport,
  prior: HistoryEntry | null,
  findings: RankedFinding[]
): void {
  const priorComposite = prior ? prior.composite : current.composite;
  const delta = current.composite - priorComposite;
  const sign = delta >= 0 ? '+' : '';
  console.log('');
  console.log(`composite: ${current.composite.toFixed(1)} (was ${priorComposite.toFixed(1)}, ${sign}${delta.toFixed(1)})`);
  console.log(`completeness: ${(current.completeness * 100).toFixed(1)}% (${current.classified}/${current.tracked} files)`);
  console.log('');
  console.log('bucket          score   delta   top finding');
  for (const b of BUCKETS) {
    const s = current.scores[b];
    const priorScore = prior && prior.buckets ? (prior.buckets[b] ?? s.score) : s.score;
    const d = s.score - priorScore;
    const dSign = d >= 0 ? '+' : '';
    const top = findings.find(f => f.bucket === b);
    const topStr = top ? `${top.metric} ${top.file}:${top.line}` : '';
    console.log(`${b.padEnd(15)} ${s.score.toFixed(1).padStart(5)}   ${(dSign + d.toFixed(1)).padStart(5)}   ${topStr}`);
  }
  console.log('');
  console.log('top 10 findings by point impact:');
  for (const f of findings.slice(0, 10)) {
    const cost = `-${f.expected_gain_if_fixed.toFixed(1)}`.padStart(6);
    console.log(`  ${cost}  ${f.metric}  ${f.file}:${f.line}`);
  }
}

function main(args: string[] = process.argv.slice(2)): HealthReport {
  const rebaseFloors = args.includes('--rebase-floors');
  const wantJson = args.includes('--json');
  const weights: Weights = loadWeights();
  const cfg = loadFullConfig();

  // Legacy 7-metric scoring (preserved for downstream consumers).
  const libFiles: string[] = discoverFiles(['web/lib'], ['.js', '.ts']);
  const prodFiles: string[] = discoverFiles(
    ['web/lib', 'web/server.ts', 'web/public', '.claude/hooks', 'scripts'],
    ['.js', '.ts']
  );
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
  const legacyComposite: number = Object.entries(weights)
    .reduce((sum, [k, w]) => sum + (scores[k as keyof HealthScores] ? scores[k as keyof HealthScores].score : 0) * w, 0);

  // New: Layer 1+2 bucket scoring with completeness + invariants. Layer 3+4
  // (graph metrics + freshness + ownership) is computed inside scoreAllBuckets
  // and returned via layer34.
  const discovery = discoverScope(undefined, cfg);
  const { report: bucketReport, floors: newFloors, violations, layer34 } = scoreAllBuckets(discovery, cfg, { rebaseFloors });
  const priorHistoryEntry: HistoryEntry | null = (() => {
    const h = readHistory();
    return h.length > 0 ? h[h.length - 1]! : null;
  })();

  // Persist floors back into config if they moved up (or rebase requested).
  const floorsChanged = JSON.stringify(newFloors) !== JSON.stringify(cfg.floors || {});
  if (floorsChanged) {
    cfg.floors = newFloors;
    fs.writeFileSync(
      path.join(ROOT, 'scripts', 'metrics.config.json'),
      JSON.stringify(cfg, null, 2) + '\n'
    );
  }

  // Append a history entry for the test_density invariant + future trends.
  // Includes the top-10 ranked findings for doc consumption.
  appendHistory({
    ts: new Date().toISOString(),
    composite: bucketReport.composite,
    buckets: Object.fromEntries(BUCKETS.map(b => [b, bucketReport.scores[b].score])),
    bucket_files: Object.fromEntries(BUCKETS.map(b => [b, bucketReport.scores[b].files])),
    code_loc: countLoc(discovery.byBucket.code),
    test_loc: countLoc(discovery.byBucket.test),
    completeness: bucketReport.completeness,
    findings: layer34.findings.slice(0, 10),
  });

  if (wantJson) {
    console.log(JSON.stringify({
      legacy: { scores, composite: round(legacyComposite) },
      buckets: bucketReport,
      violations,
      findings: layer34.findings,
    }, null, 2));
  } else {
    printReport(scores, round(legacyComposite));
    printBucketReport(bucketReport, violations);
    printAggregation(bucketReport, priorHistoryEntry, layer34.findings);
  }

  return { scores, composite: bucketReport.composite, buckets: bucketReport, violations };
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
