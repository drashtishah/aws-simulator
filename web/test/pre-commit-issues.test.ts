import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');
const HOOK = path.join(ROOT, '.claude', 'hooks', 'pre-commit-issues.ts');

function runHook(payload: object) {
  return spawnSync('npx', ['tsx', HOOK], {
    cwd: ROOT,
    input: JSON.stringify(payload),
    encoding: 'utf8'
  });
}

function bashPayload(command: string) {
  return { tool_name: 'Bash', tool_input: { command } };
}

describe('pre-commit-issues hook', () => {
  it('exits 0 when gh issue create body contains "git commit"', () => {
    const r = runHook(bashPayload(
      'gh issue create --title "Hook bug" --body "every git commit must reference an issue"'
    ));
    assert.equal(r.status, 0, r.stderr);
  });

  it('exits 0 for valid commit with issue ref', () => {
    const r = runHook(bashPayload('git commit -m "feat: thing\n\nCloses #1"'));
    assert.equal(r.status, 0, r.stderr);
  });

  it('exits 2 for commit missing issue ref', () => {
    const r = runHook(bashPayload('git commit -m "no message"'));
    assert.equal(r.status, 2);
  });

  it('exits 0 for commit with explicit opt-out', () => {
    const r = runHook(bashPayload('git commit -m "No related issue"'));
    assert.equal(r.status, 0, r.stderr);
  });

  it('exits 0 for chained command with valid ref', () => {
    const r = runHook(bashPayload('npm test && git commit -m "feat: thing\n\nCloses #1"'));
    assert.equal(r.status, 0, r.stderr);
  });

  it('exits 2 for chained command missing ref', () => {
    const r = runHook(bashPayload('npm test && git commit -m "no ref"'));
    assert.equal(r.status, 2);
  });
});
