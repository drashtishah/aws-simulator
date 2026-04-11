import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const GUARD_PATH = path.join(ROOT, '.claude', 'hooks', 'guard-write.ts');

describe('guard-write coverage', () => {
  const guardSource = fs.readFileSync(GUARD_PATH, 'utf8');

  it('NEVER_WRITABLE_DIRS includes web/test-specs/', () => {
    assert.ok(
      guardSource.includes("'web/test-specs'"),
      'guard-write.js should protect the web/test-specs/ directory'
    );
  });

  it('test.js removed from NEVER_WRITABLE for TS migration', () => {
    assert.ok(
      !guardSource.includes("'scripts/test.js'"),
      'guard-write.js should no longer protect scripts/test.js (removed for TS migration)'
    );
  });

  it('ownership.json exists for each skill with a SKILL.md', () => {
    const skillsDir = path.join(ROOT, '.claude', 'skills');
    const skillDirs = fs.readdirSync(skillsDir).filter(d =>
      fs.statSync(path.join(skillsDir, d)).isDirectory() &&
      fs.existsSync(path.join(skillsDir, d, 'SKILL.md'))
    );
    for (const dir of skillDirs) {
      const ownershipPath = path.join(skillsDir, dir, 'ownership.json');
      assert.ok(
        fs.existsSync(ownershipPath),
        dir + '/ownership.json should exist'
      );
      const ownership = JSON.parse(fs.readFileSync(ownershipPath, 'utf8'));
      assert.ok(Array.isArray(ownership.files), dir + '/ownership.json should have files array');
      assert.ok(Array.isArray(ownership.dirs), dir + '/ownership.json should have dirs array');
    }
  });

  it('test ownership includes web/test-results/ dir', () => {
    const ownership = JSON.parse(
      fs.readFileSync(path.join(ROOT, '.claude', 'skills', 'test', 'ownership.json'), 'utf8')
    );
    assert.ok(
      ownership.dirs.includes('web/test-results/'),
      'test ownership should include web/test-results/ directory'
    );
  });

  it('blocks web/test/ during skill execution', () => {
    assert.ok(
      guardSource.includes('web/test') || guardSource.includes("'web', 'test'"),
      'guard-write.js should block web/test/ during skill execution'
    );
  });
});
