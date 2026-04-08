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

  it('tells the agent to cat progress.txt by its worker-cwd-relative path, not a doubly-nested worktree path (Issue #138)', () => {
    const body = fs.readFileSync(SCRIPT, 'utf8');
    // The worker cd's into the worktree before exec claude -p, so the
    // path to the progress file from its cwd is just "progress.txt".
    // The old prompt said ".claude/worktrees/${SLUG}/progress.txt"
    // which resolved to a doubly-nested path from inside the worktree.
    assert.doesNotMatch(
      body,
      /\.claude\/worktrees\/\$\{?SLUG\}?\/progress\.txt/,
      'prompt must not reference the doubly-nested worktree path',
    );
    assert.match(body, /cat progress\.txt/, 'prompt must instruct cat progress.txt from worktree cwd');
  });

  it('defines an initialize_worktree step that seeds progress.txt on fresh dispatch (Issue #138)', () => {
    const body = fs.readFileSync(SCRIPT, 'utf8');
    // Function-or-block labelled initialize_worktree.
    assert.match(body, /initialize_worktree/, 'must have an initialize_worktree function or block');
    // Must write progress.txt with an init marker line.
    assert.match(
      body,
      /progress\.txt[\s\S]{0,400}init/,
      'initializer must write an init marker to progress.txt',
    );
  });

  it('initialize_worktree is idempotent: only seeds progress.txt if it does not already exist (Issue #138)', () => {
    const body = fs.readFileSync(SCRIPT, 'utf8');
    // Must guard progress.txt creation on a file-exists check.
    assert.match(
      body,
      /\[\[\s*!\s*-f[^\]]*progress\.txt[^\]]*\]\]|if\s+!\s*\[\s*-f[^\]]*progress\.txt/,
      'progress.txt write must be guarded by a file-exists check for idempotency',
    );
  });

  it('initialize_worktree seeds learning/system-vault/index.md stub (Issue #138)', () => {
    const body = fs.readFileSync(SCRIPT, 'utf8');
    // Either inline stub write or install-git-hooks invocation, both
    // acceptable. Assert one of the two is present.
    assert.match(
      body,
      /learning\/system-vault\/index\.md|install-git-hooks/,
      'initializer must seed the system-vault stub (inline or via install-git-hooks)',
    );
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
