import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateDocIssue } from '../../scripts/lib/validate-doc-issue';

/**
 * Schema test for doc Issue bodies.
 *
 * Feeds both fixtures through scripts/lib/validate-doc-issue.ts.
 * The good fixture must pass; the bad fixture must fail with the
 * expected validator errors.
 *
 * Spec: .claude/skills/doc/references/issue-template.md
 * Ref #195
 */

const ROOT = path.resolve(__dirname, '..', '..');
const GOOD = path.join(ROOT, 'web/test/fixtures/doc-issue-good.md');
const BAD = path.join(ROOT, 'web/test/fixtures/doc-issue-bad.md');

describe('doc issue format validator', () => {
  it('good fixture passes all 6 hard requirements', () => {
    const body = fs.readFileSync(GOOD, 'utf8');
    const result = validateDocIssue(body);
    assert.equal(
      result.valid,
      true,
      `expected good fixture to validate; errors: ${result.errors.join(' | ')}`,
    );
    assert.deepEqual(result.errors, []);
  });

  it('bad fixture fails with specific errors', () => {
    const body = fs.readFileSync(BAD, 'utf8');
    const result = validateDocIssue(body);
    assert.equal(result.valid, false);
    assert.ok(result.errors.length >= 4, `expected >=4 errors, got ${result.errors.length}`);

    const joined = result.errors.join(' | ');
    assert.match(joined, /Evidence/);
    assert.match(joined, /Suggested approach/);
    assert.match(joined, /Verification/);
    assert.match(joined, /Review excerpts/);
  });

  it('rejects bodies under 600 chars', () => {
    const tiny = '## Finding\nshort\n';
    const result = validateDocIssue(tiny);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('too short')));
  });

  it('rejects bodies over 4000 chars', () => {
    const huge = '## Finding\n' + 'x'.repeat(4500);
    const result = validateDocIssue(huge);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('too long')));
  });

  it('requires all 3 Review excerpt labels', () => {
    const missingOne = `## Finding
test finding

## Bucket and metric
- Bucket: code
- Metric: test_sync
- Current score: 80
- Expected score after fix: 90
- Point gain: 10

## Evidence
- \`/home/runner/work/aws-simulator/aws-simulator/scripts/code-health.ts:100\` , missing test

## Current behavior
The metric score is low because tests are not in sync with code changes.
This causes the bucket to be underscored on each health run.
Existing tests do not cover recent additions.

## Expected behavior
Tests cover all code paths in the affected file.
The metric score returns to baseline after the fix.
Regression coverage is added for the specific gap.

## Suggested approach
1. Edit \`/home/runner/work/aws-simulator/aws-simulator/web/test/code-health.test.ts\` lines 1 to 5 to add coverage.
2. Run \`npm run health\` to verify score improvement.
3. Run \`npx tsx scripts/test.ts run --files web/test/code-health.test.ts\` to confirm.

## Verification
\`\`\`bash
npm run health
npx tsx scripts/test.ts run --files web/test/code-health.test.ts
\`\`\`

## Review excerpts
- **Challenger lens:** missing test coverage at code-health.ts:100
- **Defender lens:** current state is partially tested; conceded on gap

## Labels
- source:doc
- priority:high
- bucket:code
- metric:test_sync
- needs-human

## Linked context
- Health score entry: learning/logs/health-scores.jsonl line 1, run 2026-04-11T10:00:00Z
`;
    const result = validateDocIssue(missingOne);
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some((e) => e.includes('Review excerpts')),
      `expected Review excerpts error; got: ${result.errors.join(' | ')}`,
    );
  });
});
