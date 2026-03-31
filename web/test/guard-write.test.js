const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { checkAccess } = require('../../.claude/hooks/guard-write');

const ROOT = '/tmp/aws-sim-test-root';

describe('checkAccess', () => {
  describe('development context (no active skill)', () => {
    it('allows editing web/ files', () => {
      const r = checkAccess(path.join(ROOT, 'web/lib/foo.js'), null, ROOT);
      assert.equal(r.allowed, true);
    });

    it('allows editing skill files', () => {
      const r = checkAccess(path.join(ROOT, '.claude/skills/play/SKILL.md'), null, ROOT);
      assert.equal(r.allowed, true);
    });

    it('blocks path-registry.csv (auto-generated)', () => {
      const r = checkAccess(path.join(ROOT, 'references/path-registry.csv'), null, ROOT);
      assert.equal(r.allowed, false);
    });

    it('blocks activity.jsonl (append-only)', () => {
      const r = checkAccess(path.join(ROOT, 'learning/logs/activity.jsonl'), null, ROOT);
      assert.equal(r.allowed, false);
    });

    it('blocks package-lock.json (npm-managed)', () => {
      const r = checkAccess(path.join(ROOT, 'package-lock.json'), null, ROOT);
      assert.equal(r.allowed, false);
    });

    it('blocks node_modules files', () => {
      const r = checkAccess(path.join(ROOT, 'node_modules/express/index.js'), null, ROOT);
      assert.equal(r.allowed, false);
    });

    it('allows learning/feedback.md (not in never-writable)', () => {
      const r = checkAccess(path.join(ROOT, 'learning/feedback.md'), null, ROOT);
      assert.equal(r.allowed, true);
    });
  });

  describe('play skill context', () => {
    it('allows learning/profile.json (owned)', () => {
      const r = checkAccess(path.join(ROOT, 'learning/profile.json'), 'play', ROOT);
      assert.equal(r.allowed, true);
    });

    it('allows learning/catalog.csv (owned)', () => {
      const r = checkAccess(path.join(ROOT, 'learning/catalog.csv'), 'play', ROOT);
      assert.equal(r.allowed, true);
    });

    it('allows learning/journal.md (owned)', () => {
      const r = checkAccess(path.join(ROOT, 'learning/journal.md'), 'play', ROOT);
      assert.equal(r.allowed, true);
    });

    it('allows learning/sessions/001.json (owned dir)', () => {
      const r = checkAccess(path.join(ROOT, 'learning/sessions/001.json'), 'play', ROOT);
      assert.equal(r.allowed, true);
    });

    it('blocks web/ files (not owned by play)', () => {
      const r = checkAccess(path.join(ROOT, 'web/lib/foo.js'), 'play', ROOT);
      assert.equal(r.allowed, false);
    });

    it('blocks sims/registry.json (not owned by play)', () => {
      const r = checkAccess(path.join(ROOT, 'sims/registry.json'), 'play', ROOT);
      assert.equal(r.allowed, false);
    });

    it('blocks path-registry.csv (never writable)', () => {
      const r = checkAccess(path.join(ROOT, 'references/path-registry.csv'), 'play', ROOT);
      assert.equal(r.allowed, false);
    });
  });

  describe('create-sim skill context', () => {
    it('allows sims subdirectory files (owned dir)', () => {
      const r = checkAccess(path.join(ROOT, 'sims/005-new-sim/manifest.json'), 'create-sim', ROOT);
      assert.equal(r.allowed, true);
    });

    it('allows sims/registry.json (owned file)', () => {
      const r = checkAccess(path.join(ROOT, 'sims/registry.json'), 'create-sim', ROOT);
      assert.equal(r.allowed, true);
    });

    it('blocks learning/profile.json (not owned)', () => {
      const r = checkAccess(path.join(ROOT, 'learning/profile.json'), 'create-sim', ROOT);
      assert.equal(r.allowed, false);
    });
  });

  describe('fix skill context', () => {
    it('allows learning/feedback.md (owned)', () => {
      const r = checkAccess(path.join(ROOT, 'learning/feedback.md'), 'fix', ROOT);
      assert.equal(r.allowed, true);
    });

    it('allows scripts/metrics.config.json (owned)', () => {
      const r = checkAccess(path.join(ROOT, 'scripts/metrics.config.json'), 'fix', ROOT);
      assert.equal(r.allowed, true);
    });

    it('allows .claude/skills/play/SKILL.md (skills always editable)', () => {
      const r = checkAccess(path.join(ROOT, '.claude/skills/play/SKILL.md'), 'fix', ROOT);
      assert.equal(r.allowed, true);
    });

    it('allows learning/logs/health-scores.jsonl (fix owns learning/logs)', () => {
      const r = checkAccess(path.join(ROOT, 'learning/logs/health-scores.jsonl'), 'fix', ROOT);
      assert.equal(r.allowed, true);
    });

    it('blocks learning/logs/activity.jsonl (never writable, even for fix)', () => {
      const r = checkAccess(path.join(ROOT, 'learning/logs/activity.jsonl'), 'fix', ROOT);
      assert.equal(r.allowed, false);
    });

    it('blocks web/ files (fix does not own web/)', () => {
      const r = checkAccess(path.join(ROOT, 'web/lib/foo.js'), 'fix', ROOT);
      assert.equal(r.allowed, false);
    });
  });

  describe('edge cases', () => {
    it('unknown skill falls back to dev mode (allow)', () => {
      const r = checkAccess(path.join(ROOT, 'some-file.js'), 'unknown-skill', ROOT);
      assert.equal(r.allowed, true);
    });
  });
});
