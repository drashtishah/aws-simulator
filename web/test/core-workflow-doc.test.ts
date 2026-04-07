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

  it('contains exactly 10 top-level H2 sections', () => {
    const content = fs.readFileSync(DOC, 'utf8');
    const h2 = content.split('\n').filter((l: string) => /^## /.test(l));
    assert.equal(h2.length, 10, `expected 10 '## ' sections, got ${h2.length}`);
  });

  it('mentions all 10 required workflow topics', () => {
    const content = fs.readFileSync(DOC, 'utf8').toLowerCase();
    const needles = [
      'issue first',
      'worktree',
      'plan',
      'tdd',
      'revertable',
      'sim-test --changed',
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
});
