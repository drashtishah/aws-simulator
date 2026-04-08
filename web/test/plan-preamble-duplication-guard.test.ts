'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const PREAMBLE = path.join(ROOT, '.claude/skills/fix/references/plan-preamble.md');

const FORBIDDEN_DUPLICATIONS = [
  'no squash',
  'tests first, watch them fail',
  'git revert <sha>',
  'rebase -i',
  'force.push',
];

const REQUIRED_POINTER = 'references/architecture/core-workflow.md';

describe('plan-preamble.md duplication guard', () => {
  it('contains a pointer to core-workflow.md', () => {
    const body = fs.readFileSync(PREAMBLE, 'utf8');
    assert.ok(body.includes(REQUIRED_POINTER), 'plan-preamble.md must reference core-workflow.md');
  });

  it('does not duplicate canonical phrases from core-workflow.md', () => {
    const body = fs.readFileSync(PREAMBLE, 'utf8').toLowerCase();
    const offenders = FORBIDDEN_DUPLICATIONS.filter((p: string) => body.includes(p.toLowerCase()));
    assert.deepEqual(offenders, [],
      'plan-preamble.md duplicates these phrases from core-workflow.md (use a section-pointer instead): ' + offenders.join(', '));
  });

  it('Workflow section is short (under 30 lines)', () => {
    const body = fs.readFileSync(PREAMBLE, 'utf8');
    const start = body.indexOf('## Workflow');
    const next = body.indexOf('\n## ', start + 5);
    const section = body.slice(start, next === -1 ? undefined : next);
    const lines = section.split('\n').length;
    assert.ok(lines < 30, 'plan-preamble.md ## Workflow grew to ' + lines + ' lines; should stay a pointer (<30 lines)');
  });
});
