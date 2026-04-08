import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * Tests for scripts/sibling-status.sh.
 *
 * Prints one line per sibling with commit count, HEAD short SHA, log size,
 * and alive/dead state. Issue #148.
 */

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts/sibling-status.sh');

function runScript(args: string[], envOverride: Record<string, string> = {}): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const r = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...envOverride },
    cwd: ROOT,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe('scripts/sibling-status.sh', () => {
  it('exists and is executable', () => {
    assert.ok(fs.existsSync(SCRIPT), 'script must exist');
    const mode = fs.statSync(SCRIPT).mode;
    assert.ok((mode & 0o111) !== 0, 'script must be chmod +x');
  });

  it('exits 2 with a usage message when given no arguments', () => {
    const r = runScript([]);
    assert.strictEqual(r.status, 2);
    assert.match(r.stderr, /usage.*parent-slug/i);
  });

  it('prints "no siblings" when no worktrees match', () => {
    const tmpLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sibling-status-'));
    try {
      const r = runScript(['nonexistent-parent-slug-xyz'], { BUDGET_LOG_DIR: tmpLogDir });
      assert.strictEqual(r.status, 0);
      assert.match(r.stdout, /no siblings/i);
    } finally {
      fs.rmSync(tmpLogDir, { recursive: true, force: true });
    }
  });
});
