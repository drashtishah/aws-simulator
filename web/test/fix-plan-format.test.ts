import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Schema test for /fix plans.
 *
 * /fix delegates plan-writing to superpowers:writing-plans, so /fix
 * itself never produces plan text. This test asserts the contract that
 * /fix imposes on the plans it expects back, using a good and a bad
 * fixture.
 *
 * Contract (from .claude/skills/fix/SKILL.md rules + plan-preamble.md):
 *   1. Every plan begins with a Workflow section.
 *   2. Every plan begins with a Testing section.
 *   3. Every Group has at least one Closes/Ref/Feedback citation.
 *   4. Every Group lists at least one absolute path under Files.
 *
 * Spec: PR-H, H.2.5 (issue #65)
 */

const ROOT = path.resolve(__dirname, '..', '..');
const GOOD = path.join(ROOT, 'web/test/fixtures/fix-plan-good.md');
const BAD = path.join(ROOT, 'web/test/fixtures/fix-plan-bad.md');
const SIBLING_GOOD = path.join(ROOT, 'web/test/fixtures/fix-plan-sibling-good.md');
const SIBLING_BAD = path.join(ROOT, 'web/test/fixtures/fix-plan-sibling-bad.md');

interface Group {
  name: string;
  body: string;
}

function parseGroups(plan: string): Group[] {
  const groups: Group[] = [];
  const lines = plan.split('\n');
  let current: Group | null = null;
  for (const line of lines) {
    const m = line.match(/^## (Group [^:]*:?.*)$/);
    if (m) {
      if (current) groups.push(current);
      current = { name: m[1].trim(), body: '' };
    } else if (current) {
      current.body += line + '\n';
    }
  }
  if (current) groups.push(current);
  return groups;
}

interface PlanValidation {
  valid: boolean;
  errors: string[];
}

interface ValidateOptions {
  sibling?: boolean;
}

function validateFixPlan(plan: string, _opts: ValidateOptions = {}): PlanValidation {
  const errors: string[] = [];
  if (!/^## Workflow\b/m.test(plan)) errors.push('missing Workflow section');
  if (!/^## Testing\b/m.test(plan)) errors.push('missing Testing section');

  const groups = parseGroups(plan);
  if (groups.length === 0) errors.push('plan has no Groups');

  for (const g of groups) {
    const hasCitation = /(Closes #\d+|Ref #\d+|Feedback:)/.test(g.body);
    if (!hasCitation) {
      errors.push(`${g.name}: missing Closes/Ref/Feedback citation`);
    }
    // Find absolute paths under "Files:" section.
    const filesIdx = g.body.indexOf('Files:');
    let filesBlock = '';
    if (filesIdx !== -1) {
      const stepsIdx = g.body.indexOf('Steps:', filesIdx);
      filesBlock = stepsIdx === -1 ? g.body.slice(filesIdx) : g.body.slice(filesIdx, stepsIdx);
    }
    const hasAbsPath = /(^|\s)\/[^\s]+\.(ts|md|json|jsonl|js)/.test(filesBlock);
    if (!hasAbsPath) {
      errors.push(`${g.name}: Files section needs at least 1 absolute path`);
    }
  }

  return { valid: errors.length === 0, errors };
}

describe('fix plan format', () => {
  it('good fixture passes', () => {
    const body = fs.readFileSync(GOOD, 'utf8');
    const result = validateFixPlan(body);
    assert.equal(result.valid, true, `errors: ${result.errors.join(' | ')}`);
  });

  it('bad fixture fails with citation and absolute-path errors', () => {
    const body = fs.readFileSync(BAD, 'utf8');
    const result = validateFixPlan(body);
    assert.equal(result.valid, false);
    const joined = result.errors.join(' | ');
    assert.match(joined, /Closes\/Ref\/Feedback citation/);
    assert.match(joined, /absolute path/);
  });

  it('sibling good fixture passes with sibling=true', () => {
    const body = fs.readFileSync(SIBLING_GOOD, 'utf8');
    const result = validateFixPlan(body, { sibling: true });
    assert.equal(result.valid, true, `errors: ${result.errors.join(' | ')}`);
  });

  it('sibling bad fixture fails with Sibling plans error when sibling=true', () => {
    const body = fs.readFileSync(SIBLING_BAD, 'utf8');
    const result = validateFixPlan(body, { sibling: true });
    assert.equal(result.valid, false);
    assert.match(result.errors.join(' | '), /Sibling plans/);
  });
});
