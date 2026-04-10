import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * Tests for scripts/check-budget.sh.
 *
 * Exits 0 if no recent rate_limit_event with resetsAt in the future exists
 * across learning/logs/run-*.jsonl. Exits non-zero if any recent log shows
 * a pending rate limit. Issue #148.
 */

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts/check-budget.sh');

function runScript(logDir: string): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync('bash', [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, BUDGET_LOG_DIR: logDir },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function setupLogDir(): { dir: string; cleanup: () => void; write: (name: string, content: string) => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-budget-'));
  return {
    dir,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
    write: (name: string, content: string) => fs.writeFileSync(path.join(dir, name), content),
  };
}

describe('scripts/check-budget.sh', () => {
  it('exits 0 when the log dir is empty', () => {
    const logs = setupLogDir();
    try {
      const r = runScript(logs.dir);
      assert.strictEqual(r.status, 0, 'empty dir should be OK');
    } finally {
      logs.cleanup();
    }
  });

  it('exits 0 when no log contains a rate_limit_event', () => {
    const logs = setupLogDir();
    try {
      logs.write(
        'run-fake-part-1.jsonl',
        JSON.stringify({ type: 'system', subtype: 'init' }) + '\n' +
          JSON.stringify({ type: 'result', is_error: false, result: 'all good' }) + '\n',
      );
      const r = runScript(logs.dir);
      assert.strictEqual(r.status, 0);
    } finally {
      logs.cleanup();
    }
  });

  it('exits non-zero when a recent log has rate_limit_event with resetsAt in the future', () => {
    const logs = setupLogDir();
    try {
      const futureEpoch = Math.floor(Date.now() / 1000) + 3600; // 1h from now
      logs.write(
        'run-fake-part-1.jsonl',
        JSON.stringify({ type: 'system' }) + '\n' +
          JSON.stringify({
            type: 'rate_limit_event',
            rate_limit_info: { status: 'rejected', resetsAt: futureEpoch },
          }) + '\n',
      );
      const r = runScript(logs.dir);
      assert.notStrictEqual(r.status, 0, 'should refuse when reset is in the future');
      assert.match(r.stderr + r.stdout, /rate.?limit/i);
      assert.match(r.stderr + r.stdout, /\d{4}|epoch|reset/i, 'must show reset time');
    } finally {
      logs.cleanup();
    }
  });

  it('exits 0 when rate_limit_event.resetsAt is already in the past', () => {
    const logs = setupLogDir();
    try {
      const pastEpoch = Math.floor(Date.now() / 1000) - 3600; // 1h ago
      logs.write(
        'run-fake-part-1.jsonl',
        JSON.stringify({
          type: 'rate_limit_event',
          rate_limit_info: { status: 'rejected', resetsAt: pastEpoch },
        }) + '\n',
      );
      const r = runScript(logs.dir);
      assert.strictEqual(r.status, 0, 'past reset should not block');
    } finally {
      logs.cleanup();
    }
  });

  it('does NOT block on status:allowed_warning events (7-day utilization warnings)', () => {
    const logs = setupLogDir();
    try {
      const futureEpoch = Math.floor(Date.now() / 1000) + 7 * 86400;
      logs.write(
        'run-warning.jsonl',
        JSON.stringify({
          type: 'rate_limit_event',
          rate_limit_info: {
            status: 'allowed_warning',
            resetsAt: futureEpoch,
            rateLimitType: 'seven_day',
            utilization: 0.52,
          },
        }) + '\n',
      );
      const r = runScript(logs.dir);
      assert.strictEqual(r.status, 0, 'allowed_warning should not block dispatch');
    } finally {
      logs.cleanup();
    }
  });

  it('checks all run-*.jsonl files in the log dir', () => {
    const logs = setupLogDir();
    try {
      const futureEpoch = Math.floor(Date.now() / 1000) + 3600;
      // First log is clean, second has the rate limit. Script should still block.
      logs.write(
        'run-clean.jsonl',
        JSON.stringify({ type: 'result', is_error: false }) + '\n',
      );
      logs.write(
        'run-bad.jsonl',
        JSON.stringify({
          type: 'rate_limit_event',
          rate_limit_info: { status: 'rejected', resetsAt: futureEpoch },
        }) + '\n',
      );
      const r = runScript(logs.dir);
      assert.notStrictEqual(r.status, 0);
    } finally {
      logs.cleanup();
    }
  });

});
