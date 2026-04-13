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

  it('does not treat ### header inside a code fence as section anchor', () => {
    const body = `## Plan
### Scope
Real scope content.

### Files to read
- real-file.ts

\`\`\`typescript
### Scope
// fenced code
\`\`\`

- after-fence.ts

### Files to change
- foo.ts`;
    const result = patchBody(body, 'Files to read', '- bar.ts');
    // new content inserted
    assert.ok(result.includes('- bar.ts'));
    // unrelated sections preserved
    assert.ok(result.includes('Real scope content.'));
    assert.ok(result.includes('### Files to change'));
    // content between fenced ### and real next section belongs to Files to read: must be replaced
    assert.ok(!result.includes('- after-fence.ts'));
  });
});

describe('VALID_SECTIONS', () => {
  it('contains all eight template sections', () => {
    const expected = [
      'Scope',
      'Files to read',
      'Files to change',
      'Files NOT to touch',
      'Tests',
      'Verification command',
      'Risks / open questions',
      'Decomposition (only if split occurred)',
    ];
    assert.deepEqual(VALID_SECTIONS, expected);
  });
});
