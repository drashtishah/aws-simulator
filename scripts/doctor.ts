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
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { spawnSync as realSpawnSync } from 'node:child_process';

// Injectable runner signature for integration checks so tests can stub
// subprocess execution without spawning real processes.
export type SpawnSyncLike = (
  cmd: string,
  args: string[],
  opts: any,
) => { status: number | null; stdout: string; stderr: string };

function defaultRunner(cmd: string, args: string[], opts: any): {
  status: number | null; stdout: string; stderr: string;
} {
  const r = realSpawnSync(cmd, args, { ...opts, encoding: 'utf8' });
  return {
    status: r.status,
    stdout: (r.stdout as unknown as string) || '',
    stderr: (r.stderr as unknown as string) || '',
  };
}

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
  // When true, runAll appends the 4 integration checks (sim-test smoke,
  // web-server boot, skill dangling refs, path-registry hash freshness)
  // after the required checks. Issue #105.
  runIntegration?: boolean;
  // Optional injected runner, used by tests to stub subprocess execution.
  runner?: SpawnSyncLike;
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
  // In a git worktree, .git is a file pointing to the worktree metadata; the
  // real hooks directory lives under the common git dir shared by all
  // worktrees. Resolve it via `git rev-parse --git-common-dir` so the check
  // works from both the main checkout and any worktree.
  let hooksDir = path.join(ctx.rootDir, '.git', 'hooks');
  try {
    const r = realSpawnSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: ctx.rootDir,
      encoding: 'utf8',
    });
    const out = ((r.stdout as unknown as string) || '').trim();
    if (r.status === 0 && out) {
      const resolved = path.isAbsolute(out) ? out : path.join(ctx.rootDir, out);
      hooksDir = path.join(resolved, 'hooks');
    }
  } catch {
    // fall back to .git/hooks
  }
  const dst = path.join(hooksDir, 'post-commit');
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
// Integration checks (Issue #105) - gated behind runIntegration flag
// ---------------------------------------------------------------------------

export function checkSimTestSmoke(
  ctx: CheckContext,
  runner: SpawnSyncLike = defaultRunner,
): CheckResult {
  const r = runner(
    'npx',
    ['tsx', 'scripts/sim-test.ts', 'run', '--files', 'web/test/path-registry.test.ts'],
    { cwd: ctx.rootDir, encoding: 'utf8', timeout: 30000 },
  );
  if (r.status === 0) {
    return { ok: true, name: 'sim_test_smoke', detail: 'sim-test smoke passed' };
  }
  return {
    ok: false,
    name: 'sim_test_smoke',
    detail: 'sim-test smoke failed; run `npm run test:file -- web/test/path-registry.test.ts` to diagnose',
  };
}

export function checkWebServerBoot(
  ctx: CheckContext,
  runner: SpawnSyncLike = defaultRunner,
): CheckResult {
  // macOS does not ship GNU `timeout`, so use a portable sh idiom: spawn
  // the server in the background, sleep, then SIGTERM and wait. Captures
  // both stdout and stderr so the port-3200 boot probe still works.
  const r = runner(
    'sh',
    [
      '-c',
      '( npx tsx web/server.ts & SRV=$!; sleep 12; kill $SRV 2>/dev/null; wait $SRV 2>/dev/null ) 2>&1',
    ],
    { cwd: ctx.rootDir, encoding: 'utf8', timeout: 20000 },
  );
  const out = (r.stdout || '') + (r.stderr || '');
  // web/server.ts emits "AWS Incident Simulator running at http://127.0.0.1:3200".
  // Match on the port number plus a boot-indicator keyword so the probe
  // survives minor message wording changes.
  if (/3200/.test(out) && /(listening|running|http:\/\/)/i.test(out)) {
    return { ok: true, name: 'web_server_boot', detail: 'web server booted on port 3200' };
  }
  return {
    ok: false,
    name: 'web_server_boot',
    detail:
      'web server did not emit a port-3200 boot line within 12s; check for port conflict on 3200 or run `npm run dev` manually to diagnose',
  };
}

// Fast smoke scan of every .claude/skills/**/SKILL.md for backtick-wrapped
// repo-path-like tokens and asserts each one resolves. This is intentionally
// lighter than scripts/code-health.ts's fuller dangling-reference scan; the
// two may diverge on edge cases (e.g. code-health resolves relative paths,
// this check is rootDir-anchored only). Keep simple here.
export function checkSkillDanglingRefs(ctx: CheckContext): CheckResult {
  const skillsDir = path.join(ctx.rootDir, '.claude', 'skills');
  if (!fs.existsSync(skillsDir)) {
    return { ok: true, name: 'skill_dangling_refs', detail: 'no .claude/skills directory' };
  }
  const skillFiles: string[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'SKILL.md') skillFiles.push(full);
    }
  }
  walk(skillsDir);

  const dangling: string[] = [];
  const tokenRe = /`([^`\n]+)`/g;
  for (const f of skillFiles) {
    const content = fs.readFileSync(f, 'utf8');
    let m: RegExpExecArray | null;
    while ((m = tokenRe.exec(content)) !== null) {
      const tok = m[1]!.trim();
      if (!tok.includes('/')) continue;
      if (/^https?:\/\//.test(tok)) continue;
      // Strip any ":line" suffix or trailing punctuation.
      const clean = tok.replace(/[),.;:]+$/, '').split(':')[0]!;
      if (!clean.includes('/')) continue;
      // Skip obvious non-paths (spaces, shell pipes, etc.)
      if (/[\s|<>]/.test(clean)) continue;
      // Skip template placeholders and glob patterns; these aren't literal
      // filesystem paths (e.g. `sims/{id}/manifest.json`, `logs/*.txt`).
      if (/[{}*?]/.test(clean)) continue;
      // Skip slash commands like `/fix`, `/play`, `/setup` — these look
      // like absolute paths but are Claude Code command names.
      if (clean.startsWith('/')) continue;
      // Only treat tokens whose final segment has a file extension as
      // literal filesystem references. Bare directory placeholders like
      // `findings/` or section shorthand like `decisions/` are
      // documentation structure, not paths to resolve.
      const lastSeg = clean.replace(/\/+$/, '').split('/').pop() || '';
      if (!/\.[a-zA-Z0-9]+$/.test(lastSeg)) continue;
      // Skip gitignored runtime-generated trees. These paths are created
      // by /setup, npm install, or sim runs, and legitimately do not
      // exist on a fresh checkout (e.g. `learning/catalog.csv`,
      // `node_modules/.bin`, `dist/index.js`). Mirrors the skip list in
      // web/test/path-registry.test.ts.
      if (
        clean.startsWith('learning/') ||
        clean.startsWith('node_modules/') ||
        clean.startsWith('dist/') ||
        clean.startsWith('web/test-results/') ||
        clean.startsWith('.claude/plans/') ||
        clean.startsWith('.claude/state/') ||
        clean.startsWith('.claude/worktrees/')
      ) continue;
      const abs = path.join(ctx.rootDir, clean);
      if (!fs.existsSync(abs)) {
        dangling.push(path.relative(ctx.rootDir, f) + ' -> `' + clean + '`');
      }
    }
  }
  if (dangling.length > 0) {
    return {
      ok: false,
      name: 'skill_dangling_refs',
      detail: 'dangling skill refs: ' + dangling.slice(0, 5).join('; ') +
        (dangling.length > 5 ? ' (+' + (dangling.length - 5) + ' more)' : ''),
    };
  }
  return {
    ok: true,
    name: 'skill_dangling_refs',
    detail: skillFiles.length + ' SKILL.md file(s) scanned, no dangling refs',
  };
}

export function checkPathRegistryHashFresh(
  ctx: CheckContext,
  runner: SpawnSyncLike = defaultRunner,
): CheckResult {
  const csvPath = path.join(ctx.rootDir, PATH_REGISTRY_REL);
  if (!fs.existsSync(csvPath)) {
    return {
      ok: false,
      name: 'path_registry_hash',
      detail: 'missing ' + PATH_REGISTRY_REL + '; run npm run extract-paths',
    };
  }
  const before = fs.readFileSync(csvPath);
  const beforeHash = crypto.createHash('sha256').update(before).digest('hex');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-path-registry-'));
  const backupPath = path.join(tmpDir, 'path-registry.csv.bak');
  fs.writeFileSync(backupPath, before);

  try {
    runner('python3', ['scripts/extract_paths.py'], {
      cwd: ctx.rootDir,
      encoding: 'utf8',
      timeout: 30000,
    });
    const after = fs.readFileSync(csvPath);
    const afterHash = crypto.createHash('sha256').update(after).digest('hex');
    if (beforeHash !== afterHash) {
      return {
        ok: false,
        name: 'path_registry_hash',
        detail: 'path-registry.csv is stale; run npm run extract-paths',
      };
    }
    return {
      ok: true,
      name: 'path_registry_hash',
      detail: 'path-registry.csv hash stable after extractor run',
    };
  } finally {
    // Always restore from backup, even if the runner threw.
    try {
      fs.writeFileSync(csvPath, fs.readFileSync(backupPath));
    } catch {
      // best effort
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
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
    const runner: SpawnSyncLike = opts.runner || defaultRunner;
    results.push(checkSimTestSmoke(ctx, runner));
    results.push(checkWebServerBoot(ctx, runner));
    results.push(checkSkillDanglingRefs(ctx));
    results.push(checkPathRegistryHashFresh(ctx, runner));
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
  checkSimTestSmoke,
  checkWebServerBoot,
  checkSkillDanglingRefs,
  checkPathRegistryHashFresh,
  formatCheckLine,
  runAll,
};
