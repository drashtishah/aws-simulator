const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const JOBS_DIR = path.join(ROOT, '.claude', 'scheduled-jobs');

// Fixture mirroring the PR-Pre permissions table. Each entry is the
// authoritative allowed_write_paths superset for that cron; manifests
// must declare only paths that are a subset of this list.
const BOUNDARY: Record<string, string[]> = {
  'daily-compile-and-rotate': [
    'learning/system-vault/**',
    'learning/logs/compile-pending.txt',
    'learning/logs/raw.jsonl',
    'learning/logs/raw.jsonl.*.gz',
    'learning/logs/archive/**',
    '.claude/state/vault-circuit.json',
  ],
  'weekly-fight-team': [
    'learning/system-vault/findings/**',
    'learning/system-vault/sessions/**',
    'github-issues:source:fight-team-weekly',
  ],
};

function loadJobs(): Array<{ file: string; data: any }> {
  if (!fs.existsSync(JOBS_DIR)) return [];
  return fs
    .readdirSync(JOBS_DIR)
    .filter((f: string) => f.endsWith('.json'))
    .map((f: string) => ({
      file: f,
      data: JSON.parse(fs.readFileSync(path.join(JOBS_DIR, f), 'utf8')),
    }));
}

describe('scheduled-jobs boundary (PR-Pre)', () => {
  it('.claude/scheduled-jobs directory exists with at least two manifests', () => {
    assert.ok(fs.existsSync(JOBS_DIR), `${JOBS_DIR} must exist`);
    const jobs = loadJobs();
    assert.ok(jobs.length >= 2, `expected >= 2 cron manifests, found ${jobs.length}`);
  });

  it('both required crons are present by name', () => {
    const jobs = loadJobs();
    const names = new Set(jobs.map((j) => j.data.name));
    for (const required of Object.keys(BOUNDARY)) {
      assert.ok(names.has(required), `missing cron manifest: ${required}`);
    }
  });

  it('every cron has a non-empty allowed_tools array', () => {
    const jobs = loadJobs();
    for (const { file, data } of jobs) {
      assert.ok(Array.isArray(data.allowed_tools), `${file}: allowed_tools must be an array`);
      assert.ok(data.allowed_tools.length > 0, `${file}: allowed_tools must be non-empty`);
    }
  });

  it('no wildcard and no --dangerously-skip-permissions anywhere in manifest', () => {
    const jobs = loadJobs();
    for (const { file, data } of jobs) {
      const serialized = JSON.stringify(data);
      assert.ok(
        !serialized.includes('dangerously-skip-permissions'),
        `${file}: must not contain dangerously-skip-permissions`,
      );
      for (const tool of data.allowed_tools) {
        assert.notEqual(tool, '*', `${file}: wildcard tool not allowed`);
      }
    }
  });

  it('each cron declares working_dir, cron spec, prompt, and allowed_write_paths', () => {
    const jobs = loadJobs();
    for (const { file, data } of jobs) {
      assert.ok(typeof data.name === 'string' && data.name.length > 0, `${file}: name`);
      assert.ok(typeof data.cron === 'string' && data.cron.length > 0, `${file}: cron`);
      assert.ok(
        typeof data.working_dir === 'string' && path.isAbsolute(data.working_dir),
        `${file}: working_dir must be absolute`,
      );
      assert.ok(typeof data.prompt === 'string' && data.prompt.length > 0, `${file}: prompt`);
      assert.ok(Array.isArray(data.allowed_write_paths), `${file}: allowed_write_paths array`);
    }
  });

  it('each cron allowed_write_paths is a subset of the boundary fixture', () => {
    const jobs = loadJobs();
    for (const { file, data } of jobs) {
      const allowed = BOUNDARY[data.name];
      assert.ok(allowed, `${file}: cron ${data.name} not in boundary fixture`);
      for (const p of data.allowed_write_paths) {
        assert.ok(
          allowed.includes(p),
          `${file}: write path ${p} not in boundary fixture for ${data.name}`,
        );
      }
    }
  });
});
