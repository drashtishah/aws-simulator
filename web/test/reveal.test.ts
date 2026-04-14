import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { splitIntoRevealUnits } from '../public/reveal.ts';

describe('splitIntoRevealUnits', () => {
  it('returns empty array for empty string', () => {
    assert.deepEqual(splitIntoRevealUnits(''), []);
  });

  it('returns two strings for two paragraphs', () => {
    const result = splitIntoRevealUnits('<p>First</p><p>Second</p>');
    assert.equal(result.length, 2);
    assert.ok(result[0].includes('First'));
    assert.ok(result[1].includes('Second'));
  });

  it('keeps code block atomic', () => {
    const result = splitIntoRevealUnits('<pre><code>const x = 1;\nconst y = 2;</code></pre>');
    assert.equal(result.length, 1);
  });

  it('keeps mermaid-diagram div atomic', () => {
    const result = splitIntoRevealUnits('<div class="mermaid-diagram"><svg></svg></div>');
    assert.equal(result.length, 1);
  });
});
