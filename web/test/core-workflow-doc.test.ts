'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DOC = path.join(ROOT, 'references', 'architecture', 'core-workflow.md');

describe('core-workflow.md', () => {
  it('exists', () => {
    assert.ok(fs.existsSync(DOC), 'references/architecture/core-workflow.md should exist');
  });

  it('is at most 200 lines', () => {
    const lines = fs.readFileSync(DOC, 'utf8').split('\n');
    assert.ok(lines.length <= 200, `expected <= 200 lines, got ${lines.length}`);
  });

  it('contains exactly 11 top-level H2 sections', () => {
    const content = fs.readFileSync(DOC, 'utf8');
    const h2 = content.split('\n').filter((l: string) => /^## /.test(l));
    assert.equal(h2.length, 11, `expected 11 '## ' sections, got ${h2.length}`);
  });

  it('mentions all 11 required workflow topics', () => {
    const content = fs.readFileSync(DOC, 'utf8').toLowerCase();
    const needles = [
      'issue first',
      'worktree',
      'plan',
      'tdd',
      'revertable',
      'sim-test --changed',
      'notes.jsonl',
      'verifier',
      'revert',
      'cleanup',
      'testing-system.md',
    ];
    for (const n of needles) {
      assert.ok(content.includes(n.toLowerCase()), `missing topic: ${n}`);
    }
  });

  it('contains explicit merge strategy rule (no squash, git revert, independently revertable)', () => {
    const content = fs.readFileSync(DOC, 'utf8');
    assert.ok(/no squash/i.test(content), 'must state "no squash"');
    assert.ok(/git revert/i.test(content), 'must reference git revert');
    assert.ok(/independently revertable/i.test(content), 'must state "independently revertable"');
  });

  it('forbids interactive rebase and force push', () => {
    const content = fs.readFileSync(DOC, 'utf8');
    assert.ok(/rebase -i/i.test(content), 'must warn against git rebase -i');
    assert.ok(/push --force|force.?push/i.test(content), 'must warn against force push');
  });

  it('section 5 frames revertability at the PR merge-commit boundary', () => {
    const content = fs.readFileSync(DOC, 'utf8');
    const sect5Start = content.indexOf('## 5.');
    assert.notEqual(sect5Start, -1, 'section 5 should exist');
    const sect6Start = content.indexOf('## 6.', sect5Start);
    const sect5Body = content.slice(sect5Start, sect6Start);
    assert.match(sect5Body, /merge commit|no-ff/i, 'section 5 must describe the PR merge commit');
    assert.match(sect5Body, /PR.*boundary|revert.*whole PR|revert.*merge commit/i,
      'section 5 must frame revertability at the PR boundary');
  });
});
