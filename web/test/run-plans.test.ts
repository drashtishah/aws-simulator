import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Static contract test for scripts/run-plans.sh.
 *
 * The script cannot be executed from a unit test because it creates
 * git worktrees and spawns `claude -p` sessions. Chicken-and-egg.
 *
 * This test reads the script as text and asserts the invariants that
 * matter: correct shebang, safety flags, parallel-wait semantics,
 * documented trade-offs, and expected CLI-argument shape.
 *
 * Spec: Issue #102.
 */

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts/run-plans.sh');

describe('scripts/run-plans.sh', () => {
  it('exists', () => {
    assert.ok(fs.existsSync(SCRIPT), 'scripts/run-plans.sh must exist');
  });

  it('is executable', () => {
    const mode = fs.statSync(SCRIPT).mode;
    assert.ok((mode & 0o111) !== 0, 'scripts/run-plans.sh must be executable');
  });

  it('starts with bash shebang', () => {
    const body = fs.readFileSync(SCRIPT, 'utf8');
    assert.match(body, /^#!\/usr\/bin\/env bash\b/);
  });

  it('enables strict error handling', () => {
    const body = fs.readFileSync(SCRIPT, 'utf8');
    assert.match(body, /set -e(uo pipefail)?/);
  });

  it('creates one git worktree per sibling plan', () => {
    const body = fs.readFileSync(SCRIPT, 'utf8');
    assert.match(body, /git worktree add/);
  });

  it('spawns a headless claude session', () => {
    const body = fs.readFileSync(SCRIPT, 'utf8');
    assert.match(body, /claude -p/);
    assert.match(body, /--permission-mode acceptEdits/);
  });

  it('expands sibling plans via part-* glob', () => {
    const body = fs.readFileSync(SCRIPT, 'utf8');
    assert.match(body, /\.claude\/plans\/\$\{PARENT_SLUG\}-part-\*\.md/);
  });

  it('waits for every background job before exiting', () => {
    const body = fs.readFileSync(SCRIPT, 'utf8');
    assert.match(body, /^wait\b/m);
  });

  it('documents token-spend and acceptEdits trade-offs in the header', () => {
    const body = fs.readFileSync(SCRIPT, 'utf8');
    const header = body.split('\n').slice(0, 40).join('\n');
    assert.match(header, /token/i);
    assert.match(header, /acceptEdits/);
  });
});
