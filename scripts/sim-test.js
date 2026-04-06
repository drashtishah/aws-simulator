#!/usr/bin/env node
// sim-test: CLI entry point for the testing system.
// Agents interact through commands only. This file is NEVER_WRITABLE.

const { Command } = require('commander');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const evalRunner = require('./eval-runner');

const ROOT = path.resolve(__dirname, '..');
const SPECS_DIR = path.join(ROOT, 'web', 'test-specs', 'browser');
const PERSONAS_DIR = path.join(ROOT, 'web', 'test-specs', 'personas');
const RESULTS_DIR = path.join(ROOT, 'web', 'test-results');

const program = new Command();

program
  .name('sim-test')
  .description('AWS Incident Simulator test CLI')
  .version('1.0.0');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonOut(flag, data) {
  if (flag) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function timestamp() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// sim-test run
// ---------------------------------------------------------------------------

program
  .command('run')
  .description('Run all deterministic tests')
  .option('--json', 'Output structured JSON')
  .action(async (opts) => {
    const results = { command: 'run', ts: timestamp() };
    let exitCode = 0;

    try {
      const out = execSync('node --test web/test/*.test.js', {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 120000
      });
      const passMatch = out.match(/(?:# pass|ℹ pass) (\d+)/);
      const failMatch = out.match(/(?:# fail|ℹ fail) (\d+)/);
      const passed = passMatch ? parseInt(passMatch[1], 10) : 0;
      const failed = failMatch ? parseInt(failMatch[1], 10) : 0;
      results.unit = { total: passed + failed, passed, failed };
      if (failed > 0) exitCode = 1;
      if (!opts.json) {
        console.log('  unit: ' + passed + '/' + (passed + failed) + ' passed');
      }
    } catch (err) {
      const out = (err.stdout || '') + (err.stderr || '');
      const passMatch = out.match(/(?:# pass|ℹ pass) (\d+)/);
      const failMatch = out.match(/(?:# fail|ℹ fail) (\d+)/);
      const passed = passMatch ? parseInt(passMatch[1], 10) : 0;
      const failed = failMatch ? parseInt(failMatch[1], 10) : 0;
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
  .action(async (opts) => {
    const results = { command: 'agent', ts: timestamp(), specs: [] };
    let exitCode = 0;

    if (!fs.existsSync(SPECS_DIR)) {
      results.error = 'web/test-specs/browser/ directory not found';
      jsonOut(opts.json, results);
      if (!opts.json) console.log('Error: web/test-specs/browser/ not found');
      process.exit(2);
    }

    let files = fs.readdirSync(SPECS_DIR).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
    if (opts.spec) {
      files = files.filter(f => f.startsWith(opts.spec));
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
        const spec = yaml.load(content);

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
        if (spec.setup && spec.setup.navigate) {
          console.log('Setup: navigate to ' + spec.setup.navigate);
        }
        console.log('Steps:');
        for (const step of spec.steps || []) {
          console.log('  [' + step.id + ']');
          if (step.action) console.log('    action: ' + step.action + ' ' + (step.target || step.key || ''));
          if (step.text) console.log('    text: "' + step.text + '"');
          if (step.check) {
            for (const c of step.check) {
              const checks = Object.entries(c).filter(function(e) { return e[0] !== 'selector'; }).map(function(e) { return e[0] + '=' + JSON.stringify(e[1]); });
              console.log('    check: ' + c.selector + ' ' + checks.join(', '));
            }
          }
        }
        console.log('--- END SPEC ---');
        console.log('');

        results.specs.push({
          file,
          name: spec.name,
          steps: (spec.steps || []).length,
          status: 'printed'
        });
      } catch (err) {
        results.specs.push({ file, error: err.message });
        exitCode = 2;
        if (!opts.json) console.log('  ' + file + ': PARSE ERROR: ' + err.message);
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
  .action(async (opts) => {
    if (opts.feedback) {
      return handlePersonaFeedback(opts);
    }

    const results = { command: 'personas', ts: timestamp(), personas: [] };
    let exitCode = 0;

    if (!fs.existsSync(PERSONAS_DIR)) {
      results.error = 'web/test-specs/personas/ directory not found';
      jsonOut(opts.json, results);
      if (!opts.json) console.log('Error: web/test-specs/personas/ not found');
      process.exit(2);
    }

    let files = fs.readdirSync(PERSONAS_DIR).filter(f => f.endsWith('.json'));
    if (opts.id) {
      files = files.filter(f => f.replace('.json', '').startsWith(opts.id));
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
        const persona = JSON.parse(content);

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
      } catch (err) {
        results.personas.push({ file, error: err.message });
        exitCode = 2;
        if (!opts.json) console.log('  ' + file + ': PARSE ERROR: ' + err.message);
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

function handlePersonaFeedback(opts) {
  const personaResultsDir = path.join(RESULTS_DIR, 'personas');
  if (!fs.existsSync(personaResultsDir)) {
    if (opts.json) {
      jsonOut(true, { command: 'personas --feedback', error: 'No persona results found' });
    } else {
      console.log('No persona results found in web/test-results/personas/');
    }
    process.exit(0);
  }

  const files = fs.readdirSync(personaResultsDir).filter(f => f.endsWith('.json'));
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
      const data = JSON.parse(fs.readFileSync(path.join(personaResultsDir, file), 'utf8'));
      if (!data.findings || data.findings.length === 0) continue;

      for (const finding of data.findings) {
        findingsCount++;
        const dateStr = data.ts ? data.ts.split('T')[0] : new Date().toISOString().split('T')[0];
        feedbackContent += '\n## Persona finding: ' + data.persona + ' (' + dateStr + ')\n';
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
    } catch (err) {
      console.error('  Warning: could not parse ' + file + ': ' + err.message);
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
  .action(async (opts) => {
    const spec = evalRunner.loadScoringSpec();
    const checks = evalRunner.allChecks(spec);

    if (opts.dryRun) {
      const byCategory = {};
      for (const c of checks) {
        if (!byCategory[c.category]) byCategory[c.category] = [];
        byCategory[c.category].push(c);
      }
      if (!opts.json) {
        console.log('Eval scorecard: ' + checks.length + ' checks in ' + Object.keys(byCategory).length + ' categories\n');
        for (const [cat, catChecks] of Object.entries(byCategory)) {
          console.log('  ' + cat + ' (' + catChecks.length + '):');
          for (const c of catChecks) {
            console.log('    ' + c.id + ': ' + c.check + ' [' + c.requires + ']');
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

    const result = evalRunner.runScorecard(simId);
    if (result.error) {
      if (!opts.json) console.log('  Error: ' + result.error);
      jsonOut(opts.json, result);
      process.exit(2);
    }

    // Report by category
    const byCategory = {};
    for (const r of result.results) {
      if (!byCategory[r.category]) byCategory[r.category] = { pass: 0, fail: 0, skip: 0, pending: 0 };
      if (r.status === 'pass') byCategory[r.category].pass++;
      else if (r.status === 'fail') byCategory[r.category].fail++;
      else if (r.status === 'skipped') byCategory[r.category].skip++;
      else if (r.status === 'pending_llm') byCategory[r.category].pending++;
    }

    if (!opts.json) {
      for (const [cat, counts] of Object.entries(byCategory)) {
        const parts = [];
        if (counts.pass) parts.push(counts.pass + ' pass');
        if (counts.fail) parts.push(counts.fail + ' fail');
        if (counts.skip) parts.push(counts.skip + ' skip');
        if (counts.pending) parts.push(counts.pending + ' pending');
        console.log('  ' + cat + ': ' + parts.join(', '));
      }

      const total = result.results.length;
      const passed = result.results.filter(r => r.status === 'pass').length;
      const failed = result.results.filter(r => r.status === 'fail').length;
      const skipped = result.results.filter(r => r.status === 'skipped').length;
      const pending = result.results.filter(r => r.status === 'pending_llm').length;
      console.log('\n  Total: ' + passed + '/' + total + ' pass, ' + failed + ' fail, ' + skipped + ' skip, ' + pending + ' pending_llm');

      if (failed > 0) {
        console.log('\n  Failed checks:');
        for (const r of result.results.filter(r => r.status === 'fail')) {
          console.log('    ' + r.id + ': ' + (r.reason || 'failed'));
        }
      }
    }

    // Persist results
    evalRunner.writeResult(simId, result);
    evalRunner.appendHistory({
      ts: new Date().toISOString(),
      simId,
      passed: result.results.filter(r => r.status === 'pass').length,
      failed: result.results.filter(r => r.status === 'fail').length,
      total: result.results.length
    });

    jsonOut(opts.json, { command: 'evals', ...result });

    const exitCode = result.results.some(r => r.status === 'fail') ? 1 : 0;
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
  .action(async (opts) => {
    const results = { command: 'validate', ts: timestamp(), layers: {} };
    let overallExit = 0;

    function run(cmd, label) {
      try {
        const out = execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 300000 });
        return { ok: true, output: out };
      } catch (err) {
        const code = err.status || 2;
        if (code > overallExit) overallExit = code;
        return { ok: false, output: (err.stdout || '') + (err.stderr || ''), code };
      }
    }

    // Layer 1: deterministic tests
    if (!opts.json) console.log('--- Layer 1: Deterministic Tests ---');
    const l1 = run('node scripts/sim-test.js run --json', 'run');
    try { results.layers.run = JSON.parse(l1.output); } catch { results.layers.run = { raw: l1.output.slice(0, 500) }; }
    if (!opts.json) {
      const r = results.layers.run;
      if (r.unit) console.log('  unit: ' + r.unit.passed + '/' + r.unit.total + ' passed');
      console.log('  ' + (r.verdict || 'UNKNOWN'));
    }

    // Layer 4: evals scorecard
    if (!opts.json) console.log('--- Layer 4: Evals (scorecard) ---');
    const completedSessions = evalRunner.listCompletedSessions();
    if (completedSessions.length > 0) {
      const l4 = run('node scripts/sim-test.js evals --sim ' + completedSessions[0] + ' --json', 'evals');
      try { results.layers.evals = JSON.parse(l4.output); } catch { results.layers.evals = { raw: l4.output.slice(0, 500) }; }
      if (!opts.json) {
        const r = results.layers.evals;
        if (r.results) {
          const passed = r.results.filter(x => x.status === 'pass').length;
          const failed = r.results.filter(x => x.status === 'fail').length;
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
      const r = results.layers.agent;
      if (r.specs) console.log('  ' + r.specs.length + ' specs valid');
      console.log('  ' + (r.verdict || 'UNKNOWN'));
    }

    // Layer 3: personas (skip if --quick)
    if (!opts.quick) {
      if (!opts.json) console.log('--- Layer 3: Personas (dry-run) ---');
      const l3 = run('node scripts/sim-test.js personas --dry-run --json', 'personas');
      try { results.layers.personas = JSON.parse(l3.output); } catch { results.layers.personas = { raw: l3.output.slice(0, 500) }; }
      if (!opts.json) {
        const r = results.layers.personas;
        if (r.personas) console.log('  ' + r.personas.length + ' personas valid');
        console.log('  ' + (r.verdict || 'UNKNOWN'));
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
  .action(async (opts) => {
    ensureDir(RESULTS_DIR);
    const summary = { command: 'summary', ts: timestamp(), layers: {} };

    // Layer 4: evals scorecard
    const historyPath = path.join(ROOT, 'learning', 'logs', 'eval-history.jsonl');
    if (fs.existsSync(historyPath)) {
      const lines = fs.readFileSync(historyPath, 'utf8').split('\n').filter(l => l.trim());
      const entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      if (entries.length > 0) {
        const latest = entries[entries.length - 1];
        summary.layers.evals = {
          lastRun: latest.ts,
          simId: latest.simId,
          passed: latest.passed,
          failed: latest.failed,
          total: latest.total,
          avgScore: latest.total > 0 ? Math.round(latest.passed / latest.total * 100) : 0,
          runs: entries.length
        };
      }
    } else {
      summary.layers.evals = { status: 'no eval history' };
    }

    // Layer 2: browser specs
    const browserDir = path.join(RESULTS_DIR, 'browser');
    if (fs.existsSync(browserDir)) {
      const files = fs.readdirSync(browserDir).filter(f => f.endsWith('.json'));
      const specResults = [];
      for (const f of files) {
        try {
          specResults.push(JSON.parse(fs.readFileSync(path.join(browserDir, f), 'utf8')));
        } catch (e) { /* skip malformed */ }
      }
      summary.layers.browser = { results: specResults.length, files: files };
    }

    // Layer 3: persona findings
    const personaDir = path.join(RESULTS_DIR, 'personas');
    if (fs.existsSync(personaDir)) {
      const files = fs.readdirSync(personaDir).filter(f => f.endsWith('.json'));
      let totalFindings = 0;
      let highSeverity = 0;
      for (const f of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(personaDir, f), 'utf8'));
          if (data.findings) {
            totalFindings += data.findings.length;
            highSeverity += data.findings.filter(function(x) { return x.severity === 'high'; }).length;
          }
        } catch (e) { /* skip */ }
      }
      summary.layers.personas = { results: files.length, totalFindings: totalFindings, highSeverity: highSeverity };
    }

    const summaryPath = path.join(RESULTS_DIR, 'summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n');

    if (opts.json) {
      jsonOut(true, summary);
    } else {
      console.log('  Summary written to web/test-results/summary.json');
      if (summary.layers.evals && summary.layers.evals.total) {
        console.log('  evals: ' + summary.layers.evals.passed + ' passed, ' + summary.layers.evals.failed + ' failed (' + summary.layers.evals.runs + ' run(s))');
      } else if (summary.layers.evals) {
        console.log('  evals: ' + (summary.layers.evals.status || 'no history'));
      }
      if (summary.layers.browser) {
        console.log('  browser: ' + summary.layers.browser.results + ' result files');
      }
      if (summary.layers.personas) {
        console.log('  personas: ' + summary.layers.personas.totalFindings + ' findings (' + summary.layers.personas.highSeverity + ' high)');
      }
    }
    process.exit(0);
  });

program
  .command('content <simId>')
  .description('Validate sim content with agent-in-the-loop check (uses Sonnet)')
  .option('--json', 'Output structured JSON')
  .action(async (simId, opts) => {
    const contentChecks = require('./content-checks');
    const results = { command: 'content', ts: timestamp(), simId };

    // Validate simId exists
    const registryPath = path.join(__dirname, '..', 'sims', 'registry.json');
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    const simExists = registry.sims.some(s => s.id === simId);
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
      results.findings = result.findings;
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
          const f = (result.findings || []).find(f => f.dimension === dim);
          const status = f ? (f.pass ? 'PASS' : 'FAIL') : 'SKIP';
          const pad = '.'.repeat(Math.max(1, 22 - dim.length));
          console.log('  ' + dim + ' ' + pad + ' ' + status);
          if (f && !f.pass && f.detail) {
            console.log('    ' + f.detail);
          }
        }
        const passCount = (result.findings || []).filter(f => f.pass).length;
        const total = (result.findings || []).length;
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
    } catch (err) {
      console.error('Error: ' + err.message);
      if (opts.json) {
        results.error = err.message;
        console.log(JSON.stringify(results, null, 2));
      }
      process.exit(2);
    }
  });

program.parse();
