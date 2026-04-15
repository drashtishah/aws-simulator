import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import paths from '../lib/paths';

function readAgentPrompts(): string {
  return fs.readFileSync(paths.AGENT_PROMPTS, 'utf8');
}

function sliceEndingBlock(text: string): string {
  const start = text.indexOf('\nEnding:');
  assert.ok(start !== -1, 'Ending: section must exist in agent-prompts.md');
  // End at the next blank-line followed by a top-level heading (line ending
  // with ':' at column 0), which is how the sibling sections are delimited.
  const rest = text.slice(start + 1);
  const match = rest.match(/\n\n[A-Z][A-Za-z ]+:\n/);
  const end = match && match.index !== undefined ? start + 1 + match.index : text.length;
  return text.slice(start + 1, end);
}

describe('narrator Ending block in agent-prompts.md', () => {
  it('a) contains the [SESSION_COMPLETE] protocol instruction', () => {
    const block = sliceEndingBlock(readAgentPrompts());
    assert.ok(
      block.includes('[SESSION_COMPLETE]'),
      'Ending block must instruct the narrator to emit [SESSION_COMPLETE]'
    );
  });

  it('b) does not contain the legacy "Do not offer" blocklist phrase', () => {
    const block = sliceEndingBlock(readAgentPrompts());
    assert.ok(
      !block.includes('Do not offer'),
      'legacy blocklist phrase "Do not offer" must be removed'
    );
  });

  it('c) does not contain the legacy "Do not end on a lull" blocklist phrase', () => {
    const block = sliceEndingBlock(readAgentPrompts());
    assert.ok(
      !block.includes('Do not end on a lull'),
      'legacy blocklist phrase "Do not end on a lull" must be removed'
    );
  });

  it('d) specifies the two-sentence wrap-up structure and anchors on "natural close"', () => {
    const block = sliceEndingBlock(readAgentPrompts());
    assert.ok(
      block.includes('two sentences'),
      'Ending block must state the wrap-up is two sentences'
    );
    assert.ok(
      block.includes('natural close'),
      'Ending block must anchor on the phrase "natural close"'
    );
  });
});
