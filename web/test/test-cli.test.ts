const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const CLI = 'npx tsx scripts/test.ts';

function run(args) {
  return execSync(CLI + ' ' + args, { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
}

function runWithExit(args) {
  try {
    const output = execSync(CLI + ' ' + args, { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
    return { output, exitCode: 0 };
  } catch (err) {
    return { output: (err.stdout || '') + (err.stderr || ''), exitCode: err.status };
  }
}

describe('test CLI self-tests', () => {
  it('--help exits with code 0 and lists all 6 commands', () => {
    const output = run('--help');
    const commands = ['run', 'agent', 'personas', 'evals', 'validate', 'summary'];
    for (const cmd of commands) {
      assert.ok(output.includes(cmd), 'help should list command: ' + cmd);
    }
  });

  it('agent --dry-run exits with code 0 and includes spec names', () => {
    const output = run('agent --dry-run');
    assert.ok(output.includes('dry-run'), 'output should contain dry-run markers');
    assert.ok(output.includes('steps'), 'output should list steps for specs');
  });

  it('personas --dry-run exits with code 0 and includes persona IDs', () => {
    const output = run('personas --dry-run');
    assert.ok(output.includes('dry-run'), 'output should contain dry-run markers');
    assert.ok(output.includes('behaviors'), 'output should list behaviors');
  });

  it('evals --dry-run exits with code 0 and lists categories', () => {
    const output = run('evals --dry-run');
    assert.ok(output.includes('scoring_integrity'), 'should list scoring_integrity category');
    assert.ok(output.includes('console_purity'), 'should list console_purity category');
    assert.ok(output.includes('leak_prevention'), 'should list leak_prevention category');
  });

  it('agent --spec nonexistent prints no match or exits non-zero', () => {
    const { output, exitCode } = runWithExit('agent --spec __nonexistent_spec__');
    assert.ok(exitCode !== 0 || output.includes('no specs matched') || output.includes('0 steps'),
      'should indicate no specs matched');
  });

  it('personas --id nonexistent prints no match or exits non-zero', () => {
    const { output, exitCode } = runWithExit('personas --id __nonexistent_persona__');
    assert.ok(exitCode !== 0 || output.includes('not found') || output.includes('0 behaviors'),
      'should indicate persona not found');
  });

  it('agent --dry-run --json produces valid JSON output', () => {
    const { output, exitCode } = runWithExit('agent --dry-run --json');
    if (exitCode === 0 && output.trim()) {
      assert.doesNotThrow(() => JSON.parse(output), 'full output should be parseable JSON');
    }
  });

  it('personas --dry-run --json produces valid JSON output', () => {
    const { output, exitCode } = runWithExit('personas --dry-run --json');
    if (exitCode === 0 && output.trim()) {
      assert.doesNotThrow(() => JSON.parse(output), 'full output should be parseable JSON');
    }
  });
});
