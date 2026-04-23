import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { checkAccess } from '../../.claude/hooks/guard-write';

const ROOT = '/tmp/aws-test-root';

describe('checkAccess', () => {
  describe('development context (no ownership)', () => {
    it('allows editing web/ files', () => {
      const r = checkAccess(path.join(ROOT, 'web/lib/foo.js'), ROOT);
      assert.equal(r.allowed, true);
    });

    it('allows editing skill files', () => {
      const r = checkAccess(path.join(ROOT, '.claude/skills/play/SKILL.md'), ROOT);
      assert.equal(r.allowed, true);
    });

    it('blocks path-registry.csv (auto-generated)', () => {
      const r = checkAccess(path.join(ROOT, 'references/registries/path-registry.csv'), ROOT);
      assert.equal(r.allowed, false);
    });

    it('blocks activity.jsonl (append-only)', () => {
      const r = checkAccess(path.join(ROOT, 'learning/logs/activity.jsonl'), ROOT);
      assert.equal(r.allowed, false);
    });

    it('blocks package-lock.json (npm-managed)', () => {
      const r = checkAccess(path.join(ROOT, 'package-lock.json'), ROOT);
      assert.equal(r.allowed, false);
    });

    it('blocks node_modules files', () => {
      const r = checkAccess(path.join(ROOT, 'node_modules/express/index.js'), ROOT);
      assert.equal(r.allowed, false);
    });

    it('blocks web/test-specs/ directory (protected)', () => {
      const r = checkAccess(path.join(ROOT, 'web/test-specs/browser/navigation.yaml'), ROOT);
      assert.equal(r.allowed, false);
    });

    it('blocks learning/system-vault/ directory (universal)', () => {
      const r = checkAccess(path.join(ROOT, 'learning/system-vault/problems/foo.md'), ROOT);
      assert.equal(r.allowed, false);
    });

    it('blocks learning/player-vault/ directory (universal)', () => {
      const r = checkAccess(path.join(ROOT, 'learning/player-vault/index.md'), ROOT);
      assert.equal(r.allowed, false);
    });

    it('allows scripts/test.js (no longer never writable)', () => {
      const r = checkAccess(path.join(ROOT, 'scripts/test.js'), ROOT);
      assert.equal(r.allowed, true);
    });

    it('allows learning/feedback.md (not in never-writable)', () => {
      const r = checkAccess(path.join(ROOT, 'learning/feedback.md'), ROOT);
      assert.equal(r.allowed, true);
    });
  });

  describe('directory error messages', () => {
    it('shows web/test-specs/ in error for test-specs directory', () => {
      const r = checkAccess(path.join(ROOT, 'web/test-specs/browser/nav.yaml'), ROOT);
      assert.equal(r.allowed, false);
      assert.ok(r.reason.includes('web/test-specs/'));
    });
  });
});
