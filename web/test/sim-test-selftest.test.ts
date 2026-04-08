import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import path from 'node:path';

/**
 * sim-test CLI self-tests: smoke-check that every command exposes --help,
 * exits cleanly on --dry-run --json where available, and emits valid JSON.
 *
 * Rationale (Issue #31): the CLI is a developer surface area, not a library,
 * so the only way to know it still works is to spawn it and read the output.
 * These tests are intentionally fast (dry-run only) and do not touch the
 * network, the web server, or the filesystem outside node_modules.
 */

const ROOT = path.resolve(__dirname, '..', '..');

function run(args: string): { stdout: string; status: number } {
  try {
    const stdout = execSync(`npx tsx scripts/sim-test.ts ${args}`, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout, status: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer | string; status?: number };
    return {
      stdout: typeof e.stdout === 'string' ? e.stdout : (e.stdout?.toString() ?? ''),
      status: e.status ?? 1,
    };
  }
}

function parseJsonFromOutput(out: string): unknown {
  const i = out.indexOf('{');
  assert.notEqual(i, -1, `no JSON object found in output: ${out}`);
  return JSON.parse(out.slice(i));
}

describe('sim-test CLI self-test', () => {
  it('sim-test --help exits 0 and lists all expected subcommands', () => {
    const { stdout, status } = run('--help');
    assert.equal(status, 0);
    for (const cmd of ['run', 'agent', 'personas', 'evals', 'validate', 'summary']) {
      assert.ok(stdout.includes(cmd), `help output missing subcommand: ${cmd}`);
    }
  });

  it('sim-test personas --dry-run --json produces a valid top-level shape', () => {
    const { stdout, status } = run('personas --dry-run --json');
    assert.equal(status, 0);
    const data = parseJsonFromOutput(stdout) as Record<string, unknown>;
    assert.equal(data.command, 'personas');
    assert.ok(typeof data.ts === 'string');
    assert.ok(Array.isArray(data.personas));
    assert.ok((data.personas as unknown[]).length > 0, 'personas array must be non-empty');
  });

  it('sim-test agent --dry-run --json produces a valid top-level shape', () => {
    const { stdout, status } = run('agent --dry-run --json');
    assert.equal(status, 0);
    const data = parseJsonFromOutput(stdout) as Record<string, unknown>;
    assert.equal(data.command, 'agent');
    assert.ok(typeof data.ts === 'string');
    assert.ok(Array.isArray(data.specs));
  });

  it('sim-test run --help lists the --changed flag', () => {
    const { stdout, status } = run('run --help');
    assert.equal(status, 0);
    assert.ok(stdout.includes('--changed'), 'run --help output must advertise --changed');
  });
});
