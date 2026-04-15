import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ROOT = path.resolve(__dirname, '..', '..');

describe('permission bypass audit', () => {
  it('audit-permissions.ts exists', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'scripts', 'audit-permissions.ts')));
  });

  it('permission-bypass-registry.md exists after running audit', () => {
    execSync('npx tsx scripts/audit-permissions.ts', { cwd: ROOT, timeout: 60000 });
    assert.ok(fs.existsSync(path.join(ROOT, 'references', 'registries', 'permission-bypass-registry.md')));
  });

  it('registry does not contain web/lib bypass occurrences (active-code clean)', () => {
    const registry = fs.readFileSync(
      path.join(ROOT, 'references', 'registries', 'permission-bypass-registry.md'), 'utf8'
    );
    assert.ok(!registry.includes('web/lib/claude-process'), 'claude-process must have no bypass occurrences');
    assert.ok(!registry.includes('web/lib/claude-stream'), 'claude-stream must have no bypass occurrences');
  });

  it('registry has table format', () => {
    const registry = fs.readFileSync(
      path.join(ROOT, 'references', 'registries', 'permission-bypass-registry.md'), 'utf8'
    );
    assert.ok(registry.includes('| File |'), 'should have table header');
  });

  it('running audit twice with no input changes leaves file untouched (PR-A.4.2)', () => {
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
