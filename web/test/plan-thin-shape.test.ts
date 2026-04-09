import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Plan-thin-shape regression test for Issue #115.
 *
 * Plans produced by /fix are THIN orchestration documents. All research
 * (file:line refs, literal edits, verification commands) lives in the
 * GitHub Issues that /fix creates in step 5b; plans only carry the
 * order, dependencies, parallelization, and risk analysis.
 *
 * This test locks the thin-shape contract via fixtures. It runs two
 * kinds of assertions:
 *
 *   1. Fixture round-trip: the good fixture passes validateThinShape,
 *      the bad fixture fails with the expected errors. This is the
 *      canonical contract check.
 *   2. Live sweep: every plan under .claude/plans/** that is still
 *      present on disk passes validateThinShape. The live sweep is a
 *      safety net; it is a no-op when .claude/plans is empty (plans
 *      are gitignored so CI sees an empty directory).
 *
 * Contract:
 *   - Workflow, Testing, Cleanup sections are present exactly once
 *     each (duplicated workflow sections are the main anti-pattern).
 *   - At least one `## Group` or `### Group` heading is present.
 *   - Every Group body cites at least one `#N` Issue number.
 *   - Plan file body is under 600 lines (Issue #115 cap).
 */

const ROOT = path.resolve(__dirname, '..', '..');
const GOOD = path.join(ROOT, 'web/test/fixtures/plan-thin-shape-good.md');
const BAD = path.join(ROOT, 'web/test/fixtures/plan-thin-shape-bad.md');
const PLANS_DIR = path.join(ROOT, '.claude/plans');

interface ThinShapeResult {
  valid: boolean;
  errors: string[];
}

function countMatches(plan: string, re: RegExp): number {
  return (plan.match(re) || []).length;
}

function validateThinShape(plan: string): ThinShapeResult {
  const errors: string[] = [];

  // Canonical section headers match the exact line `## Workflow`, `## Testing`,
  // `## Cleanup` (no trailing text). Heads like `## Cleanup group (final)` do
  // NOT count as a canonical Cleanup heading; they are Group-ish sections.
  const workflowCount = countMatches(plan, /^## Workflow\s*$/gm);
  const testingCount = countMatches(plan, /^## Testing\s*$/gm);
  const cleanupCount = countMatches(plan, /^## Cleanup\s*$/gm);

  if (workflowCount === 0) errors.push('missing Workflow section');
  if (testingCount === 0) errors.push('missing Testing section');
  if (cleanupCount === 0) errors.push('missing Cleanup section');

  if (workflowCount > 1) {
    errors.push(`workflow duplication: ## Workflow appears ${workflowCount} times`);
  }
  if (testingCount > 1) {
    errors.push(`testing duplication: ## Testing appears ${testingCount} times`);
  }
  if (cleanupCount > 1) {
    errors.push(`cleanup duplication: ## Cleanup appears ${cleanupCount} times`);
  }

  const lines = plan.split('\n').length;
  if (lines > 600) errors.push(`plan exceeds 600-line cap (${lines} lines)`);

  // Split into Group sections. Accept both `## Group X` and `### Group X`.
  // Carry the heading line into the body so Issue citations in the heading
  // (e.g. `## Group A: Do the thing (#113)`) count.
  const lineArr = plan.split('\n');
  const groups: Array<{ name: string; body: string }> = [];
  let current: { name: string; body: string } | null = null;
  for (const line of lineArr) {
    const m = line.match(/^(##+) (Group [^:]*:?.*)$/);
    if (m) {
      if (current) groups.push(current);
      current = { name: m[2].trim(), body: line + '\n' };
    } else if (current) {
      current.body += line + '\n';
    }
  }
  if (current) groups.push(current);

  if (groups.length === 0) {
    errors.push('plan has no Group sections');
  }

  for (const g of groups) {
    const hasIssueRef = /#\d+/.test(g.body);
    if (!hasIssueRef) {
      errors.push(`${g.name}: missing Issue number citation (#N)`);
    }
  }

  return { valid: errors.length === 0, errors };
}

describe('plan thin shape', () => {
  it('good fixture passes', () => {
    const body = fs.readFileSync(GOOD, 'utf8');
    const result = validateThinShape(body);
    assert.equal(result.valid, true, `errors: ${result.errors.join(' | ')}`);
  });

  it('bad fixture fails with missing-section, no-group-citation, and duplication errors', () => {
    const body = fs.readFileSync(BAD, 'utf8');
    const result = validateThinShape(body);
    assert.equal(result.valid, false);
    const joined = result.errors.join(' | ');
    assert.match(joined, /missing Cleanup section/);
    assert.match(joined, /missing Issue number citation/);
    assert.match(joined, /workflow duplication/);
  });

  it('live .claude/plans/** sweep: every plan passes', () => {
    if (!fs.existsSync(PLANS_DIR)) return;
    const offenders: Array<{ file: string; errors: string[] }> = [];
    for (const f of fs.readdirSync(PLANS_DIR)) {
      if (!f.endsWith('.md')) continue;
      const full = path.join(PLANS_DIR, f);
      const body = fs.readFileSync(full, 'utf8');
      const result = validateThinShape(body);
      if (!result.valid) offenders.push({ file: f, errors: result.errors });
    }
    assert.deepEqual(
      offenders,
      [],
      'plans violating thin-shape contract: ' +
        offenders.map((o) => `${o.file} [${o.errors.join(', ')}]`).join(' ; '),
    );
  });
});
