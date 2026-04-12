import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { patchBody, VALID_SECTIONS } from '../../scripts/patch-plan';

const SAMPLE_BODY = `## Plan
### Scope
focused

### Files to read
- foo.ts, context

### Files to change
- foo.ts:10, change x to y

### Tests
- new test: web/test/foo.test.ts

### Verification command
- npm test

### Risks / open questions
- none`;

describe('patchBody', () => {
  it('replaces a middle section', () => {
    const result = patchBody(SAMPLE_BODY, 'Files to change', '- bar.ts:20, change a to b');
    assert.ok(result.includes('- bar.ts:20, change a to b'));
    assert.ok(!result.includes('- foo.ts:10, change x to y'));
    assert.ok(result.includes('### Tests'));
  });

  it('replaces the last section', () => {
    const result = patchBody(SAMPLE_BODY, 'Risks / open questions', '- new risk');
    assert.ok(result.includes('- new risk'));
    assert.ok(!result.includes('- none'));
  });

  it('preserves all other sections unchanged', () => {
    const result = patchBody(SAMPLE_BODY, 'Scope', 'system-wide: cross-cutting');
    assert.ok(result.includes('- foo.ts, context'));
    assert.ok(result.includes('- foo.ts:10, change x to y'));
    assert.ok(result.includes('- npm test'));
  });

  it('throws when section not found', () => {
    assert.throws(
      () => patchBody(SAMPLE_BODY, 'Nonexistent Section', 'content'),
      /Section not found/
    );
  });

  it('throws when body has no plan sections', () => {
    assert.throws(
      () => patchBody('just some text', 'Scope', 'content'),
      /Section not found/
    );
  });
});

describe('VALID_SECTIONS', () => {
  it('contains all six template sections', () => {
    const expected = [
      'Scope',
      'Files to read',
      'Files to change',
      'Tests',
      'Verification command',
      'Risks / open questions',
    ];
    assert.deepEqual(VALID_SECTIONS, expected);
  });
});
