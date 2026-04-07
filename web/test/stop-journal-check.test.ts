'use strict';

/**
 * stop-journal-check.test.ts
 *
 * Tests .claude/hooks/stop-journal-check.ts: a Stop hook that refuses to
 * let the session end until at least one note has been recorded for the
 * current session via tsx scripts/note.ts. Uses time-window matching:
 * find SessionStart ts in raw.jsonl for the current session_id, then
 * scan notes.jsonl for any entry with ts >= start_ts.
 *
 * Permissive on edge cases (missing files, missing session_id, no
 * SessionStart baseline) so unrelated Stop events are not blocked.
 *
 * Each test runs the hook as a subprocess in a tmp working directory
 * with seeded raw.jsonl + notes.jsonl files.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const HOOK_SCRIPT = path.join(REPO_ROOT, '.claude', 'hooks', 'stop-journal-check.ts');

function runHook(cwd: string, input: object): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('npx', ['tsx', HOOK_SCRIPT], {
    cwd,
    input: JSON.stringify(input),
    encoding: 'utf8',
    timeout: 10000,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function makeTmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-hook-'));
  fs.mkdirSync(path.join(dir, 'learning', 'logs'), { recursive: true });
  return dir;
}

function rmTmp(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

function writeJsonl(file: string, entries: object[]): void {
  fs.writeFileSync(file, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
}

describe('stop-journal-check hook', () => {
  let tmp: string;
  let rawPath: string;
  let notesPath: string;

  beforeEach(() => {
    tmp = makeTmp();
    rawPath = path.join(tmp, 'learning', 'logs', 'raw.jsonl');
    notesPath = path.join(tmp, 'learning', 'logs', 'notes.jsonl');
  });
  afterEach(() => { rmTmp(tmp); });

  it('exits 0 when session has at least one notes.jsonl entry after SessionStart ts', () => {
    writeJsonl(rawPath, [
      { ts: '2026-04-07T10:00:00.000Z', event: 'SessionStart', session_id: 'sess-A' },
    ]);
    writeJsonl(notesPath, [
      { ts: '2026-04-07T10:30:00.000Z', kind: 'finding', topic: 'test', body: 'a finding' },
    ]);
    const r = runHook(tmp, { session_id: 'sess-A', hook_event_name: 'Stop' });
    assert.equal(r.status, 0, `expected 0, stderr: ${r.stderr}`);
  });

  it('exits 2 with stderr reminder when no notes.jsonl entry exists for the session window', () => {
    writeJsonl(rawPath, [
      { ts: '2026-04-07T10:00:00.000Z', event: 'SessionStart', session_id: 'sess-B' },
    ]);
    // notes.jsonl exists but has no entries from this session window.
    fs.writeFileSync(notesPath, '');
    const r = runHook(tmp, { session_id: 'sess-B', hook_event_name: 'Stop' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /tsx scripts\/note\.ts/);
  });

  it('exits 2 when notes.jsonl has entries but all predate the SessionStart ts', () => {
    writeJsonl(rawPath, [
      { ts: '2026-04-07T11:00:00.000Z', event: 'SessionStart', session_id: 'sess-C' },
    ]);
    writeJsonl(notesPath, [
      { ts: '2026-04-07T09:00:00.000Z', kind: 'finding', topic: 'old', body: 'before session' },
    ]);
    const r = runHook(tmp, { session_id: 'sess-C', hook_event_name: 'Stop' });
    assert.equal(r.status, 2);
  });

  it('ignores notes from a different session window (older SessionStart elsewhere)', () => {
    // Two sessions in raw.jsonl. The notes entry is from session-X's window,
    // not session-Y's. Stopping session-Y should still block.
    writeJsonl(rawPath, [
      { ts: '2026-04-07T08:00:00.000Z', event: 'SessionStart', session_id: 'sess-X' },
      { ts: '2026-04-07T12:00:00.000Z', event: 'SessionStart', session_id: 'sess-Y' },
    ]);
    writeJsonl(notesPath, [
      { ts: '2026-04-07T08:30:00.000Z', kind: 'finding', topic: 'old', body: 'from session X' },
    ]);
    const r = runHook(tmp, { session_id: 'sess-Y', hook_event_name: 'Stop' });
    assert.equal(r.status, 2);
  });

  it('exits 0 when notes.jsonl does not exist but a "none" entry was just appended', () => {
    writeJsonl(rawPath, [
      { ts: '2026-04-07T10:00:00.000Z', event: 'SessionStart', session_id: 'sess-D' },
    ]);
    writeJsonl(notesPath, [
      { ts: '2026-04-07T10:15:00.000Z', kind: 'none', topic: 'none', body: 'none: ran tests, all green' },
    ]);
    const r = runHook(tmp, { session_id: 'sess-D', hook_event_name: 'Stop' });
    assert.equal(r.status, 0);
  });

  it('exits 0 when stdin has no session_id (hook should not block external invocations)', () => {
    const r = runHook(tmp, {});
    assert.equal(r.status, 0);
  });

  it('exits 0 when raw.jsonl has no SessionStart for this session_id (no baseline to compare)', () => {
    writeJsonl(rawPath, [
      { ts: '2026-04-07T10:00:00.000Z', event: 'SessionStart', session_id: 'other-sess' },
    ]);
    const r = runHook(tmp, { session_id: 'fresh-sess', hook_event_name: 'Stop' });
    assert.equal(r.status, 0);
  });

  it('reminder message in stderr names the exact CLI invocation form', () => {
    writeJsonl(rawPath, [
      { ts: '2026-04-07T10:00:00.000Z', event: 'SessionStart', session_id: 'sess-E' },
    ]);
    const r = runHook(tmp, { session_id: 'sess-E', hook_event_name: 'Stop' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /tsx scripts\/note\.ts --kind/);
    assert.match(r.stderr, /--kind none --reason/);
  });
});
