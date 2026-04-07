const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { canRotate } = require('../lib/system-vault');

describe('log rotation: only-referenced rotation', () => {
  it('allows rotation of an unreferenced archive older than 7 days', () => {
    const res = canRotate({
      archiveName: 'raw.jsonl.2026-03-20.gz',
      nowIso: '2026-04-07T12:00:00Z',
      referencedArchives: new Set<string>(),
    });
    assert.ok(res.allow, JSON.stringify(res));
  });

  it('refuses rotation inside the 7 day retention window', () => {
    const res = canRotate({
      archiveName: 'raw.jsonl.2026-04-05.gz',
      nowIso: '2026-04-07T12:00:00Z',
      referencedArchives: new Set<string>(),
    });
    assert.equal(res.allow, false);
    assert.match(res.reason ?? '', /7/);
  });

  it('refuses rotation if vault still references the archive', () => {
    const res = canRotate({
      archiveName: 'raw.jsonl.2026-03-20.gz',
      nowIso: '2026-04-07T12:00:00Z',
      referencedArchives: new Set<string>(['raw.jsonl.2026-03-20.gz']),
    });
    assert.equal(res.allow, false);
    assert.match(res.reason ?? '', /referenced/);
  });

  it('refuses out-of-window deletes (>90 days old)', () => {
    const res = canRotate({
      archiveName: 'raw.jsonl.2025-12-01.gz',
      nowIso: '2026-04-07T12:00:00Z',
      referencedArchives: new Set<string>(),
    });
    assert.equal(res.allow, false);
    assert.match(res.reason ?? '', /window|90/);
  });

  it('refuses archives with malformed names', () => {
    const res = canRotate({
      archiveName: 'some-random.gz',
      nowIso: '2026-04-07T12:00:00Z',
      referencedArchives: new Set<string>(),
    });
    assert.equal(res.allow, false);
  });
});
