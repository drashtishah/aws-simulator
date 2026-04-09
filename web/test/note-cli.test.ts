'use strict';

/**
 * note-cli.test.ts
 *
 * Tests scripts/note.ts: a small CLI that appends one validated JSONL line per
 * call to learning/logs/notes.jsonl. Schema {ts, kind, topic, body}. Five
 * kinds (finding, negative_result, workaround, decision, none). The "none"
 * kind is the explicit escape hatch and requires a --reason flag.
 *
 * Each test runs the CLI as a subprocess in a tmp working directory so the
 * real learning/logs/ does not get polluted.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const NOTE_SCRIPT = path.join(REPO_ROOT, 'scripts', 'note.ts');

function runNote(cwd: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('npx', ['tsx', NOTE_SCRIPT, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 10000,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function readNotes(cwd: string): any[] {
  const p = path.join(cwd, 'learning', 'logs', 'notes.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, 'utf8')
    .split('\n')
    .filter((line: string) => line.trim().length > 0)
    .map((line: string) => JSON.parse(line));
}

function makeTmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-cli-'));
  fs.mkdirSync(path.join(dir, 'learning', 'logs'), { recursive: true });
  return dir;
}

function rmTmp(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

describe('note CLI', () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => { rmTmp(tmp); });

  it('appends a valid finding entry to notes.jsonl', () => {
    const r = runNote(tmp, ['--kind', 'finding', '--topic', 'test-symptom', '--body', 'observed X happening repeatedly']);
    assert.equal(r.status, 0, `expected success, stderr: ${r.stderr}`);
    const entries = readNotes(tmp);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].kind, 'finding');
    assert.equal(entries[0].topic, 'test-symptom');
    assert.equal(entries[0].body, 'observed X happening repeatedly');
    assert.ok(typeof entries[0].ts === 'string' && entries[0].ts.length > 0);
  });

  it('appends a negative_result entry', () => {
    const r = runNote(tmp, ['--kind', 'negative_result', '--topic', 'tried-x', '--body', 'X did not work because Y']);
    assert.equal(r.status, 0);
    const entries = readNotes(tmp);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].kind, 'negative_result');
  });

  it('appends a workaround entry', () => {
    const r = runNote(tmp, ['--kind', 'workaround', '--topic', 'fix-build', '--body', 'manually deleted the lockfile']);
    assert.equal(r.status, 0);
    const entries = readNotes(tmp);
    assert.equal(entries[0].kind, 'workaround');
  });

  it('appends a decision entry', () => {
    const r = runNote(tmp, ['--kind', 'decision', '--topic', 'use-postgres', '--body', 'switched from sqlite to postgres for concurrent writes']);
    assert.equal(r.status, 0);
    const entries = readNotes(tmp);
    assert.equal(entries[0].kind, 'decision');
  });

  it('rejects an unknown kind with non-zero exit and stderr', () => {
    const r = runNote(tmp, ['--kind', 'nonsense', '--topic', 'foo', '--body', 'bar']);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /kind/i);
  });

  it('rejects topic with invalid characters', () => {
    const r = runNote(tmp, ['--kind', 'finding', '--topic', 'Has Spaces', '--body', 'x']);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /topic/i);
  });

  it('accepts long bodies without truncation (Issue #119)', () => {
    const longBody = 'x'.repeat(2000);
    const r = runNote(tmp, ['--kind', 'finding', '--topic', 'long-body', '--body', longBody]);
    assert.equal(r.status, 0, `expected success, stderr: ${r.stderr}`);
    const entries = readNotes(tmp);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].body, longBody);
    assert.equal(entries[0].body.length, 2000);
  });

  it('accepts kind=none with --reason', () => {
    const r = runNote(tmp, ['--kind', 'none', '--reason', 'ran tests, all green']);
    assert.equal(r.status, 0, `expected success, stderr: ${r.stderr}`);
    const entries = readNotes(tmp);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].kind, 'none');
    assert.equal(entries[0].topic, 'none');
    assert.match(entries[0].body, /ran tests, all green/);
  });

  it('rejects kind=none without --reason', () => {
    const r = runNote(tmp, ['--kind', 'none']);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /reason/i);
  });

  it('appends multiple entries to the same file across runs', () => {
    runNote(tmp, ['--kind', 'finding', '--topic', 'first', '--body', 'first body']);
    runNote(tmp, ['--kind', 'finding', '--topic', 'second', '--body', 'second body']);
    const entries = readNotes(tmp);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].topic, 'first');
    assert.equal(entries[1].topic, 'second');
  });

  it('creates learning/logs/ if it does not exist', () => {
    fs.rmSync(path.join(tmp, 'learning', 'logs'), { recursive: true, force: true });
    const r = runNote(tmp, ['--kind', 'finding', '--topic', 'auto-mkdir', '--body', 'created']);
    assert.equal(r.status, 0, `expected success, stderr: ${r.stderr}`);
    assert.ok(fs.existsSync(path.join(tmp, 'learning', 'logs', 'notes.jsonl')));
  });

  it('honors NOTES_LOG_DIR env override for callers outside the repo cwd (Issue #131)', () => {
    // Simulates check-budget.sh calling note.ts: bash script's cwd is the
    // repo root, but the test must redirect writes to a temp dir without
    // changing cwd. Env-var override is the surgical path.
    const override = fs.mkdtempSync(path.join(os.tmpdir(), 'note-override-'));
    try {
      const result = spawnSync(
        'npx',
        ['tsx', NOTE_SCRIPT, '--kind', 'decision', '--topic', 'env-override', '--body', 'test'],
        {
          cwd: REPO_ROOT,
          encoding: 'utf8',
          timeout: 10000,
          env: { ...process.env, NOTES_LOG_DIR: override },
        },
      );
      assert.equal(result.status, 0, `expected success, stderr: ${result.stderr}`);
      const overridePath = path.join(override, 'notes.jsonl');
      assert.ok(fs.existsSync(overridePath), 'override path must receive the note');
      const entry = JSON.parse(fs.readFileSync(overridePath, 'utf8').trim());
      assert.equal(entry.topic, 'env-override');
    } finally {
      fs.rmSync(override, { recursive: true, force: true });
    }
  });
});
