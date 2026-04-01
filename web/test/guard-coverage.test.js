const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const GUARD_PATH = path.join(ROOT, '.claude', 'hooks', 'guard-write.js');

describe('guard-write coverage', () => {
  const guardSource = fs.readFileSync(GUARD_PATH, 'utf8');

  it('NEVER_WRITABLE_DIRS includes design/', () => {
    assert.ok(
      guardSource.includes("'design'"),
      'guard-write.js should protect the design/ directory'
    );
  });

  it('NEVER_WRITABLE_DIRS includes test-specs/', () => {
    assert.ok(
      guardSource.includes("'test-specs'"),
      'guard-write.js should protect the test-specs/ directory'
    );
  });

  it('NEVER_WRITABLE includes scripts/sim-test.js', () => {
    assert.ok(
      guardSource.includes("'scripts/sim-test.js'"),
      'guard-write.js should protect scripts/sim-test.js'
    );
  });

  it('NEVER_WRITABLE includes scripts/generate-design-refs.js', () => {
    assert.ok(
      guardSource.includes("'scripts/generate-design-refs.js'"),
      'guard-write.js should protect scripts/generate-design-refs.js'
    );
  });

  it('NEVER_WRITABLE includes scripts/extract-design-contracts.js', () => {
    assert.ok(
      guardSource.includes("'scripts/extract-design-contracts.js'"),
      'guard-write.js should protect scripts/extract-design-contracts.js'
    );
  });

  it('OWNERSHIP includes test skill with test-results/ dir', () => {
    assert.ok(
      guardSource.includes("test:"),
      'guard-write.js OWNERSHIP should include test skill'
    );
    assert.ok(
      guardSource.includes("'test-results/'"),
      'test skill should own test-results/ directory'
    );
  });

  it('blocks web/test/ during skill execution', () => {
    assert.ok(
      guardSource.includes('web/test') || guardSource.includes("'web', 'test'"),
      'guard-write.js should block web/test/ during skill execution'
    );
  });
});
