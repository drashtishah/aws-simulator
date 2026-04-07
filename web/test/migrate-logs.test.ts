const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// PR-B step 2: tests for the activity.jsonl + system.jsonl -> raw.jsonl
// migration. Every test runs against a tmp logs dir wired through the
// AWS_SIMULATOR_LOGS_DIR env var so the production learning/logs/ tree is
// never touched.

const tmpRoot: string = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-logs-test-'));
process.env.AWS_SIMULATOR_LOGS_DIR = tmpRoot;
const { migrate } = require('../../scripts/migrate-logs');

after(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
});

function reset(): void {
  for (const f of fs.readdirSync(tmpRoot)) {
    fs.rmSync(path.join(tmpRoot, f), { recursive: true, force: true });
  }
}

function writeJsonl(name: string, lines: object[]): void {
  fs.writeFileSync(
    path.join(tmpRoot, name),
    lines.map((l: object) => JSON.stringify(l)).join('\n') + '\n',
    'utf8'
  );
}

function readJsonl(name: string): unknown[] {
  const content: string = fs.readFileSync(path.join(tmpRoot, name), 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map((l: string) => JSON.parse(l));
}

describe('migrate-logs', () => {
  beforeEach(() => { reset(); });

  it('does nothing when neither legacy file exists', () => {
    const result = migrate();
    assert.equal(result.fromActivity, 0);
    assert.equal(result.fromSystem, 0);
    assert.equal(result.fromRaw, 0);
    assert.equal(fs.existsSync(path.join(tmpRoot, 'raw.jsonl')), false);
  });

  it('merges activity + system into raw.jsonl in chronological order', () => {
    writeJsonl('activity.jsonl', [
      { ts: '2026-04-01T10:00:00.000Z', event: 'A1' },
      { ts: '2026-04-01T10:00:02.000Z', event: 'A2' }
    ]);
    writeJsonl('system.jsonl', [
      { ts: '2026-04-01T10:00:01.000Z', event: 'S1' },
      { ts: '2026-04-01T10:00:03.000Z', event: 'S2' }
    ]);

    const result = migrate();
    assert.equal(result.fromActivity, 2);
    assert.equal(result.fromSystem, 2);
    assert.equal(result.totalLines, 4);

    const raw = readJsonl('raw.jsonl') as Array<{ event: string }>;
    assert.deepEqual(raw.map(r => r.event), ['A1', 'S1', 'A2', 'S2']);
  });

  it('archives the legacy files after a successful merge', () => {
    writeJsonl('activity.jsonl', [{ ts: '2026-04-01T10:00:00.000Z', event: 'A' }]);
    writeJsonl('system.jsonl', [{ ts: '2026-04-01T10:00:01.000Z', event: 'S' }]);

    const result = migrate();
    assert.equal(result.archived.length, 2);
    assert.equal(fs.existsSync(path.join(tmpRoot, 'activity.jsonl')), false);
    assert.equal(fs.existsSync(path.join(tmpRoot, 'system.jsonl')), false);

    const archiveDir = path.join(tmpRoot, 'archive');
    const archived = fs.readdirSync(archiveDir);
    assert.equal(archived.length, 2);
    assert.ok(archived.some((f: string) => f.startsWith('activity.')));
    assert.ok(archived.some((f: string) => f.startsWith('system.')));
  });

  it('is idempotent: a second run is a no-op', () => {
    writeJsonl('activity.jsonl', [{ ts: '2026-04-01T10:00:00.000Z', event: 'A' }]);
    writeJsonl('system.jsonl', [{ ts: '2026-04-01T10:00:01.000Z', event: 'S' }]);

    migrate();
    const rawAfterFirst = fs.readFileSync(path.join(tmpRoot, 'raw.jsonl'), 'utf8');
    const archiveAfterFirst = fs.readdirSync(path.join(tmpRoot, 'archive'));

    const result = migrate();
    assert.equal(result.fromActivity, 0, 'second run finds no activity to migrate');
    assert.equal(result.fromSystem, 0, 'second run finds no system to migrate');

    const rawAfterSecond = fs.readFileSync(path.join(tmpRoot, 'raw.jsonl'), 'utf8');
    assert.equal(rawAfterSecond, rawAfterFirst, 'raw.jsonl content is unchanged');

    const archiveAfterSecond = fs.readdirSync(path.join(tmpRoot, 'archive'));
    assert.deepEqual(archiveAfterSecond.sort(), archiveAfterFirst.sort(), 'no new archives created');
  });

  it('preserves existing raw.jsonl lines and deduplicates by exact match', () => {
    writeJsonl('raw.jsonl', [
      { ts: '2026-04-01T10:00:00.000Z', event: 'R1' },
      { ts: '2026-04-01T10:00:02.000Z', event: 'R2' }
    ]);
    writeJsonl('activity.jsonl', [
      // duplicate of R1 — should dedupe
      { ts: '2026-04-01T10:00:00.000Z', event: 'R1' },
      // new line — should be kept
      { ts: '2026-04-01T10:00:01.000Z', event: 'A1' }
    ]);

    const result = migrate();
    assert.equal(result.fromRaw, 2);
    assert.equal(result.fromActivity, 2);
    // R1 deduped, so total = R1 + A1 + R2 = 3
    assert.equal(result.totalLines, 3);

    const raw = readJsonl('raw.jsonl') as Array<{ event: string }>;
    assert.deepEqual(raw.map(r => r.event), ['R1', 'A1', 'R2']);
  });

  it('does not lose lines that have no parseable ts', () => {
    writeJsonl('activity.jsonl', [
      { ts: '2026-04-01T10:00:00.000Z', event: 'A1' },
      { event: 'no_ts' as string },
      { ts: 'not-a-date', event: 'bad_ts' }
    ]);

    const result = migrate();
    assert.equal(result.totalLines, 3);
    const raw = readJsonl('raw.jsonl') as Array<{ event: string }>;
    assert.equal(raw.length, 3);
    assert.ok(raw.some(r => r.event === 'A1'));
    assert.ok(raw.some(r => r.event === 'no_ts'));
    assert.ok(raw.some(r => r.event === 'bad_ts'));
  });
});
