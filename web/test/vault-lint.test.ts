import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { lintVault } from '../../scripts/vault-lint';

function mkTempVault(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-lint-'));
  for (const sub of ['problems', 'solutions', 'playbooks', 'patterns']) {
    fs.mkdirSync(path.join(root, sub), { recursive: true });
  }
  return root;
}

function seedIndex(root: string, body: string): void {
  fs.writeFileSync(path.join(root, 'index.md'), body);
}

function seedNote(root: string, kind: string, id: string, frontmatter: string, body = '## body\n'): void {
  const dir = path.join(root, kind + 's');
  fs.writeFileSync(path.join(dir, id + '.md'), frontmatter + body);
}

const VALID_PROBLEM_FM = `---
id: problem-test
kind: problem
title: test
tags: [kind/problem, scope/vault]
created: 2026-04-11
updated: 2026-04-11
source_issues: [#1]
confidence: observed
summary: a one-line summary under the cap
triggers: [foo]
solutions: []
related_problems: []
severity: nuisance
---
`;

const VALID_SOLUTION_FM = `---
id: solution-test
kind: solution
title: test solution
tags: [kind/solution, scope/vault]
created: 2026-04-11
updated: 2026-04-11
source_issues: [#1]
confidence: observed
summary: a one-line summary under the cap
applies_to: [problem-test]
preconditions: none
cost: trivial
---
`;

const VALID_PLAYBOOK_FM = `---
id: playbook-test
kind: playbook
title: test playbook
tags: [kind/playbook, scope/vault]
created: 2026-04-11
updated: 2026-04-11
source_issues: [#1]
confidence: observed
summary: a one-line summary under the cap
when: when a test needs a playbook
steps: 3
related: []
---
`;

const VALID_PATTERN_FM = `---
id: pattern-test
kind: pattern
title: test pattern
tags: [kind/pattern, scope/vault]
created: 2026-04-11
updated: 2026-04-11
source_issues: [#1]
confidence: observed
summary: a one-line summary under the cap
principle: keep it simple
counter_examples: []
---
`;

const VALID_INDEX = `---
tags: [kind/index, scope/vault]
updated: 2026-04-11
note_count: 0
---
# system-vault index
`;

describe('vault-lint', () => {
  describe('clean vault', () => {
    let root: string;
    before(() => {
      root = mkTempVault();
      seedIndex(root, VALID_INDEX);
      seedNote(root, 'problem', 'problem-test', VALID_PROBLEM_FM);
      seedNote(root, 'solution', 'solution-test', VALID_SOLUTION_FM);
      seedNote(root, 'playbook', 'playbook-test', VALID_PLAYBOOK_FM);
      seedNote(root, 'pattern', 'pattern-test', VALID_PATTERN_FM);
    });
    after(() => { fs.rmSync(root, { recursive: true, force: true }); });

    it('passes a well-formed vault', () => {
      const result = lintVault(root);
      assert.equal(result.ok, true, 'violations: ' + result.violations.join('; '));
      assert.deepEqual(result.violations, []);
    });
  });

  describe('missing vault', () => {
    it('returns ok: true for a non-existent vault (vault optional)', () => {
      const result = lintVault('/nonexistent/path/that/does/not/exist');
      assert.equal(result.ok, true);
    });
  });

  describe('index.md line cap', () => {
    let root: string;
    before(() => {
      root = mkTempVault();
      const longBody = VALID_INDEX + Array.from({ length: 130 }, (_, i) => '- line ' + i).join('\n') + '\n';
      seedIndex(root, longBody);
    });
    after(() => { fs.rmSync(root, { recursive: true, force: true }); });

    it('flags index.md over 120 lines', () => {
      const result = lintVault(root);
      assert.equal(result.ok, false);
      assert.ok(
        result.violations.some((v) => v.includes('index.md') && v.includes('120')),
        'expected an index.md 120-line violation: ' + result.violations.join('; '),
      );
    });
  });

  describe('note 80-line cap', () => {
    let root: string;
    before(() => {
      root = mkTempVault();
      seedIndex(root, VALID_INDEX);
      const longBody = '## body\n' + Array.from({ length: 90 }, (_, i) => 'line ' + i).join('\n') + '\n';
      seedNote(root, 'problem', 'problem-long', VALID_PROBLEM_FM, longBody);
    });
    after(() => { fs.rmSync(root, { recursive: true, force: true }); });

    it('flags notes over 80 lines', () => {
      const result = lintVault(root);
      assert.equal(result.ok, false);
      assert.ok(
        result.violations.some((v) => v.includes('problem-long') && v.includes('80')),
        'expected an 80-line violation: ' + result.violations.join('; '),
      );
    });
  });

  describe('note 3KB cap', () => {
    let root: string;
    before(() => {
      root = mkTempVault();
      seedIndex(root, VALID_INDEX);
      // Under 80 lines but over 3KB: one very wide line.
      const bigLine = 'x'.repeat(4096);
      seedNote(root, 'problem', 'problem-big', VALID_PROBLEM_FM, '## body\n' + bigLine + '\n');
    });
    after(() => { fs.rmSync(root, { recursive: true, force: true }); });

    it('flags notes over 3KB', () => {
      const result = lintVault(root);
      assert.equal(result.ok, false);
      assert.ok(
        result.violations.some((v) => v.includes('problem-big') && v.includes('3KB')),
        'expected a 3KB violation: ' + result.violations.join('; '),
      );
    });
  });

  describe('missing frontmatter fields', () => {
    let root: string;
    before(() => {
      root = mkTempVault();
      seedIndex(root, VALID_INDEX);
      const missing = `---
id: problem-missing
kind: problem
title: missing fields
---
## body
`;
      seedNote(root, 'problem', 'problem-missing', '', missing);
    });
    after(() => { fs.rmSync(root, { recursive: true, force: true }); });

    it('flags missing required fields on a problem', () => {
      const result = lintVault(root);
      assert.equal(result.ok, false);
      assert.ok(
        result.violations.some((v) => v.includes('problem-missing') && v.includes('summary')),
        'expected a missing summary violation: ' + result.violations.join('; '),
      );
    });
  });

  describe('summary too long', () => {
    let root: string;
    before(() => {
      root = mkTempVault();
      seedIndex(root, VALID_INDEX);
      const longSummary = 'x'.repeat(200);
      const fm = VALID_PROBLEM_FM.replace(
        'summary: a one-line summary under the cap',
        'summary: ' + longSummary,
      );
      seedNote(root, 'problem', 'problem-long-summary', fm);
    });
    after(() => { fs.rmSync(root, { recursive: true, force: true }); });

    it('flags summary over 160 chars', () => {
      const result = lintVault(root);
      assert.equal(result.ok, false);
      assert.ok(
        result.violations.some((v) => v.includes('problem-long-summary') && v.includes('160')),
        'expected a 160-char summary violation: ' + result.violations.join('; '),
      );
    });
  });

  describe('note count hard cap', () => {
    let root: string;
    before(() => {
      root = mkTempVault();
      seedIndex(root, VALID_INDEX);
      for (let i = 0; i < 401; i++) {
        const fm = VALID_PROBLEM_FM.replace('id: problem-test', 'id: problem-' + i);
        seedNote(root, 'problem', 'problem-' + i, fm);
      }
    });
    after(() => { fs.rmSync(root, { recursive: true, force: true }); });

    it('flags >400 total notes', () => {
      const result = lintVault(root);
      assert.equal(result.ok, false);
      assert.ok(
        result.violations.some((v) => v.includes('400')),
        'expected a 400-note hard cap violation: ' + result.violations.join('; '),
      );
    });
  });
});
