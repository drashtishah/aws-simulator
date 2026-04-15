import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import Module from 'node:module';

// Isolate sessions + learning dirs. Must be set before any module under test
// imports web/lib/paths.
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'post-session-'));
const TMP_SESSIONS_DIR = path.join(TMP_ROOT, 'sessions');
const TMP_LEARNING_DIR = path.join(TMP_ROOT, 'learning');
process.env.AWS_SIMULATOR_SESSIONS_DIR = TMP_SESSIONS_DIR;
process.env.AWS_SIMULATOR_LEARNING_DIR = TMP_LEARNING_DIR;
fs.mkdirSync(TMP_SESSIONS_DIR, { recursive: true });
fs.mkdirSync(TMP_LEARNING_DIR, { recursive: true });

after(() => {
  try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); } catch {}
});

// Intercept the SDK via require cache before claude-process loads it.
const sdkMockState: {
  lastPrompt: string | null;
  lastOptions: Record<string, unknown> | null;
  nextResult: 'success' | 'error';
} = { lastPrompt: null, lastOptions: null, nextResult: 'success' };

async function* mockQuery(input: { prompt: string; options: Record<string, unknown> }): AsyncGenerator<unknown> {
  sdkMockState.lastPrompt = input.prompt;
  sdkMockState.lastOptions = input.options;
  yield { type: 'system', subtype: 'init', session_id: 'mock-session', model: 'claude-opus-4-6' };
  yield {
    type: 'assistant',
    message: {
      content: [
        { type: 'text', text: 'Post-session analysis complete.' },
      ],
    },
  };
  if (sdkMockState.nextResult === 'error') {
    yield {
      type: 'result',
      subtype: 'error_max_turns',
      is_error: true,
      error: 'max turns',
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 8 },
    };
  } else {
    yield {
      type: 'result',
      subtype: 'success',
      usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 80, cache_creation_input_tokens: 0 },
      duration_ms: 1500,
    };
  }
}

const sdkSpecifier = '@anthropic-ai/claude-agent-sdk';
const resolvedSdkPath = require.resolve(sdkSpecifier);
require.cache[resolvedSdkPath] = {
  id: resolvedSdkPath,
  filename: resolvedSdkPath,
  loaded: true,
  exports: { query: mockQuery },
  children: [],
  paths: [],
  parent: null,
  require: Module.createRequire(resolvedSdkPath),
} as unknown as NodeModule;

// Load modules under test AFTER env vars and SDK intercept are in place.
const claudeProcess = require('../lib/claude-process');

describe('runPostSessionAgent integration', () => {
  const testSimId = '001-ec2-unreachable';

  before(() => {
    // Seed fixtures.
    const sessionDir = path.join(TMP_SESSIONS_DIR, testSimId);
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionDir, 'turns.jsonl'),
      JSON.stringify({ ts: '2026-04-14T10:00:00Z', turn: 1, player_message: 'what do I see', assistant_message: 'pager fired', usage: {} }) + '\n' +
      JSON.stringify({ ts: '2026-04-14T10:01:00Z', turn: 2, player_message: 'check security groups', assistant_message: 'port 80 missing', usage: {} }) + '\n' +
      JSON.stringify({ ts: '2026-04-14T10:02:00Z', turn: 3, player_message: 'add inbound rule for port 80', assistant_message: 'site is back up', usage: {} }) + '\n'
    );
    fs.writeFileSync(
      path.join(sessionDir, 'session.json'),
      JSON.stringify({ sim_id: testSimId, status: 'in_progress', turnCount: 3 })
    );
    fs.writeFileSync(
      path.join(TMP_LEARNING_DIR, 'profile.json'),
      JSON.stringify({ rank: 'cadet', completed_sims: [], skill_polygon: { ec2: 0, vpc: 0 }, total_sessions: 0 })
    );
    fs.writeFileSync(
      path.join(TMP_LEARNING_DIR, 'catalog.csv'),
      'service,sims_completed,knowledge_score,last_practiced\n'
    );
    fs.mkdirSync(path.join(TMP_LEARNING_DIR, 'logs'), { recursive: true });
    // Seed classification.jsonl so Tier 2 can run after the mock SDK returns.
    fs.writeFileSync(
      path.join(sessionDir, 'classification.jsonl'),
      JSON.stringify({ index: 1, question_type: 'gather', effectiveness: 4 }) + '\n' +
      JSON.stringify({ index: 2, question_type: 'diagnose', effectiveness: 5 }) + '\n' +
      JSON.stringify({ index: 3, question_type: 'fix', effectiveness: 6 }) + '\n'
    );
  });

  it('builds a post-session prompt referencing every required file', () => {
    const prompt = claudeProcess.buildPostSessionPrompt(testSimId);
    assert.ok(prompt.includes('turns.jsonl'), 'prompt must reference turns.jsonl');
    assert.ok(prompt.includes('session.json'), 'prompt must reference session.json');
    assert.ok(!prompt.includes('profile.json'), 'Tier 1 prompt must not reference profile.json');
    assert.ok(!prompt.includes('catalog.csv'), 'Tier 1 prompt must not reference catalog.csv');
    assert.ok(prompt.includes('classification.jsonl'), 'Tier 1 prompt must reference classification.jsonl output path');
    assert.ok(prompt.includes('manifest.json'), 'prompt must reference manifest.json');
    assert.ok(prompt.includes('coaching-patterns.md'), 'prompt must reference coaching-patterns.md');
    assert.ok(prompt.includes('progression.yaml'), 'prompt must reference progression.yaml');
  });

  it('buildPostSessionPrompt routes paths through the sessions-dir override', () => {
    const prompt = claudeProcess.buildPostSessionPrompt(testSimId);
    assert.ok(prompt.includes(TMP_SESSIONS_DIR), 'prompt must point at the tmp SESSIONS_DIR');
  });

  it('runPostSessionAgent returns success when the SDK completes normally', async () => {
    sdkMockState.nextResult = 'success';
    const result = await claudeProcess.runPostSessionAgent(testSimId);
    assert.ok(result.success, 'result.success must be true');
    assert.ok(typeof result.tier1_duration_ms === 'number', 'result must include tier1_duration_ms');
    assert.ok(typeof result.tier2_duration_ms === 'number', 'result must include tier2_duration_ms');
    assert.ok(sdkMockState.lastPrompt?.includes('post-session analysis agent'), 'prompt must flag post-session role');
    assert.equal((sdkMockState.lastOptions as { model: string }).model, 'claude-opus-4-6', 'post-session must run on opus');
    assert.equal((sdkMockState.lastOptions as { allowedTools: string[] }).allowedTools.join(','), 'Read,Write', 'post-session may only Read and Write');
  });

  it('runPostSessionAgent throws when the SDK returns an error result', async () => {
    sdkMockState.nextResult = 'error';
    await assert.rejects(
      () => claudeProcess.runPostSessionAgent(testSimId),
      /Post-session agent failed/,
      'error results must surface as a thrown error'
    );
  });
});
