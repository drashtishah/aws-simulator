import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { shouldRotate, archiveName, rotate } from '../../scripts/rotate-raw-log';

function mkTmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `rrl-${prefix}-`));
}
function rmTmp(d: string): void {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
}

describe('shouldRotate', () => {
  it('returns false below 5 MB threshold', () => {
    assert.equal(shouldRotate(4_999_999), false);
  });

  it('returns true at exactly 5 MB', () => {
    assert.equal(shouldRotate(5_000_000), true);
  });

  it('returns true above 5 MB', () => {
    assert.equal(shouldRotate(6_000_000), true);
  });
});

describe('archiveName', () => {
  it('produces YYYY-MM-DD format with no existing archives', () => {
    const dir = mkTmp('an-basic');
    try {
      const d = new Date('2026-04-23T10:00:00Z');
      const name = archiveName(d, dir);
      assert.match(name, /^activity-archive-2026-04-23\.jsonl$/);
    } finally { rmTmp(dir); }
  });

  it('appends -HH-MM suffix when same-day archive exists', () => {
    const dir = mkTmp('an-collision');
    try {
      fs.writeFileSync(path.join(dir, 'activity-archive-2026-04-23.jsonl'), '');
      const d = new Date('2026-04-23T14:35:00Z');
      const name = archiveName(d, dir);
      assert.match(name, /^activity-archive-2026-04-23-14-35\.jsonl$/);
    } finally { rmTmp(dir); }
  });
});

describe('rotate integration', () => {
  it('rotates a 6 MB file: archive non-empty, raw.jsonl reset to 0 bytes', () => {
    const dir = mkTmp('rot-big');
    try {
      const rawPath = path.join(dir, 'raw.jsonl');
      const sixMB = Buffer.alloc(6_000_000, 'x');
      fs.writeFileSync(rawPath, sixMB);
      rotate(rawPath);
      const archives = fs.readdirSync(dir).filter(n => n.startsWith('activity-archive-'));
      assert.equal(archives.length, 1);
      assert.ok(fs.statSync(path.join(dir, archives[0])).size > 0, 'archive should be non-empty');
      assert.equal(fs.statSync(rawPath).size, 0, 'raw.jsonl should be empty after rotation');
    } finally { rmTmp(dir); }
  });

  it('no-op for a 1 MB file: no archive created, raw.jsonl unchanged', () => {
    const dir = mkTmp('rot-small');
    try {
      const rawPath = path.join(dir, 'raw.jsonl');
      const oneMB = Buffer.alloc(1_000_000, 'x');
      fs.writeFileSync(rawPath, oneMB);
      rotate(rawPath);
      const archives = fs.readdirSync(dir).filter(n => n.startsWith('activity-archive-'));
      assert.equal(archives.length, 0, 'no archive should be created');
      assert.equal(fs.statSync(rawPath).size, 1_000_000, 'raw.jsonl should be unchanged');
    } finally { rmTmp(dir); }
  });
});
