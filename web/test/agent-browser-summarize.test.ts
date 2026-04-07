const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'agent-browser-summarize.ts');
const ARTIFACT = path.join(ROOT, 'web', 'test-results', 'agent-browser-latest.json');

function runSummarizer(args: string[]) {
  return spawnSync('npx', ['tsx', SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8'
  });
}

function backupArtifact(): string | null {
  if (fs.existsSync(ARTIFACT)) {
    const backup = ARTIFACT + '.bak-test';
    fs.renameSync(ARTIFACT, backup);
    return backup;
  }
  return null;
}

function restoreArtifact(backup: string | null) {
  if (fs.existsSync(ARTIFACT)) fs.unlinkSync(ARTIFACT);
  if (backup && fs.existsSync(backup)) fs.renameSync(backup, ARTIFACT);
}

describe('agent-browser-summarize', () => {
  it('writes pass artifact with required fields', () => {
    const backup = backupArtifact();
    try {
      const r = runSummarizer(['--status', 'pass']);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(fs.existsSync(ARTIFACT), 'artifact written');
      const data = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
      assert.equal(data.status, 'pass');
      assert.deepEqual(data.failed_specs, []);
      assert.match(data.committed_at_head, /^[0-9a-f]{40}$/);
      assert.match(data.staged_files_hash, /^[0-9a-f]{64}$/);
      assert.match(data.ran_at, /^\d{4}-\d{2}-\d{2}T/);
    } finally {
      restoreArtifact(backup);
    }
  });

  it('writes fail artifact with failed_specs list', () => {
    const backup = backupArtifact();
    try {
      const r = runSummarizer(['--status', 'fail', '--failed-specs', 'home,session']);
      assert.equal(r.status, 0, r.stderr);
      const data = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
      assert.equal(data.status, 'fail');
      assert.deepEqual(data.failed_specs, ['home', 'session']);
    } finally {
      restoreArtifact(backup);
    }
  });

  it('produces stable hash across runs with no UI changes', () => {
    const backup = backupArtifact();
    try {
      const r1 = runSummarizer(['--status', 'pass']);
      assert.equal(r1.status, 0, r1.stderr);
      const h1 = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8')).staged_files_hash;
      const r2 = runSummarizer(['--status', 'pass']);
      assert.equal(r2.status, 0, r2.stderr);
      const h2 = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8')).staged_files_hash;
      assert.equal(h1, h2);
    } finally {
      restoreArtifact(backup);
    }
  });
});
