'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const SKILL = path.join(ROOT, '.claude/skills/fix/SKILL.md');

describe('/fix is the sole GitHub Issue creator (Issue #113)', () => {
  it('SKILL.md never-list no longer says /fix "never creates GitHub Issues"', () => {
    const body = fs.readFileSync(SKILL, 'utf8');
    assert.ok(
      !/never creates\s+GitHub Issues/i.test(body),
      '/fix SKILL.md still claims it "never creates GitHub Issues"; the contract must flip per Issue #113'
    );
  });

  it('SKILL.md Flow has a step 5b that calls gh issue create', () => {
    const body = fs.readFileSync(SKILL, 'utf8');
    assert.match(body, /5b\./, 'SKILL.md Flow missing step 5b for Issue creation');
    const idx = body.indexOf('5b.');
    const window = body.slice(idx, idx + 600);
    assert.ok(window.includes('gh issue create'), 'step 5b must instruct /fix to run gh issue create');
  });

  it('SKILL.md rule 2 no longer says orphan groups "propose creating an Issue"', () => {
    const body = fs.readFileSync(SKILL, 'utf8');
    assert.ok(
      !/propose creating an Issue/i.test(body),
      'rule 2 must flip: /fix creates the Issue in step 5b, plans only cite numbers'
    );
  });
});
