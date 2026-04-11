import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { renderMarkdown } from '../public/markdown.ts';


describe('renderMarkdown', () => {
  // In Node.js test environment, marked is not loaded (CDN-only).
  // The fallback path returns escaped HTML.

  it('returns empty string for empty input', () => {
    assert.equal(renderMarkdown(''), '');
    assert.equal(renderMarkdown(null), '');
  });

  it('returns text for plain input (fallback mode)', () => {
    const output = renderMarkdown('hello world');
    assert.ok(output.includes('hello world'));
  });

  it('escapes HTML in fallback mode', () => {
    const output = renderMarkdown('<script>alert("xss")</script>');
    assert.ok(!output.includes('<script>'));
    assert.ok(output.includes('&lt;script&gt;'));
  });

  it('source references marked.parse', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'markdown.ts'), 'utf8');
    assert.ok(source.includes('marked.parse'),
      'markdown.ts should reference marked.parse');
  });

  it('source configures highlight.js integration', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'markdown.ts'), 'utf8');
    assert.ok(source.includes('hljs'),
      'markdown.ts should reference hljs for syntax highlighting');
  });
});
