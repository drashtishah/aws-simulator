#!/usr/bin/env node
// sim-test: CLI entry point for the testing system.
// Agents interact through commands only. This file is NEVER_WRITABLE.

import { Command } from 'commander';
import { execSync } from 'child_process';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

import * as evalRunner from './eval-runner';

// ---------------------------------------------------------------------------
// Path constants
// ---------------------------------------------------------------------------

const ROOT: string = path.resolve(__dirname, '..');
const SPECS_DIR: string = path.join(ROOT, 'web', 'test-specs', 'browser');
const PERSONAS_DIR: string = path.join(ROOT, 'web', 'test-specs', 'personas');
const RESULTS_DIR: string = path.join(ROOT, 'web', 'test-results');

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface UnitResult {
  total: number;
  passed: number;
  failed: number;
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

interface PersonaEntry {
  id?: string;
  file?: string;
  name?: string;
  behaviors?: number;
  questions?: number;
  valid?: boolean;
  status?: string;
  error?: string;
}

interface PersonasResults {
  command: string;
  ts: string;
  personas: PersonaEntry[];
  error?: string;
  verdict?: string;
}

interface BrowserSpec {
  name: string;
  description: string;
  setup?: { navigate?: string };
  steps?: SpecStep[];
}

interface SpecStep {
  id: string;
  action?: string;
  target?: string;
  key?: string;
  text?: string;
  check?: SpecCheck[];
}

interface SpecCheck {
  selector: string;
  [key: string]: unknown;
}

interface PersonaFile {
  id: string;
  name: string;
  role: string;
  description: string;
  session_minutes: number;
  behaviors: string[];
  focus_areas: string[];
  evaluation_questions: string[];
}

interface PersonaResultData {
  ts?: string;
  persona?: string;
  findings?: PersonaFinding[];
}

interface PersonaFinding {
  severity: string;
  category: string;
  description: string;
  reproduction?: string;
  suggested_guardrail?: string;
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

interface AgentOpts extends JsonOpts {
  spec?: string;
  dryRun?: boolean;
}

interface PersonasOpts extends JsonOpts {
  id?: string;
  dryRun?: boolean;
  feedback?: boolean;
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
  .name('sim-test')
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
// sim-test run
// ---------------------------------------------------------------------------

program
  .command('run')
  .description('Run all deterministic tests')
  .option('--json', 'Output structured JSON')
  .action(async (opts: JsonOpts) => {
    const results: RunResults = { command: 'run', ts: timestamp() };
    let exitCode = 0;

    try {
      const out = execSync('npx tsx --test web/test/*.test.js', {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 120000
      });
      const passMatch = out.match(/(?:# pass|ℹ pass) (\d+)/);
      const failMatch = out.match(/(?:# fail|ℹ fail) (\d+)/);
      const passed = passMatch ? parseInt(passMatch[1]!, 10) : 0;
      const failed = failMatch ? parseInt(failMatch[1]!, 10) : 0;
      results.unit = { total: passed + failed, passed, failed };
      if (failed > 0) exitCode = 1;
      if (!opts.json) {
        console.log('  unit: ' + passed + '/' + (passed + failed) + ' passed');
      }
    } catch (err: unknown) {
      const execErr = err as { stdout?: string; stderr?: string; status?: number };
      const out = (execErr.stdout ?? '') + (execErr.stderr ?? '');
      const passMatch = out.match(/(?:# pass|ℹ pass) (\d+)/);
      const failMatch = out.match(/(?:# fail|ℹ fail) (\d+)/);
      const passed = passMatch ? parseInt(passMatch[1]!, 10) : 0;
      const failed = failMatch ? parseInt(failMatch[1]!, 10) : 0;
      if (passed > 0 || failed > 0) {
        results.unit = { total: passed + failed, passed, failed };
        if (!opts.json) {
          console.log('  unit: ' + passed + '/' + (passed + failed) + ' passed');
        }
      } else {
        results.unit = { total: 0, passed: 0, failed: 0, error: 'Infrastructure error' };
        if (!opts.json) {
          console.log('  unit: INFRASTRUCTURE ERROR');
          console.error(out.slice(0, 500));
        }
        exitCode = 2;
      }
      if (failed > 0) exitCode = 1;
    }

    results.verdict = exitCode === 0 ? 'PASS' : exitCode === 1 ? 'FAIL' : 'ERROR';
    jsonOut(opts.json, results);
    if (!opts.json) {
      console.log('  ' + results.verdict);
    }
    process.exit(exitCode);
  });

// ---------------------------------------------------------------------------
// sim-test agent
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
        console.log('Steps:');
        for (const step of spec.steps ?? []) {
          console.log('  [' + step.id + ']');
          if (step.action) console.log('    action: ' + step.action + ' ' + (step.target ?? step.key ?? ''));
          if (step.text) console.log('    text: "' + step.text + '"');
          if (step.check) {
            for (const c of step.check) {
              const checks = Object.entries(c)
                .filter(([k]: [string, unknown]) => k !== 'selector')
                .map(([k, v]: [string, unknown]) => k + '=' + JSON.stringify(v));
              console.log('    check: ' + c.selector + ' ' + checks.join(', '));
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
// sim-test personas
// ---------------------------------------------------------------------------

program
  .command('personas')
  .description('Run all persona exploration sessions')
  .option('--id <persona>', 'Run a single persona by ID')
  .option('--dry-run', 'Parse and print personas without executing')
  .option('--feedback', 'Read findings and append to learning/feedback.md')
  .option('--json', 'Output structured JSON')
  .action(async (opts: PersonasOpts) => {
    if (opts.feedback) {
      return handlePersonaFeedback(opts);
    }

    const results: PersonasResults = { command: 'personas', ts: timestamp(), personas: [] };
    let exitCode = 0;

    if (!fs.existsSync(PERSONAS_DIR)) {
      results.error = 'web/test-specs/personas/ directory not found';
      jsonOut(opts.json, results);
      if (!opts.json) console.log('Error: web/test-specs/personas/ not found');
      process.exit(2);
    }

    let files = fs.readdirSync(PERSONAS_DIR).filter((f: string) => f.endsWith('.json'));
    if (opts.id) {
      files = files.filter((f: string) => f.replace('.json', '').startsWith(opts.id!));
      if (files.length === 0) {
        results.error = 'No persona matching ID "' + opts.id + '"';
        jsonOut(opts.json, results);
        if (!opts.json) console.log('Error: no persona matching "' + opts.id + '"');
        process.exit(2);
      }
    }

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(PERSONAS_DIR, file), 'utf8');
        const persona: PersonaFile = JSON.parse(content);

        if (opts.dryRun) {
          results.personas.push({
            id: persona.id,
            name: persona.name,
            behaviors: persona.behaviors.length,
            questions: persona.evaluation_questions.length,
            valid: true
          });
          if (!opts.json) {
            console.log('  ' + persona.id + ': ' + persona.behaviors.length + ' behaviors, ' + persona.evaluation_questions.length + ' questions (dry-run)');
          }
          continue;
        }

        // Print structured prompt for agent execution
        console.log('');
        console.log('--- PERSONA: ' + persona.name + ' ---');
        console.log('Role: ' + persona.role);
        console.log('Description: ' + persona.description);
        console.log('Session: ' + persona.session_minutes + ' minutes');
        console.log('');
        console.log('Behaviors:');
        for (const b of persona.behaviors) {
          console.log('  - ' + b);
        }
        console.log('');
        console.log('Focus areas: ' + persona.focus_areas.join(', '));
        console.log('');
        console.log('Evaluation questions:');
        for (const q of persona.evaluation_questions) {
          console.log('  - ' + q);
        }
        console.log('--- END PERSONA ---');
        console.log('');

        results.personas.push({
          id: persona.id,
          name: persona.name,
          status: 'printed'
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        results.personas.push({ file, error: message });
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

function handlePersonaFeedback(opts: PersonasOpts): void {
  const personaResultsDir = path.join(RESULTS_DIR, 'personas');
  if (!fs.existsSync(personaResultsDir)) {
    if (opts.json) {
      jsonOut(true, { command: 'personas --feedback', error: 'No persona results found' });
    } else {
      console.log('No persona results found in web/test-results/personas/');
    }
    process.exit(0);
  }

  const files = fs.readdirSync(personaResultsDir).filter((f: string) => f.endsWith('.json'));
  if (files.length === 0) {
    if (opts.json) {
      jsonOut(true, { command: 'personas --feedback', findings: 0 });
    } else {
      console.log('No persona result files found.');
    }
    process.exit(0);
  }

  const feedbackPath = path.join(ROOT, 'learning', 'feedback.md');
  let feedbackContent = '';
  if (fs.existsSync(feedbackPath)) {
    feedbackContent = fs.readFileSync(feedbackPath, 'utf8');
  }

  let findingsCount = 0;
  for (const file of files) {
    try {
      const data: PersonaResultData = JSON.parse(fs.readFileSync(path.join(personaResultsDir, file), 'utf8'));
      if (!data.findings || data.findings.length === 0) continue;

      for (const finding of data.findings) {
        findingsCount++;
        const dateStr = data.ts ? data.ts.split('T')[0] : new Date().toISOString().split('T')[0];
        feedbackContent += '\n## Persona finding: ' + (data.persona ?? 'unknown') + ' (' + dateStr + ')\n';
        feedbackContent += 'Severity: ' + finding.severity + '\n';
        feedbackContent += 'Category: ' + finding.category + '\n';
        feedbackContent += 'Issue: ' + finding.description + '\n';
        if (finding.reproduction) {
          feedbackContent += 'Repro: ' + finding.reproduction + '\n';
        }
        if (finding.suggested_guardrail) {
          feedbackContent += 'Suggested guardrail: ' + finding.suggested_guardrail + '\n';
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('  Warning: could not parse ' + file + ': ' + message);
    }
  }

  if (findingsCount > 0 && fs.existsSync(path.dirname(feedbackPath))) {
    fs.writeFileSync(feedbackPath, feedbackContent);
  }

  if (opts.json) {
    jsonOut(true, { command: 'personas --feedback', ts: timestamp(), findings: findingsCount });
  } else {
    console.log('  ' + findingsCount + ' findings appended to learning/feedback.md');
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// sim-test evals
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
// sim-test validate
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
    const l1 = run('node scripts/sim-test.js run --json', 'run');
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
      const l4 = run('node scripts/sim-test.js evals --sim ' + completedSessions[0] + ' --json', 'evals');
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
    const l2 = run('node scripts/sim-test.js agent --dry-run --json', 'agent');
    try { results.layers.agent = JSON.parse(l2.output); } catch { results.layers.agent = { raw: l2.output.slice(0, 500) }; }
    if (!opts.json) {
      const r = results.layers.agent as Record<string, unknown>;
      const specs = r.specs as unknown[] | undefined;
      if (specs) console.log('  ' + specs.length + ' specs valid');
      console.log('  ' + ((r.verdict as string) ?? 'UNKNOWN'));
    }

    // Layer 3: personas (skip if --quick)
    if (!opts.quick) {
      if (!opts.json) console.log('--- Layer 3: Personas (dry-run) ---');
      const l3 = run('node scripts/sim-test.js personas --dry-run --json', 'personas');
      try { results.layers.personas = JSON.parse(l3.output); } catch { results.layers.personas = { raw: l3.output.slice(0, 500) }; }
      if (!opts.json) {
        const r = results.layers.personas as Record<string, unknown>;
        const personas = r.personas as unknown[] | undefined;
        if (personas) console.log('  ' + personas.length + ' personas valid');
        console.log('  ' + ((r.verdict as string) ?? 'UNKNOWN'));
      }
    } else {
      results.layers.personas = { skipped: true };
      if (!opts.json) console.log('--- Layer 3: Personas (skipped, --quick) ---');
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
// sim-test summary
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

    // Layer 3: persona findings
    const personaDir = path.join(RESULTS_DIR, 'personas');
    if (fs.existsSync(personaDir)) {
      const files = fs.readdirSync(personaDir).filter((f: string) => f.endsWith('.json'));
      let totalFindings = 0;
      let highSeverity = 0;
      for (const f of files) {
        try {
          const data: PersonaResultData = JSON.parse(fs.readFileSync(path.join(personaDir, f), 'utf8'));
          if (data.findings) {
            totalFindings += data.findings.length;
            highSeverity += data.findings.filter((x: PersonaFinding) => x.severity === 'high').length;
          }
        } catch (_e: unknown) { /* skip */ }
      }
      summary.layers.personas = { results: files.length, totalFindings, highSeverity };
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
      const personasLayer = summary.layers.personas as { totalFindings: number; highSeverity: number } | undefined;
      if (personasLayer) {
        console.log('  personas: ' + personasLayer.totalFindings + ' findings (' + personasLayer.highSeverity + ' high)');
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
