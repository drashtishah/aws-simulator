import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as claudeStream from '../lib/claude-stream';


describe('claude-stream exports', () => {
  it('exports streamQuery as an async generator function', () => {
    assert.equal(typeof claudeStream.streamQuery, 'function');
    assert.equal(claudeStream.streamQuery.constructor.name, 'AsyncGeneratorFunction');
  });

  it('exports streamSession as an async generator function', () => {
    assert.equal(typeof claudeStream.streamSession, 'function');
    assert.equal(claudeStream.streamSession.constructor.name, 'AsyncGeneratorFunction');
  });

  it('exports streamMessage as an async generator function', () => {
    assert.equal(typeof claudeStream.streamMessage, 'function');
    assert.equal(claudeStream.streamMessage.constructor.name, 'AsyncGeneratorFunction');
  });
});
