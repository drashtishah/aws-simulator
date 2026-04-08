import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * Tests for .claude/hooks/post-commit-note-check.ts.
 *
 * The hook fires under PostToolUse for Bash. It detects when a `git commit`
 * tool call just landed, looks up the commit timestamp from `git log`, and
 * scans learning/logs/notes.jsonl for any entry with ts >= commit_ts. If
 * none exists, it emits a reminder. Permissive on edge cases. Issue #146.
 */

const ROOT = path.resolve(__dirname, '..', '..');
const HOOK = path.join(ROOT, '.claude/hooks/post-commit-note-check.ts');

interface RunOpts {
  toolName?: string;
  command?: string;
  cwd?: string;
}

function runHook(opts: RunOpts): { status: number | null; stdout: string; stderr: string } {
  const payload = JSON.stringify({
    tool_name: opts.toolName ?? 'Bash',
    tool_input: opts.command !== undefined ? { command: opts.command } : {},
    session_id: 'test-session-' + Math.random().toString(36).slice(2),
  });
  const r = spawnSync('npx', ['tsx', HOOK], {
    input: payload,
    encoding: 'utf8',
    cwd: opts.cwd ?? ROOT,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function setupFakeRepo(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'post-commit-note-'));
  // Initialize a git repo with one commit so `git log -1` works.
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'README.md'), '# test\n');
  spawnSync('git', ['add', '.'], { cwd: dir });
  spawnSync('git', ['commit', '-q', '-m', 'initial commit'], { cwd: dir });
  fs.mkdirSync(path.join(dir, 'learning', 'logs'), { recursive: true });
  return {
    dir,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

describe('.claude/hooks/post-commit-note-check.ts', () => {
  it('exits 0 silently when tool_name is not Bash', () => {
    const r = runHook({ toolName: 'Read' });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout.trim(), '');
  });

  it('exits 0 silently when command is not a git commit', () => {
    const r = runHook({ command: 'ls -la' });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout.trim(), '');
  });

  it('exits 0 silently when command contains "git commit" inside body text but is not an actual commit invocation', () => {
    const r = runHook({ command: 'gh issue create --title "fix git commit hook"' });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout.trim(), '', 'should not fire on substring matches');
  });

  it('emits a reminder when a commit just landed and no note exists', () => {
    const repo = setupFakeRepo();
    try {
      const r = runHook({ command: 'git commit -m "test"', cwd: repo.dir });
      assert.strictEqual(r.status, 0);
      assert.match(r.stdout, /scripts\/note\.ts/, 'must reference scripts/note.ts');
      assert.match(r.stdout, /\b[0-9a-f]{7,}\b/, 'must include the commit SHA');
    } finally {
      repo.cleanup();
    }
  });

  it('exits silently when a note has been written since the latest commit', () => {
    const repo = setupFakeRepo();
    try {
      const commitTs = new Date().toISOString();
      // Write a note dated AFTER the commit (real-world: tsx scripts/note.ts)
      const futureTs = new Date(Date.now() + 60000).toISOString();
      fs.writeFileSync(
        path.join(repo.dir, 'learning', 'logs', 'notes.jsonl'),
        JSON.stringify({ ts: futureTs, kind: 'decision', topic: 'test', body: 'after commit' }) + '\n',
      );
      const r = runHook({ command: 'git commit -m "test"', cwd: repo.dir });
      assert.strictEqual(r.status, 0);
      assert.strictEqual(r.stdout.trim(), '', 'should not nag when note exists');
    } finally {
      repo.cleanup();
    }
  });

  it('still emits when only a stale note exists (older than the commit)', () => {
    const repo = setupFakeRepo();
    try {
      const staleTs = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      fs.writeFileSync(
        path.join(repo.dir, 'learning', 'logs', 'notes.jsonl'),
        JSON.stringify({ ts: staleTs, kind: 'decision', topic: 'test', body: 'old' }) + '\n',
      );
      const r = runHook({ command: 'git commit -m "test"', cwd: repo.dir });
      assert.strictEqual(r.status, 0);
      assert.match(r.stdout, /scripts\/note\.ts/);
    } finally {
      repo.cleanup();
    }
  });

  it('exits 0 silently on malformed stdin', () => {
    const r = spawnSync('npx', ['tsx', HOOK], { input: 'not json', encoding: 'utf8', cwd: ROOT });
    assert.strictEqual(r.status, 0);
  });
});
