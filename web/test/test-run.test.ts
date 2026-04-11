import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseTestOutput, aggregateRuns, formatFailedFilesSummary } from '../../scripts/test-runner';
// Tests for test run failing-file reporting helpers (Group A of plan
// .claude/plans/replicated-exploring-thompson.md, Issue #92).
//
// node:test refuses to spawn itself recursively, so the per-file run logic
// is extracted into pure helpers (scripts/test-runner.ts) that can be
// unit-tested without invoking the real CLI. Integration is verified by the
// manual step in the plan: break web/test/markdown.test.ts and run npm test.



describe('parseTestOutput', () => {
  it('parses node:test "# pass N / # fail N" output', () => {
    const out = '# tests 5\n# pass 4\n# fail 1\n# duration_ms 12\n';
    assert.deepEqual(parseTestOutput(out), { passed: 4, failed: 1 });
  });

  it('parses tsx-style "ℹ pass N / ℹ fail N" output', () => {
    const out = 'ℹ tests 3\nℹ pass 2\nℹ fail 1\nℹ duration_ms 7\n';
    assert.deepEqual(parseTestOutput(out), { passed: 2, failed: 1 });
  });

  it('returns zeros when no test summary is present', () => {
    assert.deepEqual(parseTestOutput(''), { passed: 0, failed: 0 });
    assert.deepEqual(parseTestOutput('random noise'), { passed: 0, failed: 0 });
  });

  it('handles a passing-only run (failed = 0)', () => {
    assert.deepEqual(parseTestOutput('# pass 7\n# fail 0\n'), { passed: 7, failed: 0 });
  });

  it('handles a failing-only run (passed = 0)', () => {
    assert.deepEqual(parseTestOutput('# pass 0\n# fail 1\n'), { passed: 0, failed: 1 });
  });
});

describe('aggregateRuns', () => {
  it('returns zeros for empty input', () => {
    assert.deepEqual(aggregateRuns([]), {
      total: 0,
      passed: 0,
      failed: 0,
      failedFiles: [],
      hasError: false,
    });
  });

  it('sums counts and reports no failed files when all pass', () => {
    const runs = [
      { file: 'web/test/a.test.ts', passed: 3, failed: 0, error: false },
      { file: 'web/test/b.test.ts', passed: 5, failed: 0, error: false },
    ];
    assert.deepEqual(aggregateRuns(runs), {
      total: 8,
      passed: 8,
      failed: 0,
      failedFiles: [],
      hasError: false,
    });
  });

  it('records the basename of every file with failed > 0', () => {
    const runs = [
      { file: 'web/test/a.test.ts', passed: 2, failed: 0, error: false },
      { file: 'web/test/path-registry.test.ts', passed: 4, failed: 1, error: false },
      { file: 'web/test/c.test.ts', passed: 0, failed: 2, error: false },
    ];
    const out = aggregateRuns(runs);
    assert.equal(out.total, 9);
    assert.equal(out.passed, 6);
    assert.equal(out.failed, 3);
    assert.deepEqual(out.failedFiles, ['path-registry.test.ts', 'c.test.ts']);
    assert.equal(out.hasError, false);
  });

  it('uses basename only, never the full path', () => {
    const runs = [
      { file: 'web/test/nested/dir/markdown.test.ts', passed: 0, failed: 1, error: false },
    ];
    const out = aggregateRuns(runs);
    assert.deepEqual(out.failedFiles, ['markdown.test.ts']);
  });

  it('propagates hasError when any file has error: true', () => {
    const runs = [
      { file: 'web/test/a.test.ts', passed: 1, failed: 0, error: false },
      { file: 'web/test/b.test.ts', passed: 0, failed: 0, error: true },
    ];
    assert.equal(aggregateRuns(runs).hasError, true);
  });

  it('does not duplicate basenames if the same file appears twice', () => {
    const runs = [
      { file: 'web/test/a.test.ts', passed: 0, failed: 1, error: false },
      { file: 'web/test/a.test.ts', passed: 0, failed: 1, error: false },
    ];
    const out = aggregateRuns(runs);
    assert.deepEqual(out.failedFiles, ['a.test.ts']);
    assert.equal(out.failed, 2);
  });
});

describe('formatFailedFilesSummary', () => {
  it('returns empty string when no files failed', () => {
    assert.equal(formatFailedFilesSummary([]), '');
  });

  it('formats a single failed file with header and bullet', () => {
    const out = formatFailedFilesSummary(['markdown.test.ts']);
    assert.match(out, /Failed test files/);
    assert.match(out, /markdown\.test\.ts/);
  });

  it('formats multiple failed files, one per line', () => {
    const out = formatFailedFilesSummary(['a.test.ts', 'b.test.ts', 'c.test.ts']);
    assert.match(out, /a\.test\.ts/);
    assert.match(out, /b\.test\.ts/);
    assert.match(out, /c\.test\.ts/);
    // Each basename appears on its own line.
    const aLine = out.split('\n').filter((l: string) => l.includes('a.test.ts'));
    assert.equal(aLine.length, 1);
  });

  it('output ends with a newline so it appends cleanly to existing logs', () => {
    const out = formatFailedFilesSummary(['x.test.ts']);
    assert.ok(out.endsWith('\n'), 'summary should end with newline');
  });
});
