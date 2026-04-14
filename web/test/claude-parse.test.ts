import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as claudeParse from '../lib/claude-parse';


describe('claude-parse exports', () => {
  it('exports parseEvents as a function', () => {
    assert.equal(typeof claudeParse.parseEvents, 'function');
  });

  it('exports parseAgentMessages as a function', () => {
    assert.equal(typeof claudeParse.parseAgentMessages, 'function');
  });

  it('exports logTurn as a function', () => {
    assert.equal(typeof claudeParse.logTurn, 'function');
  });

  it('exports collectMessages as a function', () => {
    assert.equal(typeof claudeParse.collectMessages, 'function');
  });

  it('exports withRetry as a function', () => {
    assert.equal(typeof claudeParse.withRetry, 'function');
  });

  it('exports COLLECT_TIMEOUT_MS as a number', () => {
    assert.equal(typeof claudeParse.COLLECT_TIMEOUT_MS, 'number');
    assert.equal(claudeParse.COLLECT_TIMEOUT_MS, 120000);
  });
});

describe('parseAgentMessages usage cache fields', () => {
  it('propagates cache_read_input_tokens and cache_creation_input_tokens from a result message', () => {
    const messages = [
      { type: 'system', subtype: 'init', session_id: 's1', model: 'claude-sonnet-4-6' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } },
      {
        type: 'result',
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_read_input_tokens: 5000,
          cache_creation_input_tokens: 800,
        },
        duration_ms: 1234,
      },
    ];

    const parsed = claudeParse.parseAgentMessages(messages as Parameters<typeof claudeParse.parseAgentMessages>[0]);

    assert.equal(parsed.usage?.input_tokens, 100);
    assert.equal(parsed.usage?.output_tokens, 20);
    assert.equal((parsed.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens, 5000);
    assert.equal((parsed.usage as { cache_creation_input_tokens?: number }).cache_creation_input_tokens, 800);
    assert.equal(parsed.usage?.duration_ms, 1234);
  });

  it('defaults cache fields to undefined when absent from the SDK result', () => {
    const messages = [
      { type: 'system', subtype: 'init', session_id: 's2', model: 'claude-sonnet-4-6' },
      { type: 'result', usage: { input_tokens: 50, output_tokens: 10 } },
    ];

    const parsed = claudeParse.parseAgentMessages(messages as Parameters<typeof claudeParse.parseAgentMessages>[0]);

    assert.equal((parsed.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens, undefined);
    assert.equal((parsed.usage as { cache_creation_input_tokens?: number }).cache_creation_input_tokens, undefined);
  });
});
