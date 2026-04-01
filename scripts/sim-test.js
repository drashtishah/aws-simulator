#!/usr/bin/env node
// sim-test: CLI entry point for the testing system.
// Agents interact through commands only. This file is NEVER_WRITABLE.

const { Command } = require('commander');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');
const DESIGN_DIR = path.join(ROOT, 'design');
const SPECS_DIR = path.join(ROOT, 'test-specs', 'browser');
const PERSONAS_DIR = path.join(ROOT, 'test-specs', 'personas');
const RESULTS_DIR = path.join(ROOT, 'test-results');

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
  .description('Run all deterministic tests (unit + design contracts)')
  .option('--unit', 'Run unit tests only')
  .option('--design', 'Run design contract checks only')
  .option('--json', 'Output structured JSON')
  .action(async (opts) => {
    const results = { command: 'run', ts: timestamp() };
    let exitCode = 0;

    const runUnit = !opts.design || opts.unit;
    const runDesign = !opts.unit || opts.design;

    // Unit tests
    if (runUnit) {
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
    }

    // Design contract checks
    if (runDesign) {
      try {
        const contractsDir = path.join(DESIGN_DIR, 'contracts');
        const thresholdsPath = path.join(DESIGN_DIR, 'thresholds.json');

        if (!fs.existsSync(contractsDir) || !fs.existsSync(thresholdsPath)) {
          results.design = { total: 0, passed: 0, failed: 0, skipped: true };
          if (!opts.json) {
            console.log('  design: skipped (no contracts or thresholds found)');
          }
        } else {
          const contracts = fs.readdirSync(contractsDir).filter(f => f.endsWith('.json'));
          let designPassed = 0;
          let designFailed = 0;

          for (const file of contracts) {
            const contract = JSON.parse(fs.readFileSync(path.join(contractsDir, file), 'utf8'));
            if (contract.name && contract.elements) {
              designPassed++;
            } else {
              designFailed++;
            }
          }

          results.design = { total: contracts.length, passed: designPassed, failed: designFailed };
          if (designFailed > 0) exitCode = 1;
          if (!opts.json) {
            console.log('  design: ' + designPassed + '/' + contracts.length + ' contracts passed');
          }
        }
      } catch (err) {
        results.design = { total: 0, passed: 0, failed: 0, error: err.message };
        exitCode = 2;
        if (!opts.json) {
          console.log('  design: INFRASTRUCTURE ERROR');
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
// sim-test design
// ---------------------------------------------------------------------------

const designCmd = program
  .command('design')
  .description('Design reference management');

designCmd
  .command('generate')
  .description('Capture screenshots and a11y trees from live app')
  .option('--json', 'Output structured JSON')
  .action(async (opts) => {
    try {
      const scriptPath = path.join(ROOT, 'scripts', 'generate-design-refs.js');
      if (!fs.existsSync(scriptPath)) {
        if (opts.json) {
          jsonOut(true, { command: 'design generate', error: 'generate-design-refs.js not found' });
        } else {
          console.log('Error: scripts/generate-design-refs.js not found');
        }
        process.exit(2);
      }
      execSync('node "' + scriptPath + '"', { cwd: ROOT, stdio: 'inherit' });
      if (opts.json) {
        jsonOut(true, { command: 'design generate', ts: timestamp(), verdict: 'DONE' });
      }
    } catch (err) {
      if (opts.json) {
        jsonOut(true, { command: 'design generate', error: err.message });
      }
      process.exit(2);
    }
  });

designCmd
  .command('extract')
  .description('Parse Stitch HTML into contract JSON')
  .option('--json', 'Output structured JSON')
  .action(async (opts) => {
    try {
      const scriptPath = path.join(ROOT, 'scripts', 'extract-design-contracts.js');
      if (!fs.existsSync(scriptPath)) {
        if (opts.json) {
          jsonOut(true, { command: 'design extract', error: 'extract-design-contracts.js not found' });
        } else {
          console.log('Error: scripts/extract-design-contracts.js not found');
        }
        process.exit(2);
      }
      execSync('node "' + scriptPath + '"', { cwd: ROOT, stdio: 'inherit' });
      if (opts.json) {
        jsonOut(true, { command: 'design extract', ts: timestamp(), verdict: 'DONE' });
      }
    } catch (err) {
      if (opts.json) {
        jsonOut(true, { command: 'design extract', error: err.message });
      }
      process.exit(2);
    }
  });

designCmd
  .command('check')
  .description('Verify contracts against thresholds')
  .option('--json', 'Output structured JSON')
  .action(async (opts) => {
    const results = { command: 'design check', ts: timestamp() };
    let exitCode = 0;

    try {
      const contractsDir = path.join(DESIGN_DIR, 'contracts');
      const thresholdsPath = path.join(DESIGN_DIR, 'thresholds.json');

      if (!fs.existsSync(thresholdsPath)) {
        results.error = 'design/thresholds.json not found';
        jsonOut(opts.json, results);
        if (!opts.json) console.log('Error: design/thresholds.json not found');
        process.exit(2);
      }

      const thresholds = JSON.parse(fs.readFileSync(thresholdsPath, 'utf8'));
      results.thresholds = thresholds;

      if (!fs.existsSync(contractsDir)) {
        results.contracts = [];
        results.verdict = 'PASS';
        jsonOut(opts.json, results);
        if (!opts.json) console.log('  No contracts found. PASS (vacuously).');
        process.exit(0);
      }

      const files = fs.readdirSync(contractsDir).filter(f => f.endsWith('.json'));
      results.contracts = [];

      for (const file of files) {
        const contract = JSON.parse(fs.readFileSync(path.join(contractsDir, file), 'utf8'));
        const valid = !!(contract.name && contract.elements);
        results.contracts.push({ file, name: contract.name, valid });
        if (!valid) exitCode = 1;
        if (!opts.json) {
          console.log('  ' + file + ': ' + (valid ? 'PASS' : 'FAIL'));
        }
      }

      results.verdict = exitCode === 0 ? 'PASS' : 'FAIL';
      jsonOut(opts.json, results);
      if (!opts.json) console.log('  ' + results.verdict);
    } catch (err) {
      results.error = err.message;
      jsonOut(opts.json, results);
      if (!opts.json) console.log('  INFRASTRUCTURE ERROR: ' + err.message);
      exitCode = 2;
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
      results.error = 'test-specs/browser/ directory not found';
      jsonOut(opts.json, results);
      if (!opts.json) console.log('Error: test-specs/browser/ not found');
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
      results.error = 'test-specs/personas/ directory not found';
      jsonOut(opts.json, results);
      if (!opts.json) console.log('Error: test-specs/personas/ not found');
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
      console.log('No persona results found in test-results/personas/');
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
// sim-test summary
// ---------------------------------------------------------------------------

program
  .command('summary')
  .description('Aggregate all results into summary.json')
  .option('--json', 'Output structured JSON')
  .action(async (opts) => {
    ensureDir(RESULTS_DIR);
    const summary = { command: 'summary', ts: timestamp(), layers: {} };

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
      console.log('  Summary written to test-results/summary.json');
      if (summary.layers.browser) {
        console.log('  browser: ' + summary.layers.browser.results + ' result files');
      }
      if (summary.layers.personas) {
        console.log('  personas: ' + summary.layers.personas.totalFindings + ' findings (' + summary.layers.personas.highSeverity + ' high)');
      }
    }
    process.exit(0);
  });

program.parse();
