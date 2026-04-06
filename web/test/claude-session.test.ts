const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const claudeSession = require('../lib/claude-session');

describe('claude-session exports', () => {
  it('exports sessions as a Map', () => {
    assert.ok(claudeSession.sessions instanceof Map);
  });

  it('exports SESSION_MAX_AGE_MS as a number', () => {
    assert.equal(typeof claudeSession.SESSION_MAX_AGE_MS, 'number');
    assert.ok(claudeSession.SESSION_MAX_AGE_MS > 0);
  });

  it('exports persistSession as a function', () => {
    assert.equal(typeof claudeSession.persistSession, 'function');
  });

  it('exports recoverSessions as a function', () => {
    assert.equal(typeof claudeSession.recoverSessions, 'function');
  });

  it('exports createGameSession as a function', () => {
    assert.equal(typeof claudeSession.createGameSession, 'function');
  });

  it('exports updateGameSession as a function', () => {
    assert.equal(typeof claudeSession.updateGameSession, 'function');
  });
});
