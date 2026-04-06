const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

// --- streamQuery source-level tests ---

describe('streamQuery', () => {
  const source = fs.readFileSync(path.join(ROOT, 'web', 'lib', 'claude-stream.ts'), 'utf8');

  it('is exported from claude-stream.js', () => {
    assert.ok(source.includes('streamQuery'),
      'claude-stream.js should define streamQuery');
  });

  it('is an async generator function', () => {
    assert.ok(source.includes('async function* streamQuery'),
      'streamQuery should be an async generator');
  });

  it('yields session_init event', () => {
    assert.ok(source.includes("type: 'session_init'"),
      'streamQuery should yield session_init events');
  });

  it('yields _metadata at end', () => {
    assert.ok(source.includes("type: '_metadata'"),
      'streamQuery should yield _metadata events');
  });

  it('handles abort controller', () => {
    assert.ok(source.includes('abortController'),
      'streamQuery should handle abort controllers');
  });
});

// --- streamSession source-level tests ---

describe('streamSession', () => {
  const source = fs.readFileSync(path.join(ROOT, 'web', 'lib', 'claude-stream.ts'), 'utf8');

  it('is exported from claude-stream.js', () => {
    assert.ok(source.includes('streamSession'),
      'claude-stream.js should export streamSession');
  });

  it('is an async generator function', () => {
    assert.ok(source.includes('async function* streamSession'),
      'streamSession should be an async generator');
  });

  it('yields session event as first event', () => {
    const fnStart = source.indexOf('async function* streamSession');
    const fnBlock = source.slice(fnStart, fnStart + 2000);
    assert.ok(fnBlock.includes("type: 'session'"),
      'streamSession should yield session event');
  });
});

// --- streamMessage source-level tests ---

describe('streamMessage', () => {
  const source = fs.readFileSync(path.join(ROOT, 'web', 'lib', 'claude-stream.ts'), 'utf8');

  it('is exported from claude-stream.js', () => {
    assert.ok(source.includes('streamMessage'),
      'claude-stream.js should export streamMessage');
  });

  it('is an async generator function', () => {
    assert.ok(source.includes('async function* streamMessage'),
      'streamMessage should be an async generator');
  });

  it('throws for nonexistent session', () => {
    const fnStart = source.indexOf('async function* streamMessage');
    const fnBlock = source.slice(fnStart, fnStart + 500);
    assert.ok(fnBlock.includes('SESSION_LOST'),
      'streamMessage should throw SESSION_LOST for missing session');
  });
});

// --- endSession abort ---

describe('endSession abort', () => {
  const source = fs.readFileSync(path.join(ROOT, 'web', 'lib', 'claude-session.ts'), 'utf8');

  it('calls abort on controller', () => {
    const fnStart = source.indexOf('async function endSession');
    const fnBlock = source.slice(fnStart, fnStart + 500);
    assert.ok(fnBlock.includes('abortController'),
      'endSession should abort running controller');
  });
});
