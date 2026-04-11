import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { checkAccess } from '../../.claude/hooks/guard-write';

const ROOT = '/tmp/aws-test-root';

// Ownership objects matching the ownership.json files
const PLAY_OWNERSHIP = {
  files: ['learning/profile.json', 'learning/catalog.csv', 'learning/journal.md'],
  dirs: ['learning/sessions']
};

const CREATE_SIM_OWNERSHIP = {
  files: ['sims/registry.json', 'sims/index.md', 'learning/catalog.csv'],
  dirs: ['sims/']
};

const FIX_OWNERSHIP = {
  files: ['learning/feedback.md', 'learning/CHANGELOG.md', 'scripts/metrics.config.json'],
  dirs: ['.claude/skills/', 'learning/logs']
};

const TEST_OWNERSHIP = {
  files: [],
  dirs: ['web/test-results/']
};

describe('checkAccess', () => {
  describe('development context (no ownership)', () => {
    it('allows editing web/ files', () => {
      const r = checkAccess(path.join(ROOT, 'web/lib/foo.js'), null, ROOT);
      assert.equal(r.allowed, true);
    });

    it('allows editing skill files', () => {
      const r = checkAccess(path.join(ROOT, '.claude/skills/play/SKILL.md'), null, ROOT);
      assert.equal(r.allowed, true);
    });

    it('blocks path-registry.csv (auto-generated)', () => {
      const r = checkAccess(path.join(ROOT, 'references/registries/path-registry.csv'), null, ROOT);
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

    it('blocks web/test-specs/ directory (protected)', () => {
      const r = checkAccess(path.join(ROOT, 'web/test-specs/browser/navigation.yaml'), null, ROOT);
      assert.equal(r.allowed, false);
    });

    it('allows scripts/test.js (no longer never writable)', () => {
      const r = checkAccess(path.join(ROOT, 'scripts/test.js'), null, ROOT);
      assert.equal(r.allowed, true);
    });

    it('allows learning/feedback.md (not in never-writable)', () => {
      const r = checkAccess(path.join(ROOT, 'learning/feedback.md'), null, ROOT);
      assert.equal(r.allowed, true);
    });
  });

  describe('play skill context', () => {
    it('allows learning/profile.json (owned)', () => {
      const r = checkAccess(path.join(ROOT, 'learning/profile.json'), PLAY_OWNERSHIP, ROOT);
      assert.equal(r.allowed, true);
    });

    it('allows learning/catalog.csv (owned)', () => {
      const r = checkAccess(path.join(ROOT, 'learning/catalog.csv'), PLAY_OWNERSHIP, ROOT);
      assert.equal(r.allowed, true);
    });

    it('allows learning/journal.md (owned)', () => {
      const r = checkAccess(path.join(ROOT, 'learning/journal.md'), PLAY_OWNERSHIP, ROOT);
      assert.equal(r.allowed, true);
    });

    it('allows learning/sessions/001.json (owned dir)', () => {
      const r = checkAccess(path.join(ROOT, 'learning/sessions/001.json'), PLAY_OWNERSHIP, ROOT);
      assert.equal(r.allowed, true);
    });

    it('blocks web/ files (not owned by play)', () => {
      const r = checkAccess(path.join(ROOT, 'web/lib/foo.js'), PLAY_OWNERSHIP, ROOT);
      assert.equal(r.allowed, false);
    });

    it('blocks sims/registry.json (not owned by play)', () => {
      const r = checkAccess(path.join(ROOT, 'sims/registry.json'), PLAY_OWNERSHIP, ROOT);
      assert.equal(r.allowed, false);
    });

    it('blocks path-registry.csv (never writable)', () => {
      const r = checkAccess(path.join(ROOT, 'references/registries/path-registry.csv'), PLAY_OWNERSHIP, ROOT);
      assert.equal(r.allowed, false);
    });
  });

  describe('create-sim skill context', () => {
    it('allows sims subdirectory files (owned dir)', () => {
      const r = checkAccess(path.join(ROOT, 'sims/005-new-sim/manifest.json'), CREATE_SIM_OWNERSHIP, ROOT);
      assert.equal(r.allowed, true);
    });

    it('allows sims/registry.json (owned file)', () => {
      const r = checkAccess(path.join(ROOT, 'sims/registry.json'), CREATE_SIM_OWNERSHIP, ROOT);
      assert.equal(r.allowed, true);
    });

    it('blocks learning/profile.json (not owned)', () => {
      const r = checkAccess(path.join(ROOT, 'learning/profile.json'), CREATE_SIM_OWNERSHIP, ROOT);
      assert.equal(r.allowed, false);
    });
  });

  describe('fix skill context', () => {
    it('allows learning/feedback.md (owned)', () => {
      const r = checkAccess(path.join(ROOT, 'learning/feedback.md'), FIX_OWNERSHIP, ROOT);
      assert.equal(r.allowed, true);
    });

    it('allows scripts/metrics.config.json (owned)', () => {
      const r = checkAccess(path.join(ROOT, 'scripts/metrics.config.json'), FIX_OWNERSHIP, ROOT);
      assert.equal(r.allowed, true);
    });

    it('allows .claude/skills/play/SKILL.md (skills always editable)', () => {
      const r = checkAccess(path.join(ROOT, '.claude/skills/play/SKILL.md'), FIX_OWNERSHIP, ROOT);
      assert.equal(r.allowed, true);
    });

    it('allows learning/logs/health-scores.jsonl (fix owns learning/logs)', () => {
      const r = checkAccess(path.join(ROOT, 'learning/logs/health-scores.jsonl'), FIX_OWNERSHIP, ROOT);
      assert.equal(r.allowed, true);
    });

    it('blocks learning/logs/activity.jsonl (never writable, even for fix)', () => {
      const r = checkAccess(path.join(ROOT, 'learning/logs/activity.jsonl'), FIX_OWNERSHIP, ROOT);
      assert.equal(r.allowed, false);
    });

    it('blocks web/ files (fix does not own web/)', () => {
      const r = checkAccess(path.join(ROOT, 'web/lib/foo.js'), FIX_OWNERSHIP, ROOT);
      assert.equal(r.allowed, false);
    });
  });

  describe('test skill context', () => {
    it('allows web/test-results/ directory (owned)', () => {
      const r = checkAccess(path.join(ROOT, 'web/test-results/browser/nav.json'), TEST_OWNERSHIP, ROOT);
      assert.equal(r.allowed, true);
    });

    it('blocks web/ files (not owned by test)', () => {
      const r = checkAccess(path.join(ROOT, 'web/lib/foo.js'), TEST_OWNERSHIP, ROOT);
      assert.equal(r.allowed, false);
    });
  });

  describe('test-file lock during skill execution', () => {
    it('blocks web/test/ files when ownership is provided', () => {
      const r = checkAccess(path.join(ROOT, 'web/test/server.test.js'), PLAY_OWNERSHIP, ROOT);
      assert.equal(r.allowed, false);
      assert.ok(r.reason.includes('Test files are not editable'));
    });

    it('allows web/test/ files when no ownership (dev mode)', () => {
      const r = checkAccess(path.join(ROOT, 'web/test/server.test.js'), null, ROOT);
      assert.equal(r.allowed, true);
    });
  });

  describe('directory error messages', () => {
    it('shows web/test-specs/ in error for test-specs directory', () => {
      const r = checkAccess(path.join(ROOT, 'web/test-specs/browser/nav.yaml'), null, ROOT);
      assert.equal(r.allowed, false);
      assert.ok(r.reason.includes('web/test-specs/'));
    });
  });
});
