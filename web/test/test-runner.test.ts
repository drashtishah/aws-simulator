// Tests for test run selection helpers: --files <glob> and --changed.
// These cover pure selection logic in scripts/test-select.ts.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  filterByGlob,
  mapChangedToTests,
  globToRegExp,
} = require('../../scripts/test-select');

describe('test selection: globToRegExp', () => {
  it('matches literal file names', () => {
    const re = globToRegExp('web/test/code-health.test.ts');
    assert.ok(re.test('web/test/code-health.test.ts'));
    assert.ok(!re.test('web/test/other.test.ts'));
  });

  it('matches single star within a segment', () => {
    const re = globToRegExp('web/test/code-health*.test.ts');
    assert.ok(re.test('web/test/code-health.test.ts'));
    assert.ok(re.test('web/test/code-health-extra.test.ts'));
    assert.ok(!re.test('web/test/other.test.ts'));
  });

  it('star does not cross slash', () => {
    const re = globToRegExp('web/test/*.test.ts');
    assert.ok(re.test('web/test/foo.test.ts'));
    assert.ok(!re.test('web/test/sub/foo.test.ts'));
  });

  it('double star crosses slashes', () => {
    const re = globToRegExp('web/**/*.test.ts');
    assert.ok(re.test('web/test/foo.test.ts'));
    assert.ok(re.test('web/test/sub/foo.test.ts'));
  });

  it('question mark matches a single character', () => {
    const re = globToRegExp('web/test/a?.test.ts');
    assert.ok(re.test('web/test/ab.test.ts'));
    assert.ok(!re.test('web/test/abc.test.ts'));
  });
});

describe('test selection: filterByGlob', () => {
  const files = [
    'web/test/code-health.test.ts',
    'web/test/code-health-extras.test.ts',
    'web/test/guard-write.test.ts',
    'web/test/test-cli.test.ts',
  ];

  it('filters by single-segment star glob', () => {
    const out = filterByGlob(files, 'web/test/code-health*.test.ts');
    assert.deepEqual(out.sort(), [
      'web/test/code-health-extras.test.ts',
      'web/test/code-health.test.ts',
    ]);
  });

  it('returns empty array when nothing matches', () => {
    const out = filterByGlob(files, 'web/test/__missing__*.test.ts');
    assert.deepEqual(out, []);
  });

  it('matches all when using **', () => {
    const out = filterByGlob(files, 'web/**/*.test.ts');
    assert.equal(out.length, files.length);
  });
});

describe('test selection: mapChangedToTests', () => {
  const existingTests = new Set([
    'web/test/code-health.test.ts',
    'web/test/guard-write.test.ts',
    'web/test/test-cli.test.ts',
  ]);

  function hasTest(rel: string): boolean {
    return existingTests.has(rel);
  }

  it('includes changed files that are already tests', () => {
    const result = mapChangedToTests(
      ['web/test/code-health.test.ts', 'README.md'],
      { hasTest }
    );
    assert.deepEqual(result.tests, ['web/test/code-health.test.ts']);
    assert.deepEqual(result.warnings, []);
  });

  it('maps a changed source file to its co-located test by basename', () => {
    const result = mapChangedToTests(
      ['scripts/code-health.ts'],
      { hasTest }
    );
    assert.deepEqual(result.tests, ['web/test/code-health.test.ts']);
    assert.deepEqual(result.warnings, []);
  });

  it('maps a changed source file using basename without extension', () => {
    const result = mapChangedToTests(
      ['web/lib/guard-write.js'],
      { hasTest }
    );
    assert.deepEqual(result.tests, ['web/test/guard-write.test.ts']);
  });

  it('warns and continues when no co-located test exists', () => {
    const result = mapChangedToTests(
      ['scripts/brand-new-module.ts'],
      { hasTest }
    );
    assert.deepEqual(result.tests, []);
    assert.equal(result.warnings.length, 1);
    assert.ok(result.warnings[0].includes('brand-new-module'));
  });

  it('deduplicates when source and test both change', () => {
    const result = mapChangedToTests(
      ['scripts/code-health.ts', 'web/test/code-health.test.ts'],
      { hasTest }
    );
    assert.deepEqual(result.tests, ['web/test/code-health.test.ts']);
  });

  it('ignores non-code files like markdown', () => {
    const result = mapChangedToTests(
      ['references/foo.md', 'CLAUDE.md'],
      { hasTest }
    );
    assert.deepEqual(result.tests, []);
    assert.deepEqual(result.warnings, []);
  });

  it('handles empty input', () => {
    const result = mapChangedToTests([], { hasTest });
    assert.deepEqual(result.tests, []);
    assert.deepEqual(result.warnings, []);
  });
});
