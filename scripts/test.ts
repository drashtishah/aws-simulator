#!/usr/bin/env node
// test: CLI entry point for the testing system.
// Agents interact through commands only. This file is NEVER_WRITABLE.

import { Command } from 'commander';
import { execSync, spawnSync } from 'child_process';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

import * as evalRunner from './eval-runner';
import { filterByGlob, mapChangedToTests } from './test-select';
import {
  parseTestOutput,
  aggregateRuns,
  formatFailedFilesSummary,
  type FileRunResult,
} from './test-runner';

// ---------------------------------------------------------------------------
// Path constants
// ---------------------------------------------------------------------------

const ROOT: string = path.resolve(__dirname, '..');
const SPECS_DIR: string = path.join(ROOT, 'web', 'test-specs', 'browser');
const RESULTS_DIR: string = path.join(ROOT, 'web', 'test-results');

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface UnitResult {
  total: number;
  passed: number;
  failed: number;
  failedFiles?: string[];
  error?: string;
}

interface RunResults {
  command: string;
  ts: string;
  unit?: UnitResult;
  verdict?: string;
}

interface SpecEntry {
  file: string;
  name?: string;
  steps?: number;
  valid?: boolean;
  status?: string;
  error?: string;
}

interface AgentResults {
  command: string;
  ts: string;
  specs: SpecEntry[];
  error?: string;
  verdict?: string;
}

interface BrowserSpec {
  name: string;
  description: string;
  consoleAllowlist?: string[];
  network_allowed_origins?: string[];
  setup?: { navigate?: string };
  steps?: SpecStep[];
}

interface SpecTargetObject {
  landmarks?: string[];
}

interface SpecStep {
  id: string;
  action?: string;
  target?: string | SpecTargetObject;
  key?: string;
  text?: string;
  check?: SpecCheck[];
}

interface SpecCheck {
  type?: 'console_clean' | 'network_ok' | 'landmarks_present';
  selector?: string;
  [key: string]: unknown;
}

interface CategoryCounts {
  pass: number;
  fail: number;
  skip: number;
  pending: number;
}

interface LayerRunResult {
  ok: boolean;
  output: string;
  code?: number;
}

interface ValidateResults {
  command: string;
  ts: string;
  layers: Record<string, unknown>;
  verdict?: string;
}

interface SummaryData {
  command: string;
  ts: string;
  layers: Record<string, unknown>;
}

interface EvalsSummaryLayer {
  lastRun: string;
  simId: string;
  passed: number;
  failed: number;
  total: number;
  avgScore: number;
  runs: number;
}

interface EvalHistoryEntry {
  ts: string;
  simId: string;
  passed: number;
  failed: number;
  total: number;
}

interface ContentResults {
  command: string;
  ts: string;
  simId: string;
  pass?: boolean;
  findings?: ContentFinding[];
  usage?: { input_tokens: number; output_tokens: number } | null;
  error?: string | null;
}

interface ContentFinding {
  dimension: string;
  pass: boolean;
  detail?: string;
}

interface AgentCheckResultLike {
  pass: boolean;
  findings?: ContentFinding[];
  usage?: { input_tokens: number; output_tokens: number } | null;
  error?: string | null;
}

interface RegistrySim {
  id: string;
  [key: string]: unknown;
}

interface Registry {
  sims: RegistrySim[];
}

interface JsonOpts {
  json?: boolean;
}

interface RunOpts extends JsonOpts {
  files?: string;
  changed?: boolean;
}

interface AgentOpts extends JsonOpts {
  spec?: string;
  dryRun?: boolean;
}


interface EvalsOpts extends JsonOpts {
  sim?: string;
  llm?: boolean;
  model?: string;
  dryRun?: boolean;
}

interface ValidateOpts extends JsonOpts {
  quick?: boolean;
}

interface AllCheckEntry {
  name: string;
  fn: () => Promise<AgentCheckResultLike>;
}

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

const program = new Command();

program
  .name('test')
  .description('AWS Incident Simulator test CLI')
  .version('1.0.0');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonOut(flag: boolean | undefined, data: unknown): void {
  if (flag) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  }
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function timestamp(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// test run
// ---------------------------------------------------------------------------

program
  .command('run')
  .description('Run deterministic tests (all, or a filtered subset)')
  .option('--json', 'Output structured JSON')
  .option('--files <glob>', 'Run only test files matching the glob (relative to repo root)')
  .option('--changed', 'Run tests affected by git diff --name-only HEAD~1 HEAD')
  .action(async (opts: RunOpts) => {
    const results: RunResults = { command: 'run', ts: timestamp() };
    let exitCode = 0;

    // Run each test file in its own tsx process to avoid tsx hanging
    // when multiple test files share a single process.
    {
      const testDir = path.join(ROOT, 'web', 'test');
      const allTests = fs.readdirSync(testDir)
        .filter((f: string) => f.endsWith('.test.ts'))
        .map((f: string) => path.posix.join('web', 'test', f));

      let selected: string[] = allTests;

      if (opts.files) {
        selected = filterByGlob(allTests, opts.files);
        if (!opts.json) {
          console.log('  --files ' + opts.files + ': ' + selected.length + ' matched');
        }
        if (selected.length === 0) {
          if (!opts.json) console.log('  no test files matched, nothing to run');
          results.unit = { total: 0, passed: 0, failed: 0 };
          results.verdict = 'PASS';
          jsonOut(opts.json, results);
          if (!opts.json) console.log('  ' + results.verdict);
          process.exit(0);
        }
      } else if (opts.changed) {
        let changed: string[] = [];
        try {
          const diffOut = execSync('git diff --name-only HEAD~1 HEAD', {
            cwd: ROOT,
            encoding: 'utf8',
          });
          changed = diffOut.split('\n').map((s) => s.trim()).filter(Boolean);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          if (!opts.json) console.error('  git diff failed: ' + message);
          results.unit = { total: 0, passed: 0, failed: 0, error: 'git diff failed' };
          results.verdict = 'ERROR';
          jsonOut(opts.json, results);
          process.exit(2);
        }
        const allTestSet = new Set(allTests);
        const mapping = mapChangedToTests(changed, {
          hasTest: (rel) => allTestSet.has(rel),
        });
        for (const w of mapping.warnings) {
          if (!opts.json) console.log('  warning: ' + w);
        }
        selected = mapping.tests;
        if (!opts.json) {
          console.log('  --changed: ' + changed.length + ' files changed, ' +
            selected.length + ' test(s) selected');
        }
        if (selected.length === 0) {
          if (!opts.json) console.log('  no tests selected for changed files');
          results.unit = { total: 0, passed: 0, failed: 0 };
          results.verdict = 'PASS';
          jsonOut(opts.json, results);
          if (!opts.json) console.log('  ' + results.verdict);
          process.exit(0);
        }
      }

      const testsToRun = selected;
      const fileResults: FileRunResult[] = [];

      for (const testFile of testsToRun) {
        const result = spawnSync('tsx', ['--test', '--test-force-exit', testFile], {
          cwd: ROOT,
          encoding: 'utf8',
          timeout: 30000,
          maxBuffer: 5 * 1024 * 1024,
        });

        const out = (result.stdout ?? '') + (result.stderr ?? '');
        const { passed, failed } = parseTestOutput(out);
        const fileError = passed === 0 && failed === 0 && !result.signal;

        if (fileError && !opts.json) {
          console.error('  ' + path.basename(testFile) + ': ERROR');
          console.error(out.slice(0, 200));
        }
        if (failed > 0 && !opts.json) {
          console.error(
            '  FAIL ' + path.basename(testFile) + ': ' + failed + ' failure(s)',
          );
        }

        fileResults.push({ file: testFile, passed, failed, error: fileError });
      }

      const agg = aggregateRuns(fileResults);
      results.unit = { total: agg.total, passed: agg.passed, failed: agg.failed };
      if (agg.failedFiles.length > 0) {
        results.unit.failedFiles = agg.failedFiles;
      }
      if (agg.hasError && agg.total === 0) {
        results.unit.error = 'Infrastructure error';
        exitCode = 2;
      }
      if (agg.failed > 0) exitCode = 1;
      if (!opts.json) {
        console.log('  unit: ' + agg.passed + '/' + agg.total + ' passed');
        if (agg.failedFiles.length > 0) {
          process.stderr.write(formatFailedFilesSummary(agg.failedFiles));
        }
      }
    }

    results.verdict = exitCode === 0 ? 'PASS' : exitCode === 1 ? 'FAIL' : 'ERROR';
    jsonOut(opts.json, results);
    if (!opts.json) {
      console.log('  ' + results.verdict);
    }
    process.exit(exitCode);
  });

// ---------------------------------------------------------------------------
// test agent
// ---------------------------------------------------------------------------

program
  .command('agent')
  .description('Execute YAML browser specs via Chrome DevTools MCP')
  .option('--spec <prefix>', 'Run a single spec by name prefix')
  .option('--dry-run', 'Parse and print specs without executing')
  .option('--json', 'Output structured JSON')
  .action(async (opts: AgentOpts) => {
    const results: AgentResults = { command: 'agent', ts: timestamp(), specs: [] };
    let exitCode = 0;

    if (!fs.existsSync(SPECS_DIR)) {
      results.error = 'web/test-specs/browser/ directory not found';
      jsonOut(opts.json, results);
      if (!opts.json) console.log('Error: web/test-specs/browser/ not found');
      process.exit(2);
    }

    let files = fs.readdirSync(SPECS_DIR).filter((f: string) => f.endsWith('.yaml') || f.endsWith('.yml'));
    if (opts.spec) {
      files = files.filter((f: string) => f.startsWith(opts.spec!));
      if (files.length === 0) {
        results.error = 'No spec matching prefix "' + opts.spec + '"';
        jsonOut(opts.json, results);
        if (!opts.json) console.log('Error: no spec matching "' + opts.spec + '"');
        process.exit(2);
      }
    }

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(SPECS_DIR, file), 'utf8');
        const spec = yaml.load(content) as BrowserSpec;

        if (opts.dryRun) {
          const stepCount = spec.steps ? spec.steps.length : 0;
          results.specs.push({ file, name: spec.name, steps: stepCount, valid: true });
          if (!opts.json) {
            console.log('  ' + spec.name + ': ' + stepCount + ' steps (dry-run)');
          }
          continue;
        }

        // Print structured prompt for agent execution
        console.log('');
        console.log('--- SPEC: ' + spec.name + ' ---');
        console.log('Description: ' + spec.description);
        if (spec.setup?.navigate) {
          console.log('Setup: navigate to ' + spec.setup.navigate);
        }
        if (spec.consoleAllowlist && spec.consoleAllowlist.length > 0) {
          console.log('ConsoleAllowlist: ' + JSON.stringify(spec.consoleAllowlist));
        }
        if (spec.network_allowed_origins && spec.network_allowed_origins.length > 0) {
          console.log('NetworkAllowedOrigins: ' + JSON.stringify(spec.network_allowed_origins));
        }
        console.log('Steps:');
        for (const step of spec.steps ?? []) {
          console.log('  [' + step.id + ']');
          if (step.action) {
            const targetStr = typeof step.target === 'string'
              ? step.target
              : (step.target ? JSON.stringify(step.target) : (step.key ?? ''));
            console.log('    action: ' + step.action + ' ' + targetStr);
          }
          if (step.text) console.log('    text: "' + step.text + '"');
          if (step.check) {
            for (const c of step.check) {
              if (c.type === 'console_clean') {
                console.log('    check: console_clean (call list_console_messages, fail on level==error not in consoleAllowlist)');
              } else if (c.type === 'network_ok') {
                console.log('    check: network_ok (call list_network_requests, fail on status>=400 or origin not in network_allowed_origins)');
              } else if (c.type === 'landmarks_present') {
                const landmarks = (typeof step.target === 'object' && step.target?.landmarks) || [];
                console.log('    check: landmarks_present ' + JSON.stringify(landmarks) + ' (call take_snapshot, fail if any landmark missing)');
              } else {
                const checks = Object.entries(c)
                  .filter(([k]: [string, unknown]) => k !== 'selector' && k !== 'type')
                  .map(([k, v]: [string, unknown]) => k + '=' + JSON.stringify(v));
                console.log('    check: ' + (c.selector ?? '') + ' ' + checks.join(', '));
              }
            }
          }
        }
        console.log('--- END SPEC ---');
        console.log('');

        results.specs.push({
          file,
          name: spec.name,
          steps: (spec.steps ?? []).length,
          status: 'printed'
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        results.specs.push({ file, error: message });
        exitCode = 2;
        if (!opts.json) console.log('  ' + file + ': PARSE ERROR: ' + message);
      }
    }

    if (opts.dryRun) {
      results.verdict = exitCode === 0 ? 'VALID' : 'ERROR';
    } else {
      results.verdict = exitCode === 0 ? 'PRINTED' : 'ERROR';
    }

    jsonOut(opts.json, results);
    if (!opts.json && opts.dryRun) {
      console.log('  ' + results.verdict);
    }
    process.exit(exitCode);
  });

// ---------------------------------------------------------------------------
// test evals
// ---------------------------------------------------------------------------

program
  .command('evals')
  .description('Run Layer 4 eval scorecard against completed play sessions')
  .option('--sim <id>', 'Score a specific sim session')
  .option('--llm', 'Run LLM judgment checks (slower, costs tokens)')
  .option('--model <model>', 'Model for LLM checks', 'sonnet')
  .option('--dry-run', 'List all 60 checks by category without running')
  .option('--json', 'Output structured JSON')
  .action(async (opts: EvalsOpts) => {
    const spec = evalRunner.loadScoringSpec();
    const checks = evalRunner.allChecks(spec);

    if (opts.dryRun) {
      const byCategory: Record<string, typeof checks> = {};
      for (const c of checks) {
        const cat = c.category ?? 'uncategorized';
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat]!.push(c);
      }
      if (!opts.json) {
        console.log('Eval scorecard: ' + checks.length + ' checks in ' + Object.keys(byCategory).length + ' categories\n');
        for (const [cat, catChecks] of Object.entries(byCategory)) {
          console.log('  ' + cat + ' (' + catChecks!.length + '):');
          for (const c of catChecks!) {
            console.log('    ' + c.id + ': ' + c.rule + ' [' + c.requires + ']');
          }
        }
      }
      jsonOut(opts.json, { command: 'evals', mode: 'dry-run', checks: checks.length, categories: byCategory });
      process.exit(0);
    }

    // Find session to score
    let simId = opts.sim;
    if (!simId) {
      const sessions = evalRunner.listCompletedSessions();
      if (sessions.length === 0) {
        if (!opts.json) console.log('  No completed sessions found. Play a sim in playtester mode first.');
        jsonOut(opts.json, { command: 'evals', error: 'no completed sessions' });
        process.exit(0);
      }
      simId = sessions[Math.floor(Math.random() * sessions.length)];
    }

    if (!opts.json) console.log('Scoring session: ' + simId + '\n');

    const result = evalRunner.runScorecard(simId!);
    if (result.error) {
      if (!opts.json) console.log('  Error: ' + result.error);
      jsonOut(opts.json, result);
      process.exit(2);
    }

    // Report by category
    const byCategory: Record<string, CategoryCounts> = {};
    for (const r of result.results ?? []) {
      const cat = (r as { category?: string }).category ?? 'uncategorized';
      if (!byCategory[cat]) byCategory[cat] = { pass: 0, fail: 0, skip: 0, pending: 0 };
      if (r.status === 'pass') byCategory[cat]!.pass++;
      else if (r.status === 'fail') byCategory[cat]!.fail++;
      else if (r.status === 'skipped') byCategory[cat]!.skip++;
      else if (r.status === 'pending_llm') byCategory[cat]!.pending++;
    }

    if (!opts.json) {
      for (const [cat, counts] of Object.entries(byCategory)) {
        const parts: string[] = [];
        if (counts!.pass) parts.push(counts!.pass + ' pass');
        if (counts!.fail) parts.push(counts!.fail + ' fail');
        if (counts!.skip) parts.push(counts!.skip + ' skip');
        if (counts!.pending) parts.push(counts!.pending + ' pending');
        console.log('  ' + cat + ': ' + parts.join(', '));
      }

      const resultsList = result.results ?? [];
      const total = resultsList.length;
      const passed = resultsList.filter((r) => r.status === 'pass').length;
      const failed = resultsList.filter((r) => r.status === 'fail').length;
      const skipped = resultsList.filter((r) => r.status === 'skipped').length;
      const pending = resultsList.filter((r) => r.status === 'pending_llm').length;
      console.log('\n  Total: ' + passed + '/' + total + ' pass, ' + failed + ' fail, ' + skipped + ' skip, ' + pending + ' pending_llm');

      if (failed > 0) {
        console.log('\n  Failed checks:');
        for (const r of resultsList.filter((r) => r.status === 'fail')) {
          console.log('    ' + r.id + ': ' + (r.reason ?? 'failed'));
        }
      }
    }

    // Persist results
    evalRunner.writeResult(simId!, result);
    evalRunner.appendHistory({
      ts: new Date().toISOString(),
      simId: simId!,
      passed: (result.results ?? []).filter((r) => r.status === 'pass').length,
      failed: (result.results ?? []).filter((r) => r.status === 'fail').length,
      total: (result.results ?? []).length
    });

    jsonOut(opts.json, { command: 'evals', ...result });

    const exitCode = (result.results ?? []).some((r) => r.status === 'fail') ? 1 : 0;
    process.exit(exitCode);
  });

// ---------------------------------------------------------------------------
// test validate
// ---------------------------------------------------------------------------

program
  .command('validate')
  .description('Run all 4 test layers in sequence')
  .option('--quick', 'Skip persona tests (layers 1-2-4 only)')
  .option('--json', 'Output structured JSON')
  .action(async (opts: ValidateOpts) => {
    const results: ValidateResults = { command: 'validate', ts: timestamp(), layers: {} };
    let overallExit = 0;

    function run(cmd: string, _label: string): LayerRunResult {
      try {
        const out = execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 300000 });
        return { ok: true, output: out };
      } catch (err: unknown) {
        const execErr = err as { stdout?: string; stderr?: string; status?: number };
        const code = execErr.status ?? 2;
        if (code > overallExit) overallExit = code;
        return { ok: false, output: (execErr.stdout ?? '') + (execErr.stderr ?? ''), code };
      }
    }

    // Layer 1: deterministic tests
    if (!opts.json) console.log('--- Layer 1: Deterministic Tests ---');
    const l1 = run('node scripts/test.js run --json', 'run');
    try { results.layers.run = JSON.parse(l1.output); } catch { results.layers.run = { raw: l1.output.slice(0, 500) }; }
    if (!opts.json) {
      const r = results.layers.run as Record<string, unknown>;
      const unit = r.unit as UnitResult | undefined;
      if (unit) console.log('  unit: ' + unit.passed + '/' + unit.total + ' passed');
      console.log('  ' + ((r.verdict as string) ?? 'UNKNOWN'));
    }

    // Layer 4: evals scorecard
    if (!opts.json) console.log('--- Layer 4: Evals (scorecard) ---');
    const completedSessions = evalRunner.listCompletedSessions();
    if (completedSessions.length > 0) {
      const l4 = run('node scripts/test.js evals --sim ' + completedSessions[0] + ' --json', 'evals');
      try { results.layers.evals = JSON.parse(l4.output); } catch { results.layers.evals = { raw: l4.output.slice(0, 500) }; }
      if (!opts.json) {
        const r = results.layers.evals as Record<string, unknown>;
        const evalResults = r.results as Array<{ status: string }> | undefined;
        if (evalResults) {
          const passed = evalResults.filter((x) => x.status === 'pass').length;
          const failed = evalResults.filter((x) => x.status === 'fail').length;
          console.log('  ' + passed + ' pass, ' + failed + ' fail');
        }
        console.log('  ' + (l4.ok ? 'PASS' : 'FAIL'));
      }
    } else {
      results.layers.evals = { skipped: true, reason: 'no completed sessions' };
      if (!opts.json) console.log('  Skipped (no completed sessions)');
    }

    // Layer 2: agent specs (dry-run only in validate)
    if (!opts.json) console.log('--- Layer 2: Agent Specs (dry-run) ---');
    const l2 = run('node scripts/test.js agent --dry-run --json', 'agent');
    try { results.layers.agent = JSON.parse(l2.output); } catch { results.layers.agent = { raw: l2.output.slice(0, 500) }; }
    if (!opts.json) {
      const r = results.layers.agent as Record<string, unknown>;
      const specs = r.specs as unknown[] | undefined;
      if (specs) console.log('  ' + specs.length + ' specs valid');
      console.log('  ' + ((r.verdict as string) ?? 'UNKNOWN'));
    }

    // Write summary
    const summaryPath = path.join(RESULTS_DIR, 'validate.json');
    ensureDir(RESULTS_DIR);
    results.verdict = overallExit === 0 ? 'PASS' : overallExit === 1 ? 'FAIL' : 'ERROR';
    fs.writeFileSync(summaryPath, JSON.stringify(results, null, 2) + '\n');

    jsonOut(opts.json, results);
    if (!opts.json) {
      console.log('--- Overall: ' + results.verdict + ' ---');
    }
    process.exit(overallExit);
  });

// ---------------------------------------------------------------------------
// test summary
// ---------------------------------------------------------------------------

program
  .command('summary')
  .description('Aggregate all results into summary.json')
  .option('--json', 'Output structured JSON')
  .action(async (opts: JsonOpts) => {
    ensureDir(RESULTS_DIR);
    const summary: SummaryData = { command: 'summary', ts: timestamp(), layers: {} };

    // Layer 4: evals scorecard
    const historyPath = path.join(ROOT, 'learning', 'logs', 'eval-history.jsonl');
    if (fs.existsSync(historyPath)) {
      const lines = fs.readFileSync(historyPath, 'utf8').split('\n').filter((l: string) => l.trim());
      const entries: EvalHistoryEntry[] = lines
        .map((l: string) => { try { return JSON.parse(l) as EvalHistoryEntry; } catch { return null; } })
        .filter((x): x is EvalHistoryEntry => x !== null);
      if (entries.length > 0) {
        const latest = entries[entries.length - 1]!;
        const evalSummary: EvalsSummaryLayer = {
          lastRun: latest.ts,
          simId: latest.simId,
          passed: latest.passed,
          failed: latest.failed,
          total: latest.total,
          avgScore: latest.total > 0 ? Math.round(latest.passed / latest.total * 100) : 0,
          runs: entries.length
        };
        summary.layers.evals = evalSummary;
      }
    } else {
      summary.layers.evals = { status: 'no eval history' };
    }

    // Layer 2: browser specs
    const browserDir = path.join(RESULTS_DIR, 'browser');
    if (fs.existsSync(browserDir)) {
      const files = fs.readdirSync(browserDir).filter((f: string) => f.endsWith('.json'));
      const specResults: unknown[] = [];
      for (const f of files) {
        try {
          specResults.push(JSON.parse(fs.readFileSync(path.join(browserDir, f), 'utf8')));
        } catch (_e: unknown) { /* skip malformed */ }
      }
      summary.layers.browser = { results: specResults.length, files };
    }

    const summaryPath = path.join(RESULTS_DIR, 'summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n');

    if (opts.json) {
      jsonOut(true, summary);
    } else {
      console.log('  Summary written to web/test-results/summary.json');
      const evalsLayer = summary.layers.evals as EvalsSummaryLayer & { status?: string } | undefined;
      if (evalsLayer && 'total' in evalsLayer && evalsLayer.total) {
        console.log('  evals: ' + evalsLayer.passed + ' passed, ' + evalsLayer.failed + ' failed (' + evalsLayer.runs + ' run(s))');
      } else if (evalsLayer) {
        console.log('  evals: ' + (evalsLayer.status ?? 'no history'));
      }
      const browserLayer = summary.layers.browser as { results: number } | undefined;
      if (browserLayer) {
        console.log('  browser: ' + browserLayer.results + ' result files');
      }
    }
    process.exit(0);
  });

program
  .command('content <simId>')
  .description('Validate sim content with agent-in-the-loop check (uses Sonnet)')
  .option('--json', 'Output structured JSON')
  .action(async (simId: string, opts: JsonOpts) => {
    const contentChecks = await import('./content-checks');
    const results: ContentResults = { command: 'content', ts: timestamp(), simId };

    // Validate simId exists
    const registryPath = path.join(__dirname, '..', 'sims', 'registry.json');
    const registry: Registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    const simExists = registry.sims.some((s: RegistrySim) => s.id === simId);
    if (!simExists) {
      console.error('Error: sim "' + simId + '" not found in registry');
      process.exit(2);
    }

    try {
      if (!opts.json) {
        console.log('\nContent validation: ' + simId + '\n');
      }

      const result = await contentChecks.runContentCheck(simId);
      results.pass = result.pass;
      results.findings = result.findings as ContentFinding[];
      results.usage = result.usage;
      results.error = result.error;

      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        const dimensions = [
          'summary', 'title', 'difficulty', 'services',
          'tags', 'category', 'learning_objectives'
        ];
        for (const dim of dimensions) {
          const f = (result.findings ?? []).find((f: ContentFinding) => f.dimension === dim);
          const status = f ? (f.pass ? 'PASS' : 'FAIL') : 'SKIP';
          const pad = '.'.repeat(Math.max(1, 22 - dim.length));
          console.log('  ' + dim + ' ' + pad + ' ' + status);
          if (f && !f.pass && f.detail) {
            console.log('    ' + f.detail);
          }
        }
        const passCount = (result.findings ?? []).filter((f: ContentFinding) => f.pass).length;
        const total = (result.findings ?? []).length;
        console.log('\n  result: ' + (result.pass ? 'PASS' : 'FAIL') + ' (' + passCount + '/' + total + ')');
        if (result.usage) {
          console.log('  tokens: ' + result.usage.input_tokens.toLocaleString() + ' in / ' + result.usage.output_tokens.toLocaleString() + ' out');
        }
        if (result.error) {
          console.log('  error: ' + result.error);
        }
      }

      // Write result file
      const resultsDir = path.join(__dirname, '..', 'web', 'test-results', 'content');
      if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
      const resultFile = path.join(resultsDir, simId + '-' + timestamp() + '.json');
      fs.writeFileSync(resultFile, JSON.stringify(results, null, 2));

      process.exit(result.pass ? 0 : 1);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Error: ' + message);
      if (opts.json) {
        results.error = message;
        console.log(JSON.stringify(results, null, 2));
      }
      process.exit(2);
    }
  });


// --- Agent test type commands ---

function formatAgentResults(result: AgentCheckResultLike, dimensions: string[]): void {
  for (const dim of dimensions) {
    const f = (result.findings ?? []).find((f: ContentFinding) => f.dimension === dim);
    const status = f ? (f.pass ? 'PASS' : 'FAIL') : 'SKIP';
    const pad = '.'.repeat(Math.max(1, 22 - dim.length));
    console.log('  ' + dim + ' ' + pad + ' ' + status);
    if (f && !f.pass && f.detail) {
      console.log('    ' + f.detail);
    }
  }
  const passCount = (result.findings ?? []).filter((f: ContentFinding) => f.pass).length;
  const total = (result.findings ?? []).length;
  console.log('\n  result: ' + (result.pass ? 'PASS' : 'FAIL') + ' (' + passCount + '/' + total + ')');
  if (result.usage) {
    console.log('  tokens: ' + result.usage.input_tokens.toLocaleString() + ' in / ' + result.usage.output_tokens.toLocaleString() + ' out');
  }
}

program
  .command('narrator-rules <simId>')
  .description('Validate narrator rule compliance (uses Sonnet)')
  .option('--json', 'Output structured JSON')
  .action(async (simId: string, opts: JsonOpts) => {
    const { runNarratorRulesCheck } = await import('./narrator-rule-checks');
    if (!opts.json) console.log('\nNarrator rules: ' + simId + '\n');
    const result = await runNarratorRulesCheck(simId);
    if (opts.json) {
      console.log(JSON.stringify({ command: 'narrator-rules', simId, ...result }, null, 2));
    } else {
      formatAgentResults(result, ['no_emojis', 'no_fourth_wall', 'console_format', 'no_premature_hints', 'voice_consistency', 'no_fix_criteria_leak']);
    }
    process.exit(result.pass ? 0 : 1);
  });

program
  .command('debrief <simId>')
  .description('Validate debrief quality (uses Sonnet)')
  .option('--json', 'Output structured JSON')
  .action(async (simId: string, opts: JsonOpts) => {
    const { runDebriefCheck } = await import('./debrief-checks');
    if (!opts.json) console.log('\nDebrief quality: ' + simId + '\n');
    const result = await runDebriefCheck(simId);
    if (opts.json) {
      console.log(JSON.stringify({ command: 'debrief', simId, ...result }, null, 2));
    } else {
      formatAgentResults(result, ['summary_brevity', 'seed_quality', 'zone_accuracy', 'no_new_info', 'voice_continuity']);
    }
    process.exit(result.pass ? 0 : 1);
  });

program
  .command('end-session <simId>')
  .description('Validate end-of-session compliance (uses Sonnet)')
  .option('--json', 'Output structured JSON')
  .action(async (simId: string, opts: JsonOpts) => {
    const { runEndSessionCheck } = await import('./end-session-checks');
    if (!opts.json) console.log('\nEnd-session compliance: ' + simId + '\n');
    const result = await runEndSessionCheck(simId);
    if (opts.json) {
      console.log(JSON.stringify({ command: 'end-session', simId, ...result }, null, 2));
    } else {
      formatAgentResults(result, ['no_play_another', 'session_complete_present', 'no_post_complete']);
    }
    process.exit(result.pass ? 0 : 1);
  });

program
  .command('hint-progression <simId>')
  .description('Validate hint progression logic (uses Sonnet)')
  .option('--json', 'Output structured JSON')
  .action(async (simId: string, opts: JsonOpts) => {
    const { runHintProgressionCheck } = await import('./hint-progression-checks');
    if (!opts.json) console.log('\nHint progression: ' + simId + '\n');
    const result = await runHintProgressionCheck(simId);
    if (opts.json) {
      console.log(JSON.stringify({ command: 'hint-progression', simId, ...result }, null, 2));
    } else {
      formatAgentResults(result, ['no_premature_hints', 'correct_ordering', 'skip_logic', 'natural_delivery']);
    }
    process.exit(result.pass ? 0 : 1);
  });

program
  .command('all <simId>')
  .description('Run all agent-in-the-loop checks (content + narrator-rules + debrief + end-session + hint-progression)')
  .option('--json', 'Output structured JSON')
  .action(async (simId: string, opts: JsonOpts) => {
    const contentChecks = await import('./content-checks');
    const { runNarratorRulesCheck } = await import('./narrator-rule-checks');
    const { runDebriefCheck } = await import('./debrief-checks');
    const { runEndSessionCheck } = await import('./end-session-checks');
    const { runHintProgressionCheck } = await import('./hint-progression-checks');

    const checks: AllCheckEntry[] = [
      { name: 'content', fn: () => contentChecks.runContentCheck(simId) },
      { name: 'narrator-rules', fn: () => runNarratorRulesCheck(simId) },
      { name: 'debrief', fn: () => runDebriefCheck(simId) },
      { name: 'end-session', fn: () => runEndSessionCheck(simId) },
      { name: 'hint-progression', fn: () => runHintProgressionCheck(simId) }
    ];

    const results: Record<string, AgentCheckResultLike> = {};
    let allPass = true;

    for (const check of checks) {
      if (!opts.json) console.log('\n--- ' + check.name + ' ---');
      try {
        const result = await check.fn();
        results[check.name] = result;
        if (!result.pass) allPass = false;
        if (!opts.json) {
          const passCount = (result.findings ?? []).filter((f: ContentFinding) => f.pass).length;
          const total = (result.findings ?? []).length;
          console.log('  ' + (result.pass ? 'PASS' : 'FAIL') + ' (' + passCount + '/' + total + ')');
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        results[check.name] = { pass: false, error: message, findings: [], usage: null };
        allPass = false;
        if (!opts.json) console.log('  ERROR: ' + message);
      }
    }

    if (opts.json) {
      console.log(JSON.stringify({ command: 'all', simId, pass: allPass, checks: results }, null, 2));
    } else {
      console.log('\n=== Overall: ' + (allPass ? 'PASS' : 'FAIL') + ' ===');
    }
    process.exit(allPass ? 0 : 1);
  });

program.parse();
