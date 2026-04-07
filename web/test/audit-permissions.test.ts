const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

describe('permission bypass audit', () => {
  it('audit-permissions.ts exists', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'scripts', 'audit-permissions.ts')));
  });

  it('permission-bypass-registry.md exists after running audit', () => {
    const { execSync } = require('child_process');
    execSync('npx tsx scripts/audit-permissions.ts', { cwd: ROOT, timeout: 60000 });
    assert.ok(fs.existsSync(path.join(ROOT, 'references', 'registries', 'permission-bypass-registry.md')));
  });

  it('registry contains known usage in claude-process', () => {
    const registry = fs.readFileSync(
      path.join(ROOT, 'references', 'registries', 'permission-bypass-registry.md'), 'utf8'
    );
    assert.ok(registry.includes('claude-process'), 'should find usage in claude-process');
  });

  it('registry has table format', () => {
    const registry = fs.readFileSync(
      path.join(ROOT, 'references', 'registries', 'permission-bypass-registry.md'), 'utf8'
    );
    assert.ok(registry.includes('| File |'), 'should have table header');
  });

  it('running audit twice with no input changes leaves file untouched (PR-A.4.2)', () => {
    const { execSync } = require('child_process');
    const registryPath = path.join(ROOT, 'references', 'registries', 'permission-bypass-registry.md');
    execSync('npx tsx scripts/audit-permissions.ts', { cwd: ROOT, timeout: 60000 });
    const firstContent = fs.readFileSync(registryPath, 'utf8');
    const firstMtime = fs.statSync(registryPath).mtimeMs;
    // wait a hair to detect any rewrite
    const waitUntil = Date.now() + 20;
    while (Date.now() < waitUntil) { /* spin briefly */ }
    execSync('npx tsx scripts/audit-permissions.ts', { cwd: ROOT, timeout: 60000 });
    const secondContent = fs.readFileSync(registryPath, 'utf8');
    const secondMtime = fs.statSync(registryPath).mtimeMs;
    assert.equal(secondContent, firstContent, 'registry content must be byte-identical across consecutive runs');
    assert.equal(secondMtime, firstMtime, 'registry mtime must not change when inputs are unchanged');
  });
});
