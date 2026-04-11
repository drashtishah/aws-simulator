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
