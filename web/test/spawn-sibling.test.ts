import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Static contract test for scripts/spawn-sibling.sh.
 *
 * Replaces web/test/run-plans.test.ts as part of Issue #148. Like the
 * old test, this is read-only (no real git worktree creation, no claude
 * -p spawn) and asserts the invariants as string matches against the
 * script body. The script itself cannot be unit-tested end-to-end from
 * here because it spawns claude -p.
 */

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts/spawn-sibling.sh');

describe('scripts/spawn-sibling.sh', () => {
  it('exists', () => {
    assert.ok(fs.existsSync(SCRIPT), 'scripts/spawn-sibling.sh must exist');
  });

  it('is executable', () => {
    const mode = fs.statSync(SCRIPT).mode;
    assert.ok((mode & 0o111) !== 0, 'must be chmod +x');
  });

  it('starts with bash shebang', () => {
    const body = fs.readFileSync(SCRIPT, 'utf8');
    assert.match(body, /^#!\/usr\/bin\/env bash\b/);
  });

  it('enables strict error handling', () => {
    const body = fs.readFileSync(SCRIPT, 'utf8');
    assert.match(body, /set -e(uo pipefail)?/);
  });

  it('takes two positional arguments: parent-slug and part-slug', () => {
    const body = fs.readFileSync(SCRIPT, 'utf8');
    // Requires two args, prints usage and exits 2 otherwise.
    assert.match(body, /\$#.*-lt.*2|\$#.*!=.*2/, 'must require 2 args');
    assert.match(body, /usage.*parent-slug.*part-slug/i);
  });

  it('runs a pre-flight budget check via scripts/check-budget.sh', () => {
    const body = fs.readFileSync(SCRIPT, 'utf8');
    assert.match(body, /scripts\/check-budget\.sh/);
  });

  it('is resume-safe: reuses existing worktree if present (Issue #128)', () => {
    const body = fs.readFileSync(SCRIPT, 'utf8');
    // Must not `git worktree add` unconditionally.
    assert.match(body, /-d\s+"\$WORKTREE"|\[\[ -d/, 'must check for existing worktree');
  });

  it('copies the plan file into the worktree (Issue #141)', () => {
    const body = fs.readFileSync(SCRIPT, 'utf8');
    assert.match(body, /mkdir -p "\$\{?WORKTREE\}?\/\.claude\/plans"/);
    assert.match(body, /cp "\$\{?PLAN/);
  });

  it('invokes claude -p with the right flag set', () => {
    const body = fs.readFileSync(SCRIPT, 'utf8');
    assert.match(body, /claude -p/);
    assert.match(body, /--permission-mode acceptEdits/);
    assert.match(body, /--output-format stream-json/);
    assert.match(body, /--verbose/);
  });

  it('streams stream-json output to learning/logs/run-<slug>.jsonl', () => {
    const body = fs.readFileSync(SCRIPT, 'utf8');
    assert.match(body, /learning\/logs\/run-\$\{?SLUG\}?\.jsonl/);
  });

  it('instructs the agent to read progress.txt and git log before starting (Issue #138 + resume semantics)', () => {
    const body = fs.readFileSync(SCRIPT, 'utf8');
    assert.match(body, /progress\.txt/);
    assert.match(body, /git log master\.\.HEAD/);
  });

  it('documents the per-sibling dispatcher model and references Issue #148', () => {
    const body = fs.readFileSync(SCRIPT, 'utf8');
    const header = body.split('\n').slice(0, 50).join('\n');
    assert.match(header, /#148/);
    assert.match(header, /per-sibling/i);
  });

  it('does NOT fork or wait', () => {
    const body = fs.readFileSync(SCRIPT, 'utf8');
    assert.doesNotMatch(body, /\)\s*&\s*$/m, 'no backgrounded subshells');
    assert.doesNotMatch(body, /^wait\b/m, 'no wait at end');
  });
});
