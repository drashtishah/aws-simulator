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

  it('blocks web/test/ during skill execution', () => {
    assert.ok(
      guardSource.includes('web/test') || guardSource.includes("'web', 'test'"),
      'guard-write.js should block web/test/ during skill execution'
    );
  });
});
