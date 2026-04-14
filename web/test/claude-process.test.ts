import { describe, it, beforeEach, afterEach, mock, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import { parseEvents, parseAgentMessages, logTurn, sendMessage, endSession, collectMessages, withRetry } from '../lib/claude-process';
import { sessions } from '../lib/claude-session';

const ROOT = path.resolve(__dirname, '..', '..');

// --- parseEvents (marker extraction, unchanged logic) ---

describe('parseEvents', () => {
  it('extracts text content', () => {
    const result = parseEvents('Hello, investigator.');
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].type, 'text');
    assert.ok(result.events[0].content.includes('Hello, investigator.'));
    assert.equal(result.sessionComplete, false);
  });

  it('detects SESSION_COMPLETE marker', () => {
    const text = 'Done. [SESSION_COMPLETE]';
    const result = parseEvents(text);
    assert.ok(result.sessionComplete);
    for (const event of result.events) {
      assert.ok(!event.content.includes('[SESSION_COMPLETE]'));
    }
  });

  it('handles empty text gracefully', () => {
    const result = parseEvents('');
    assert.ok(Array.isArray(result.events));
    assert.equal(result.sessionComplete, false);
  });
});

// --- parseAgentMessages ---

describe('parseAgentMessages', () => {
  it('extracts session_id from init message', () => {
    const messages = [
      { type: 'system', subtype: 'init', session_id: 'sess-abc' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello.' }] } },
      { type: 'result', duration_ms: 1000 }
    ];
    const result = parseAgentMessages(messages);
    assert.equal(result.claudeSessionId, 'sess-abc');
  });

  it('extracts model from init message', () => {
    const messages = [
      { type: 'system', subtype: 'init', session_id: 's1', model: 'claude-sonnet-4-6' },
      { type: 'result' }
    ];
    const result = parseAgentMessages(messages);
    assert.equal(result.claudeModel, 'claude-sonnet-4-6');
  });

  it('extracts text from assistant messages', () => {
    const messages = [
      { type: 'system', subtype: 'init', session_id: 's1' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Part one. ' }, { type: 'text', text: 'Part two.' }] } },
      { type: 'result' }
    ];
    const result = parseAgentMessages(messages);
    assert.ok(result.fullText.includes('Part one.'));
    assert.ok(result.fullText.includes('Part two.'));
  });

  it('extracts usage from result message', () => {
    const messages = [
      { type: 'system', subtype: 'init', session_id: 's1' },
      { type: 'result', duration_ms: 2500, usage: { input_tokens: 500, output_tokens: 200 } }
    ];
    const result = parseAgentMessages(messages);
    assert.equal(result.usage.input_tokens, 500);
    assert.equal(result.usage.output_tokens, 200);
    assert.equal(result.usage.duration_ms, 2500);
  });

  it('handles total_cost_usd from result', () => {
    const messages = [
      { type: 'system', subtype: 'init', session_id: 's1' },
      { type: 'result', total_cost_usd: 0.027, usage: { input_tokens: 100, output_tokens: 50 } }
    ];
    const result = parseAgentMessages(messages);
    assert.equal(result.usage.input_tokens, 100);
  });

  it('handles empty messages array', () => {
    const result = parseAgentMessages([]);
    assert.equal(result.claudeSessionId, null);
    assert.equal(result.fullText, '');
    assert.equal(result.usage, null);
  });

  it('skips hook messages and other system messages', () => {
    const messages = [
      { type: 'system', subtype: 'hook_started', hook_name: 'SessionStart:startup' },
      { type: 'system', subtype: 'hook_response', hook_name: 'SessionStart:startup' },
      { type: 'system', subtype: 'init', session_id: 's1' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello.' }] } },
      { type: 'rate_limit_event' },
      { type: 'result' }
    ];
    const result = parseAgentMessages(messages);
    assert.equal(result.claudeSessionId, 's1');
    assert.equal(result.fullText, 'Hello.');
  });

  it('skips thinking blocks in assistant messages', () => {
    const messages = [
      { type: 'system', subtype: 'init', session_id: 's1' },
      { type: 'assistant', message: { content: [
        { type: 'thinking', thinking: 'internal thought' },
        { type: 'text', text: 'Visible response.' }
      ] } },
      { type: 'result' }
    ];
    const result = parseAgentMessages(messages);
    assert.equal(result.fullText, 'Visible response.');
  });

  it('returns toolCalls array', () => {
    const messages = [
      { type: 'system', subtype: 'init', session_id: 's1' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Writing file.' }] } },
      { type: 'result' }
    ];
    const result = parseAgentMessages(messages);
    assert.ok(Array.isArray(result.toolCalls), 'toolCalls should be an array');
  });

  it('toolCalls is empty array when no tool_use blocks present', () => {
    const messages = [
      { type: 'system', subtype: 'init', session_id: 's1' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'No tools.' }] } },
      { type: 'result' }
    ];
    const result = parseAgentMessages(messages);
    assert.equal(result.toolCalls.length, 0);
  });

  it('captures Write tool calls with name, input, and id', () => {
    const messages = [
      { type: 'system', subtype: 'init', session_id: 's1' },
      { type: 'assistant', message: { content: [
        { type: 'text', text: 'Saving session.' },
        { type: 'tool_use', name: 'Write', input: { file_path: '/tmp/test.json', content: '{}' }, id: 'tool-1' }
      ] } },
      { type: 'result' }
    ];
    const result = parseAgentMessages(messages);
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0].name, 'Write');
    assert.equal(result.toolCalls[0].input.file_path, '/tmp/test.json');
    assert.equal(result.toolCalls[0].id, 'tool-1');
  });

  it('existing text extraction still works when tool_use blocks are mixed in', () => {
    const messages = [
      { type: 'system', subtype: 'init', session_id: 's1' },
      { type: 'assistant', message: { content: [
        { type: 'text', text: 'Before.' },
        { type: 'tool_use', name: 'Read', input: { file_path: '/tmp/x' }, id: 'tool-2' },
        { type: 'text', text: 'After.' }
      ] } },
      { type: 'result' }
    ];
    const result = parseAgentMessages(messages);
    assert.equal(result.fullText, 'Before.After.');
    assert.equal(result.toolCalls.length, 1);
  });

  it('multiple tool_use blocks across multiple assistant messages all captured', () => {
    const messages = [
      { type: 'system', subtype: 'init', session_id: 's1' },
      { type: 'assistant', message: { content: [
        { type: 'tool_use', name: 'Read', input: { file_path: '/a' }, id: 't1' }
      ] } },
      { type: 'assistant', message: { content: [
        { type: 'tool_use', name: 'Write', input: { file_path: '/b', content: 'x' }, id: 't2' },
        { type: 'tool_use', name: 'Read', input: { file_path: '/c' }, id: 't3' }
      ] } },
      { type: 'result' }
    ];
    const result = parseAgentMessages(messages);
    assert.equal(result.toolCalls.length, 3);
    assert.equal(result.toolCalls[0].id, 't1');
    assert.equal(result.toolCalls[1].id, 't2');
    assert.equal(result.toolCalls[2].id, 't3');
  });
});

// --- logTurn ---

describe('logTurn', () => {
  const testSimId = '__test-turn-log__';
  const testDir = path.join(ROOT, 'learning', 'sessions', testSimId);
  const turnsPath = path.join(testDir, 'turns.jsonl');

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    try { fs.unlinkSync(turnsPath); } catch {}
  });

  afterEach(() => {
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  it('creates turns.jsonl if it does not exist', () => {
    logTurn(testSimId, 1, 'hello', '', { input_tokens: 10, output_tokens: 5 });
    assert.ok(fs.existsSync(turnsPath));
  });

  it('writes a valid JSONL line with correct fields', () => {
    logTurn(testSimId, 1, 'check logs', 'narrator reply', { input_tokens: 100, output_tokens: 50, duration_ms: 1500 });
    const line = fs.readFileSync(turnsPath, 'utf8').trim();
    const parsed = JSON.parse(line);
    assert.equal(parsed.turn, 1);
    assert.equal(parsed.player_message, 'check logs');
    assert.equal(parsed.usage.input_tokens, 100);
    assert.equal(parsed.usage.output_tokens, 50);
    assert.equal(parsed.usage.duration_ms, 1500);
    assert.ok(parsed.ts); // ISO timestamp
  });

  it('appends multiple lines on multiple calls', () => {
    logTurn(testSimId, 1, 'first', 'reply1', { input_tokens: 10, output_tokens: 5 });
    logTurn(testSimId, 2, 'second', 'reply2', { input_tokens: 20, output_tokens: 10 });
    const lines = fs.readFileSync(turnsPath, 'utf8').trim().split('\n');
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]).turn, 1);
    assert.equal(JSON.parse(lines[1]).turn, 2);
  });

  it('writes assistant_message field to turns.jsonl entry', () => {
    logTurn(testSimId, 1, 'player input', 'NARRATOR_STUB', { input_tokens: 1, output_tokens: 1 });
    const line = fs.readFileSync(turnsPath, 'utf8').trim();
    const parsed = JSON.parse(line);
    assert.equal(parsed.assistant_message, 'NARRATOR_STUB');
  });

  it('writes assistant_message as empty string when empty', () => {
    logTurn(testSimId, 1, 'player input', '', { input_tokens: 1, output_tokens: 1 });
    const line = fs.readFileSync(turnsPath, 'utf8').trim();
    const parsed = JSON.parse(line);
    assert.equal(parsed.assistant_message, '');
  });

  it('player_message and assistant_message coexist on same entry', () => {
    logTurn(testSimId, 1, 'the player asked', 'the narrator replied', { input_tokens: 1, output_tokens: 1 });
    const line = fs.readFileSync(turnsPath, 'utf8').trim();
    const parsed = JSON.parse(line);
    assert.equal(parsed.player_message, 'the player asked');
    assert.equal(parsed.assistant_message, 'the narrator replied');
  });

  it('appends multiple turns each with assistant_message', () => {
    logTurn(testSimId, 1, 'q1', 'a1', { input_tokens: 1, output_tokens: 1 });
    logTurn(testSimId, 2, 'q2', 'a2', { input_tokens: 2, output_tokens: 2 });
    const lines = fs.readFileSync(turnsPath, 'utf8').trim().split('\n');
    assert.equal(JSON.parse(lines[0]).assistant_message, 'a1');
    assert.equal(JSON.parse(lines[1]).assistant_message, 'a2');
  });
});

// --- sendMessage SESSION_LOST ---

describe('sendMessage', () => {
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
  it('silently handles nonexistent session', async () => {
    await endSession('nonexistent-session-xyz');
  });

  it('removes session from sessions map', async () => {
    const testId = 'test-end-session-' + Date.now();
    sessions.set(testId, {
      claudeSessionId: 'claude-123',
      simId: 'test-sim'
    });

    await endSession(testId);
    assert.ok(!sessions.has(testId), 'session should be removed from map');
  });
});

// --- sessions map ---

describe('sessions map', () => {
  it('is exported and is a Map', () => {
    assert.ok(sessions instanceof Map);
  });
});

// --- collectMessages timeout ---

describe('collectMessages', () => {
  it('collects messages from async generator', async () => {
    async function* generator() {
      yield { type: 'system', subtype: 'init', session_id: 's1' };
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello.' }] } };
      yield { type: 'result' };
    }

    const result = await collectMessages(generator());
    assert.equal(result.length, 3);
  });

  it('rejects with AGENT_TIMEOUT after timeout period', async () => {
    async function* neverEnds() {
      yield { type: 'system', subtype: 'init', session_id: 's1' };
      await new Promise(resolve => setTimeout(resolve, 60000));
      yield { type: 'result' };
    }

    await assert.rejects(
      () => collectMessages(neverEnds(), 50),
      (err) => {
        assert.ok(err.message.includes('AGENT_TIMEOUT'), 'should include AGENT_TIMEOUT');
        return true;
      }
    );
  });
});

// --- parseAgentMessages error detection ---

describe('parseAgentMessages error detection', () => {
  it('captures resultError from error result messages', () => {
    const messages = [
      { type: 'system', subtype: 'init', session_id: 's1' },
      { type: 'result', is_error: true, subtype: 'error_max_turns', error: 'Max turns reached' }
    ];
    const result = parseAgentMessages(messages);
    assert.ok(result.resultError, 'resultError should be present');
    assert.equal(result.resultError.subtype, 'error_max_turns');
  });

  it('captures terminalReason from result messages', () => {
    const messages = [
      { type: 'system', subtype: 'init', session_id: 's1' },
      { type: 'result', terminal_reason: 'end_turn' }
    ];
    const result = parseAgentMessages(messages);
    assert.equal(result.terminalReason, 'end_turn');
  });

  it('returns resultError null and terminalReason null when no errors', () => {
    const messages = [
      { type: 'system', subtype: 'init', session_id: 's1' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'OK.' }] } },
      { type: 'result', usage: { input_tokens: 10, output_tokens: 5 } }
    ];
    const result = parseAgentMessages(messages);
    assert.equal(result.resultError, null);
    assert.equal(result.terminalReason, null);
  });
});

// --- queryOptions maxTurns ---

describe('queryOptions includes maxTurns', () => {
  const source = fs.readFileSync(path.join(ROOT, 'web', 'lib', 'claude-process.ts'), 'utf8');

  it('startSession queryOptions includes maxTurns', () => {
    const firstBlock = source.indexOf('const queryOptions:');
    assert.ok(firstBlock > 0, 'should find first queryOptions declaration');
    const blockEnd = source.indexOf('};', firstBlock);
    const block = source.slice(firstBlock, blockEnd);
    assert.ok(block.includes('maxTurns'), 'startSession queryOptions should include maxTurns');
  });

  it('sendMessage queryOptions includes maxTurns', () => {
    const firstBlock = source.indexOf('const queryOptions:');
    const secondBlock = source.indexOf('const queryOptions:', firstBlock + 1);
    assert.ok(secondBlock > 0, 'should find second queryOptions declaration');
    const blockEnd = source.indexOf('};', secondBlock);
    const block = source.slice(secondBlock, blockEnd);
    assert.ok(block.includes('maxTurns'), 'sendMessage queryOptions should include maxTurns');
  });

  it('retry queryOptions includes maxTurns', () => {
    const retryIdx = source.indexOf('const retryOptions:');
    assert.ok(retryIdx > 0, 'retry options block should exist');
    const blockEnd = source.indexOf('};', retryIdx);
    const block = source.slice(retryIdx, blockEnd);
    assert.ok(block.includes('maxTurns'), 'retry queryOptions should include maxTurns');
  });
});

// --- Cost budgeting ---

describe('cost budgeting', () => {
  it('metrics.config.json contains budgets', () => {
    const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'metrics.config.json'), 'utf8'));
    assert.ok(config.budgets, 'metrics.config.json should have budgets key');
    assert.ok(config.budgets.game_session_usd, 'budgets should have game_session_usd');
    assert.ok(config.budgets.post_session_usd, 'budgets should have post_session_usd');
  });

  it('claude-process.ts source contains maxBudgetUsd', () => {
    const source = fs.readFileSync(path.join(ROOT, 'web', 'lib', 'claude-process.ts'), 'utf8');
    assert.ok(source.includes('maxBudgetUsd'),
      'claude-process.ts should reference maxBudgetUsd');
  });
});

// --- parseAgentMessages hasToolUse ---

describe('parseAgentMessages hasToolUse', () => {
  it('returns hasToolUse: true when messages contain tool_use blocks', () => {
    const messages = [
      { type: 'assistant', message: { content: [
        { type: 'text', text: 'hello' },
        { type: 'tool_use', name: 'Read', input: { path: '/foo' }, id: 'tu_1' }
      ]}}
    ];
    const result = parseAgentMessages(messages);
    assert.equal(result.hasToolUse, true);
  });

  it('returns hasToolUse: false when no tool_use blocks', () => {
    const messages = [
      { type: 'assistant', message: { content: [
        { type: 'text', text: 'hello' }
      ]}}
    ];
    const result = parseAgentMessages(messages);
    assert.equal(result.hasToolUse, false);
  });
});

// --- streamMessage resume validation ---

describe('streamMessage resume validation', () => {
  const source = fs.readFileSync(path.join(ROOT, 'web', 'lib', 'claude-stream.ts'), 'utf8');

  it('checks lastTurnHadToolUse before resume', () => {
    assert.ok(source.includes('lastTurnHadToolUse'),
      'streamMessage should check lastTurnHadToolUse');
  });
});

// --- withRetry ---

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const result = await withRetry(() => Promise.resolve('ok'));
    assert.equal(result, 'ok');
  });

  it('retries on failure and eventually succeeds', async () => {
    let attempt = 0;
    const result = await withRetry(() => {
      attempt++;
      if (attempt < 3) throw new Error('fail');
      return 'ok';
    }, { delays: [1, 1, 1] });
    assert.equal(result, 'ok');
    assert.equal(attempt, 3);
  });

  it('throws after maxAttempts exhausted', async () => {
    await assert.rejects(
      () => withRetry(() => { throw new Error('always fail'); }, { maxAttempts: 2, delays: [1, 1] }),
      { message: 'always fail' }
    );
  });
});

// --- Model hardcoding ---

describe('model is hardcoded', () => {
  const source = fs.readFileSync(path.join(ROOT, 'web', 'lib', 'claude-process.ts'), 'utf8');

  it('startSession uses PLAY_SESSION_MODEL derived from MODEL_CONFIG.play.model', () => {
    const startIdx = source.indexOf('async function startSession');
    const endIdx = source.indexOf('async function', startIdx + 1);
    const fn = source.slice(startIdx, endIdx);
    assert.ok(fn.includes('PLAY_SESSION_MODEL'), 'startSession should reference PLAY_SESSION_MODEL constant');
    assert.ok(
      source.includes('export const PLAY_SESSION_MODEL = MODEL_CONFIG.play.model'),
      'PLAY_SESSION_MODEL must derive from MODEL_CONFIG.play.model',
    );
  });

  it('MODEL_MAP does not contain haiku', () => {
    const mapIdx = source.indexOf('const MODEL_MAP');
    const mapEnd = source.indexOf('};', mapIdx);
    const block = source.slice(mapIdx, mapEnd);
    assert.ok(!block.includes('haiku'), 'MODEL_MAP should not contain haiku');
  });
});

// Force exit after all tests complete: the Claude SDK import keeps open handles
// that prevent the node --test runner from exiting within test's timeout.
after(() => setTimeout(() => process.exit(0), 500));
