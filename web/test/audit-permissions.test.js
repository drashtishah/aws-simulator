const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

describe('permission bypass audit', () => {
  it('audit-permissions.js exists', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'scripts', 'audit-permissions.js')));
  });

  it('permission-bypass-registry.md exists after running audit', () => {
    const { execSync } = require('child_process');
    execSync('node scripts/audit-permissions.js', { cwd: ROOT });
    assert.ok(fs.existsSync(path.join(ROOT, 'references', 'permission-bypass-registry.md')));
  });

  it('registry contains known usage in claude-process.js', () => {
    const registry = fs.readFileSync(
      path.join(ROOT, 'references', 'permission-bypass-registry.md'), 'utf8'
    );
    assert.ok(registry.includes('claude-process.js'), 'should find usage in claude-process.js');
  });

  it('registry has table format', () => {
    const registry = fs.readFileSync(
      path.join(ROOT, 'references', 'permission-bypass-registry.md'), 'utf8'
    );
    assert.ok(registry.includes('| File |'), 'should have table header');
  });
});
