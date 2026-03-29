const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { renderMarkdown } = require('../public/markdown.js');

describe('renderMarkdown', () => {
  it('renders bold text with double asterisks', () => {
    assert.equal(renderMarkdown('**bold**'), '<p><strong>bold</strong></p>');
  });

  it('renders italic text with single asterisks', () => {
    assert.equal(renderMarkdown('*italic*'), '<p><em>italic</em></p>');
  });

  it('renders inline code with backticks', () => {
    assert.equal(renderMarkdown('use `kubectl`'), '<p>use <code>kubectl</code></p>');
  });

  it('renders code blocks with triple backticks', () => {
    const input = '```\nconst x = 1;\n```';
    const output = renderMarkdown(input);
    assert.ok(output.includes('<pre><code>'));
    assert.ok(output.includes('const x = 1;'));
  });

  it('renders horizontal rules', () => {
    assert.ok(renderMarkdown('---').includes('<hr'));
  });

  it('renders h2 headers', () => {
    assert.ok(renderMarkdown('## Title').includes('<h2>'));
    assert.ok(renderMarkdown('## Title').includes('Title'));
  });

  it('renders h3 headers', () => {
    assert.ok(renderMarkdown('### Subtitle').includes('<h3>'));
  });

  it('renders unordered lists', () => {
    const input = '- item one\n- item two';
    const output = renderMarkdown(input);
    assert.ok(output.includes('<ul>'));
    assert.ok(output.includes('<li>'));
    assert.ok(output.includes('item one'));
  });

  it('escapes HTML entities in text', () => {
    const output = renderMarkdown('use <script> tag');
    assert.ok(!output.includes('<script>'));
    assert.ok(output.includes('&lt;script&gt;'));
  });

  it('handles empty input', () => {
    assert.equal(renderMarkdown(''), '');
  });

  it('handles plain text without markdown', () => {
    assert.equal(renderMarkdown('hello world'), '<p>hello world</p>');
  });

  it('renders numbered lists', () => {
    const input = '1. first\n2. second';
    const output = renderMarkdown(input);
    assert.ok(output.includes('<ol>'));
    assert.ok(output.includes('<li>'));
  });

  it('handles mixed bold and italic', () => {
    const output = renderMarkdown('**bold** and *italic*');
    assert.ok(output.includes('<strong>bold</strong>'));
    assert.ok(output.includes('<em>italic</em>'));
  });
});
