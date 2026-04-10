const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const REGISTRY_PATH = 'references/registries/permission-bypass-registry.md';

describe('permission-bypass-registry hermeticity (Strategy 1)', () => {
  it('registry is NOT tracked by git', () => {
    const tracked = execSync(`git ls-files ${REGISTRY_PATH}`, { cwd: ROOT, encoding: 'utf8' }).trim();
    assert.equal(tracked, '', `${REGISTRY_PATH} must not be tracked by git`);
  });

  it('.gitignore contains the registry path', () => {
    const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    assert.ok(gitignore.includes(REGISTRY_PATH), `.gitignore must contain ${REGISTRY_PATH}`);
  });

  it('package.json postinstall invokes audit-permissions.ts', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.ok(
      pkg.scripts.postinstall.includes('audit-permissions.ts'),
      'postinstall must invoke audit-permissions.ts'
    );
  });

  it('package.json test invokes audit-permissions.ts before test.ts run', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const testScript: string = pkg.scripts.test;
    assert.ok(testScript.includes('audit-permissions.ts'), 'test script must invoke audit-permissions.ts');
    const auditIdx = testScript.indexOf('audit-permissions.ts');
    const testRunIdx = testScript.indexOf('test.ts run');
    assert.ok(auditIdx < testRunIdx, 'audit-permissions.ts must appear before test.ts run in test script');
  });
});
