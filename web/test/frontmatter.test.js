const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { stripFrontmatter } = require('../lib/frontmatter');

describe('stripFrontmatter', () => {
  it('returns body and empty meta when no frontmatter', () => {
    const result = stripFrontmatter('Hello world');
    assert.deepStrictEqual(result.meta, {});
    assert.equal(result.body, 'Hello world');
  });

  it('parses key-value pairs from frontmatter', () => {
    const input = '---\ntitle: My Doc\nauthor: Test\n---\nBody text';
    const result = stripFrontmatter(input);
    assert.equal(result.meta.title, 'My Doc');
    assert.equal(result.meta.author, 'Test');
    assert.equal(result.body, 'Body text');
  });

  it('strips quotes from values', () => {
    const input = '---\ntitle: "Quoted"\nname: \'Single\'\n---\nBody';
    const result = stripFrontmatter(input);
    assert.equal(result.meta.title, 'Quoted');
    assert.equal(result.meta.name, 'Single');
  });

  it('handles empty body after frontmatter', () => {
    const input = '---\ntitle: Only Meta\n---\n';
    const result = stripFrontmatter(input);
    assert.equal(result.meta.title, 'Only Meta');
    assert.equal(result.body, '');
  });
});
