import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateFightTeamIssue } from '../../scripts/lib/validate-fight-team-issue';

/**
 * Schema test for fight-team Issue bodies.
 *
 * Feeds both fixtures through scripts/lib/validate-fight-team-issue.ts.
 * The good fixture must pass; the bad fixture must fail with the
 * expected validator errors.
 *
 * Spec: .claude/skills/fight-team/references/issue-template.md
 * Plan section: PR-H, H.2 (issue #65)
 */

const ROOT = path.resolve(__dirname, '..', '..');
const GOOD = path.join(ROOT, 'web/test/fixtures/fight-team-issue-good.md');
const BAD = path.join(ROOT, 'web/test/fixtures/fight-team-issue-bad.md');

describe('fight-team issue format validator', () => {
  it('good fixture passes all 6 hard requirements', () => {
    const body = fs.readFileSync(GOOD, 'utf8');
    const result = validateFightTeamIssue(body);
    assert.equal(
      result.valid,
      true,
      `expected good fixture to validate; errors: ${result.errors.join(' | ')}`,
    );
    assert.deepEqual(result.errors, []);
  });

  it('bad fixture fails with specific errors', () => {
    const body = fs.readFileSync(BAD, 'utf8');
    const result = validateFightTeamIssue(body);
    assert.equal(result.valid, false);
    assert.ok(result.errors.length >= 4, `expected >=4 errors, got ${result.errors.length}`);

    const joined = result.errors.join(' | ');
    assert.match(joined, /Evidence/);
    assert.match(joined, /Suggested approach/);
    assert.match(joined, /Verification/);
    assert.match(joined, /Debate transcript/);
  });

  it('rejects bodies under 600 chars', () => {
    const tiny = '## Finding\nshort\n';
    const result = validateFightTeamIssue(tiny);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('too short')));
  });

  it('rejects bodies over 4000 chars', () => {
    const huge = '## Finding\n' + 'x'.repeat(4500);
    const result = validateFightTeamIssue(huge);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('too long')));
  });
});
