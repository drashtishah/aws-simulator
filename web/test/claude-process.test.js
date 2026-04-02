const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const { parseStreamJson, verifyAutosave, sessions } = require('../lib/claude-process');

const ROOT = path.resolve(__dirname, '..', '..');

// --- parseStreamJson ---

describe('parseStreamJson', () => {
  it('extracts text from assistant messages', () => {
    const stdout = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-123' }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello, investigator.' }] } }),
      JSON.stringify({ type: 'result', input_tokens: 100, output_tokens: 50 })
    ].join('\n');

    const result = parseStreamJson(stdout);
    assert.equal(result.claudeSessionId, 'sess-123');
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].type, 'text');
    assert.ok(result.events[0].content.includes('Hello, investigator.'));
    assert.equal(result.usage.input_tokens, 100);
    assert.equal(result.usage.output_tokens, 50);
  });

  it('parses console markers into console events', () => {
    const stdout = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-456' }),
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [{
            type: 'text',
            text: 'Checking CloudWatch. [CONSOLE_START]{"metric": "CPUUtilization", "value": 99.2}[CONSOLE_END] That looks high.'
          }]
        }
      }),
      JSON.stringify({ type: 'result' })
    ].join('\n');

    const result = parseStreamJson(stdout);
    assert.equal(result.events.length, 3);
    assert.equal(result.events[0].type, 'text');
    assert.ok(result.events[0].content.includes('Checking CloudWatch.'));
    assert.equal(result.events[1].type, 'console');
    assert.ok(result.events[1].content.includes('CPUUtilization'));
    assert.equal(result.events[2].type, 'text');
    assert.ok(result.events[2].content.includes('That looks high.'));
  });

  it('parses coaching markers into coaching events', () => {
    const stdout = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-789' }),
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [{
            type: 'text',
            text: 'Summary. [COACHING_START]## What you did well\nGood investigation.[COACHING_END]'
          }]
        }
      }),
      JSON.stringify({ type: 'result' })
    ].join('\n');

    const result = parseStreamJson(stdout);
    const coaching = result.events.find(e => e.type === 'coaching');
    assert.ok(coaching);
    assert.ok(coaching.content.includes('What you did well'));
  });

  it('detects SESSION_COMPLETE marker', () => {
    const stdout = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-end' }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Done. [SESSION_COMPLETE]' }] }
      }),
      JSON.stringify({ type: 'result' })
    ].join('\n');

    const result = parseStreamJson(stdout);
    assert.ok(result.sessionComplete);
    // Marker should be stripped from event content
    for (const event of result.events) {
      assert.ok(!event.content.includes('[SESSION_COMPLETE]'));
    }
  });

  it('extracts model from init message', () => {
    const stdout = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-m1', model: 'claude-sonnet-4-20250514' }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello.' }] } }),
      JSON.stringify({ type: 'result' })
    ].join('\n');

    const result = parseStreamJson(stdout);
    assert.equal(result.claudeModel, 'claude-sonnet-4-20250514');
  });

  it('returns null claudeModel when init has no model field', () => {
    const stdout = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-m2' }),
      JSON.stringify({ type: 'result' })
    ].join('\n');

    const result = parseStreamJson(stdout);
    assert.equal(result.claudeModel, null);
  });

  it('handles empty stdout gracefully', () => {
    const result = parseStreamJson('');
    assert.equal(result.claudeSessionId, null);
    assert.ok(Array.isArray(result.events));
  });

  it('handles malformed JSON lines gracefully', () => {
    const stdout = 'not json\n{"type":"system","subtype":"init","session_id":"s1"}\nbroken{';
    const result = parseStreamJson(stdout);
    assert.equal(result.claudeSessionId, 's1');
  });

  it('concatenates multiple text blocks from one message', () => {
    const stdout = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 's2' }),
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Part one. ' },
            { type: 'text', text: 'Part two.' }
          ]
        }
      }),
      JSON.stringify({ type: 'result' })
    ].join('\n');

    const result = parseStreamJson(stdout);
    const text = result.events.map(e => e.content).join('');
    assert.ok(text.includes('Part one.'));
    assert.ok(text.includes('Part two.'));
  });

  it('extracts usage with duration_ms', () => {
    const stdout = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 's3' }),
      JSON.stringify({ type: 'result', input_tokens: 500, output_tokens: 200, duration_ms: 3500 })
    ].join('\n');

    const result = parseStreamJson(stdout);
    assert.equal(result.usage.input_tokens, 500);
    assert.equal(result.usage.output_tokens, 200);
    assert.equal(result.usage.duration_ms, 3500);
  });

  it('handles multiple console blocks', () => {
    const stdout = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 's4' }),
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [{
            type: 'text',
            text: 'First. [CONSOLE_START]data1[CONSOLE_END] Middle. [CONSOLE_START]data2[CONSOLE_END] End.'
          }]
        }
      }),
      JSON.stringify({ type: 'result' })
    ].join('\n');

    const result = parseStreamJson(stdout);
    const consoleEvents = result.events.filter(e => e.type === 'console');
    assert.equal(consoleEvents.length, 2);
    assert.equal(consoleEvents[0].content, 'data1');
    assert.equal(consoleEvents[1].content, 'data2');
  });
});

// --- verifyAutosave ---

describe('verifyAutosave', () => {
  const sessionsDir = path.join(ROOT, 'learning', 'sessions');
  const testSimId = '__test-autosave-verify__';
  const testDir = path.join(sessionsDir, testSimId);
  const testFile = path.join(testDir, 'session.json');

  function ensureDir() {
    fs.mkdirSync(testDir, { recursive: true });
  }

  function cleanup() {
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
  }

  it('returns file_missing when session file does not exist', () => {
    const result = verifyAutosave('nonexistent-sim-xyz', new Date());
    assert.equal(result.ok, false);
    assert.equal(result.failedCheck, 'file_missing');
  });

  it('returns invalid_json for malformed file', () => {
    ensureDir();
    fs.writeFileSync(testFile, 'not json');
    const result = verifyAutosave(testSimId, new Date(0));
    cleanup();
    assert.equal(result.ok, false);
    assert.equal(result.failedCheck, 'invalid_json');
  });

  it('returns sim_id_mismatch when sim_id differs', () => {
    ensureDir();
    fs.writeFileSync(testFile, JSON.stringify({ sim_id: 'other-sim', last_active: new Date().toISOString() }));
    const result = verifyAutosave(testSimId, new Date(0));
    cleanup();
    assert.equal(result.ok, false);
    assert.equal(result.failedCheck, 'sim_id_mismatch');
  });

  it('returns stale_timestamp when last_active is before turn start', () => {
    ensureDir();
    const old = new Date('2020-01-01');
    fs.writeFileSync(testFile, JSON.stringify({ sim_id: testSimId, last_active: old.toISOString() }));
    const result = verifyAutosave(testSimId, new Date());
    cleanup();
    assert.equal(result.ok, false);
    assert.equal(result.failedCheck, 'stale_timestamp');
  });

  it('returns ok when file is valid and fresh', () => {
    ensureDir();
    const now = new Date();
    fs.writeFileSync(testFile, JSON.stringify({ sim_id: testSimId, last_active: now.toISOString() }));
    const result = verifyAutosave(testSimId, new Date(now.getTime() - 1000));
    cleanup();
    assert.equal(result.ok, true);
    assert.equal(result.failedCheck, null);
  });
});

// --- sendMessage SESSION_LOST ---

describe('sendMessage', () => {
  const { sendMessage } = require('../lib/claude-process');

  it('throws SESSION_LOST for unknown sessionId', async () => {
    await assert.rejects(
      () => sendMessage('nonexistent-session-id', 'hello'),
      (err) => {
        assert.ok(err.message.includes('SESSION_LOST'), 'error should include SESSION_LOST');
        assert.ok(err.message.includes('No active session'), 'error should describe the problem');
        return true;
      }
    );
  });
});

// --- endSession ---

describe('endSession', () => {
  const { endSession } = require('../lib/claude-process');

  it('silently handles nonexistent session', async () => {
    // Should not throw
    await endSession('nonexistent-session-xyz');
  });

  it('removes session from sessions map and cleans up prompt file', async () => {
    const promptFile = path.join('/tmp', 'aws-sim-test-cleanup-' + Date.now() + '.txt');
    fs.writeFileSync(promptFile, 'test prompt');

    const testId = 'test-end-session-' + Date.now();
    sessions.set(testId, {
      claudeSessionId: 'claude-123',
      simId: 'test-sim',
      promptFile
    });

    await endSession(testId);

    assert.ok(!sessions.has(testId), 'session should be removed from map');
    assert.ok(!fs.existsSync(promptFile), 'prompt file should be deleted');
  });
});

// --- sessions map ---

describe('sessions map', () => {
  it('is exported and is a Map', () => {
    assert.ok(sessions instanceof Map);
  });
});
