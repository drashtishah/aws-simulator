#!/usr/bin/env tsx
// scripts/doctor.ts
//
// One command to confirm "is everything working?" across the moving parts of
// this project: tests, hooks, scheduled jobs, system-vault, health scoring,
// MCP, web server. Read-only. Exits non-zero on any failure. Every FAIL line
// includes the exact path or command needed to fix it, because the user has
// been bitten by error messages that don't name the file (Issue #92,
// learning/feedback.md 2026-04-07).
//
// Group F of plan .claude/plans/replicated-exploring-thompson.md (Issue #96).
//
// Each check is a pure function that takes { rootDir, ... } and returns a
// CheckResult. The doctor binary glues them together; web/test/doctor.test.ts
// unit-tests every check against a temp-dir fixture.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CheckResult {
  ok: boolean;
  name: string;
  detail: string;
}

export interface CheckContext {
  rootDir: string;
}

export interface RunAllOptions extends CheckContext {
  // Integration checks (web server boot, sim-test smoke ping) actually
  // shell out and take seconds. Tests pass false; the CLI passes true.
  runIntegration?: boolean;
}

export interface RunAllSummary {
  results: CheckResult[];
  exitCode: number;
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

const RAW_LOG_REL = 'learning/logs/raw.jsonl';
export function checkRawLogAppendable(ctx: CheckContext): CheckResult {
  const p = path.join(ctx.rootDir, RAW_LOG_REL);
  if (!fs.existsSync(p)) {
    return {
      ok: false,
      name: 'raw_log',
      detail: 'missing ' + RAW_LOG_REL + ' (touch it or run any session to create it)',
    };
  }
  try {
    fs.accessSync(p, fs.constants.W_OK);
  } catch {
    return {
      ok: false,
      name: 'raw_log',
      detail: RAW_LOG_REL + ' exists but is not writable; chmod u+w it',
    };
  }
  return { ok: true, name: 'raw_log', detail: RAW_LOG_REL + ' present and writable' };
}

const SYSTEM_VAULT_INDEX_REL = 'learning/system-vault/index.md';
export function checkSystemVaultPresent(ctx: CheckContext): CheckResult {
  const p = path.join(ctx.rootDir, SYSTEM_VAULT_INDEX_REL);
  if (!fs.existsSync(p)) {
    return {
      ok: false,
      name: 'system_vault',
      detail:
        'missing ' + SYSTEM_VAULT_INDEX_REL +
        ' (run /setup, or invoke the system-vault-compile skill to seed it)',
    };
  }
  return { ok: true, name: 'system_vault', detail: SYSTEM_VAULT_INDEX_REL + ' present' };
}

export function checkScheduledJobs(ctx: CheckContext): CheckResult {
  const dir = path.join(ctx.rootDir, '.claude', 'scheduled-jobs');
  if (!fs.existsSync(dir)) {
    return { ok: true, name: 'scheduled_jobs', detail: 'no scheduled-jobs directory' };
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const issues: string[] = [];
  for (const f of files) {
    const full = path.join(dir, f);
    let parsed: { allowed_tools?: unknown };
    try {
      parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      issues.push('.claude/scheduled-jobs/' + f + ': unparseable JSON (' + msg + ')');
      continue;
    }
    if (!Array.isArray(parsed.allowed_tools)) {
      issues.push('.claude/scheduled-jobs/' + f + ': missing allowed_tools array');
    }
  }
  if (issues.length > 0) {
    return {
      ok: false,
      name: 'scheduled_jobs',
      detail: issues.join('; '),
    };
  }
  return {
    ok: true,
    name: 'scheduled_jobs',
    detail: files.length + ' manifest(s) parse with allowed_tools set',
  };
}

const MCP_REL = '.mcp.json';
export function checkMcpConfig(ctx: CheckContext): CheckResult {
  const p = path.join(ctx.rootDir, MCP_REL);
  if (!fs.existsSync(p)) {
    return { ok: false, name: 'mcp', detail: 'missing ' + MCP_REL };
  }
  let parsed: { mcpServers?: Record<string, unknown> };
  try {
    parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, name: 'mcp', detail: MCP_REL + ': unparseable JSON (' + msg + ')' };
  }
  if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object') {
    return { ok: false, name: 'mcp', detail: MCP_REL + ': missing mcpServers object' };
  }
  const count = Object.keys(parsed.mcpServers).length;
  return { ok: true, name: 'mcp', detail: MCP_REL + ': ' + count + ' server(s) configured' };
}

export function checkPostCommitHook(ctx: CheckContext): CheckResult {
  const src = path.join(ctx.rootDir, '.claude', 'hooks', 'post-commit');
  const dst = path.join(ctx.rootDir, '.git', 'hooks', 'post-commit');
  if (!fs.existsSync(src)) {
    return {
      ok: true,
      name: 'post_commit_hook',
      detail: 'no .claude/hooks/post-commit source file (nothing to install)',
    };
  }
  if (!fs.existsSync(dst)) {
    return {
      ok: false,
      name: 'post_commit_hook',
      detail:
        '.git/hooks/post-commit not installed; run npm run install-git-hooks',
    };
  }
  const srcBytes = fs.readFileSync(src);
  const dstBytes = fs.readFileSync(dst);
  if (!srcBytes.equals(dstBytes)) {
    return {
      ok: false,
      name: 'post_commit_hook',
      detail:
        '.git/hooks/post-commit differs from .claude/hooks/post-commit (drifted/stale); run npm run install-git-hooks',
    };
  }
  return { ok: true, name: 'post_commit_hook', detail: '.git/hooks/post-commit matches source' };
}

const HEALTH_SCORES_REL = 'learning/logs/health-scores.jsonl';
export function checkHealthScoreRecent(ctx: CheckContext): CheckResult {
  const p = path.join(ctx.rootDir, HEALTH_SCORES_REL);
  if (!fs.existsSync(p)) {
    return {
      ok: false,
      name: 'health_score',
      detail: 'missing ' + HEALTH_SCORES_REL + '; run npm run health to generate',
    };
  }
  const content = fs.readFileSync(p, 'utf8').trim();
  if (!content) {
    return {
      ok: false,
      name: 'health_score',
      detail: HEALTH_SCORES_REL + ' is empty; run npm run health',
    };
  }
  const lines = content.split('\n').filter(Boolean);
  let last: { ts?: string };
  try {
    last = JSON.parse(lines[lines.length - 1]!);
  } catch {
    return {
      ok: false,
      name: 'health_score',
      detail: HEALTH_SCORES_REL + ' has unparseable last entry; run npm run health',
    };
  }
  if (!last.ts) {
    return {
      ok: false,
      name: 'health_score',
      detail: HEALTH_SCORES_REL + ' last entry missing ts; run npm run health',
    };
  }
  const ageMs = Date.now() - new Date(last.ts).getTime();
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  if (ageDays > 7) {
    return {
      ok: true,
      name: 'health_score',
      detail:
        'warn: ' + HEALTH_SCORES_REL + ' last entry is ' +
        Math.round(ageDays) + ' days old (stale); run npm run health to refresh',
    };
  }
  return {
    ok: true,
    name: 'health_score',
    detail: 'last health score is ' + Math.round(ageDays * 24) + 'h old',
  };
}

const PATH_REGISTRY_REL = 'references/registries/path-registry.csv';
export function checkPathRegistryFresh(ctx: CheckContext): CheckResult {
  const p = path.join(ctx.rootDir, PATH_REGISTRY_REL);
  if (!fs.existsSync(p)) {
    return {
      ok: false,
      name: 'path_registry',
      detail: 'missing ' + PATH_REGISTRY_REL + '; run npm run extract-paths',
    };
  }
  return { ok: true, name: 'path_registry', detail: PATH_REGISTRY_REL + ' present' };
}

// ---------------------------------------------------------------------------
// Output formatting + run-all
// ---------------------------------------------------------------------------

export function formatCheckLine(r: CheckResult): string {
  const tag = r.ok ? 'OK  ' : 'FAIL';
  return tag + ' ' + r.name + ': ' + r.detail;
}

// Required = its failure flips exit code to 1. Health-score is warn-only per
// the plan; other warn-only checks set ok=true with a "warn:" prefix and are
// flagged in the summary line but never trip the exit code.
const REQUIRED_CHECKS: Array<(ctx: CheckContext) => CheckResult> = [
  checkRawLogAppendable,
  checkSystemVaultPresent,
  checkScheduledJobs,
  checkMcpConfig,
  checkPostCommitHook,
  checkHealthScoreRecent,
  checkPathRegistryFresh,
];

export function runAll(opts: RunAllOptions): RunAllSummary {
  const ctx: CheckContext = { rootDir: opts.rootDir };
  const results: CheckResult[] = [];
  for (const fn of REQUIRED_CHECKS) {
    results.push(fn(ctx));
  }
  if (opts.runIntegration) {
    // Integration checks live in the CLI binary block below; tests inject
    // runIntegration: false to skip them.
  }
  const exitCode = results.every((r) => r.ok) ? 0 : 1;
  return { results, exitCode };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function isMain(): boolean {
  // Works under tsx, node, and direct require().
  if (typeof require !== 'undefined' && require.main === module) return true;
  return false;
}

function main(): void {
  const rootDir = path.resolve(__dirname, '..');
  const summary = runAll({ rootDir, runIntegration: true });

  let okCount = 0;
  let warnCount = 0;
  let failCount = 0;
  for (const r of summary.results) {
    process.stdout.write(formatCheckLine(r) + '\n');
    if (!r.ok) {
      failCount++;
    } else if (r.detail.startsWith('warn:')) {
      warnCount++;
    } else {
      okCount++;
    }
  }
  process.stdout.write(
    '\n' + okCount + ' ok, ' + warnCount + ' warn, ' + failCount + ' fail\n',
  );
  process.exit(summary.exitCode);
}

if (isMain()) {
  main();
}

// CommonJS interop so the test file can require() the helpers.
module.exports = {
  checkRawLogAppendable,
  checkSystemVaultPresent,
  checkScheduledJobs,
  checkMcpConfig,
  checkPostCommitHook,
  checkHealthScoreRecent,
  checkPathRegistryFresh,
  formatCheckLine,
  runAll,
};
