import { describe, it, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import { assertNoRootLeak } from './helpers/assert-no-root-leak';

const ROOT = path.resolve(__dirname, '..', '..');

// PR-A.4.1: tmp sessions dir override; see web/test/game-session.test.ts for context.
// Must be set before requiring web/lib/paths or any module that imports it.
const TMP_SESSIONS_DIR = path.join(__dirname, '.tmp', `session-persistence-${process.pid}`);
process.env.AWS_SIMULATOR_SESSIONS_DIR = TMP_SESSIONS_DIR;
fs.mkdirSync(TMP_SESSIONS_DIR, { recursive: true });

const realLeakPath = path.join(ROOT, 'learning', 'sessions', '001-ec2-unreachable');
const realLeakPreExisted = fs.existsSync(realLeakPath);

// require() preserved for paths and claude-session: must run after
// AWS_SIMULATOR_SESSIONS_DIR is set above. ESM imports are hoisted before
// module-level code, which would cause paths.ts to load without the env var.
const paths = require('../lib/paths');
const { persistSession, recoverSessions, sessions, SESSION_MAX_AGE_MS } = require('../lib/claude-session');

after(() => {
  try { fs.rmSync(TMP_SESSIONS_DIR, { recursive: true, force: true }); } catch {}
  assertNoRootLeak(realLeakPath, realLeakPreExisted);
});

describe('persistSession', () => {
  const testSimId = '__test-persist__';
  const testDir = paths.sessionDir(testSimId);
  const filePath = path.join(testDir, 'web-session.json');

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    try { fs.unlinkSync(filePath); } catch {}
  });

  afterEach(() => {
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  it('writes web-session.json to learning/sessions/{simId}/', () => {
    persistSession('sess-1', {
      claudeSessionId: 'claude-abc',
      simId: testSimId,
      themeId: 'calm-mentor',
      model: 'sonnet',
      modelId: 'claude-sonnet-4-6',
      startedAt: new Date(),
      turnCount: 0
    });
    assert.ok(fs.existsSync(filePath), 'web-session.json should exist');
  });

  it('includes required fields', () => {
    persistSession('sess-2', {
      claudeSessionId: 'claude-def',
      simId: testSimId,
      themeId: 'calm-mentor',
      model: 'opus',
      modelId: 'claude-opus-4-6',
      startedAt: new Date('2026-04-04T10:00:00Z'),
      turnCount: 5
    });
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.equal(data.sessionId, 'sess-2');
    assert.equal(data.claudeSessionId, 'claude-def');
    assert.equal(data.simId, testSimId);
    assert.equal(data.themeId, 'calm-mentor');
    assert.equal(data.model, 'opus');
    assert.equal(data.modelId, 'claude-opus-4-6');
    assert.equal(data.turnCount, 5);
    assert.ok(data.startedAt);
  });
});

describe('recoverSessions', () => {
  // Use a real sim ID so buildPrompt can find its manifest/theme
  const realSimId = '001-ec2-unreachable';
  const testDir = paths.sessionDir(realSimId);
  const filePath = path.join(testDir, 'web-session.json');
  // require() preserved: prompt-builder imports paths; must run after env var is set.
  const { buildPrompt } = require('../lib/prompt-builder');

  beforeEach(() => {
    // Clear sessions map
    for (const [id] of sessions) {
      sessions.delete(id);
    }
    fs.mkdirSync(testDir, { recursive: true });
    try { fs.unlinkSync(filePath); } catch {}
  });

  afterEach(() => {
    for (const [id] of sessions) {
      sessions.delete(id);
    }
    try { fs.unlinkSync(filePath); } catch {}
  });

  it('populates sessions Map from disk files', () => {
    fs.writeFileSync(filePath, JSON.stringify({
      sessionId: 'recover-1',
      claudeSessionId: 'claude-xyz',
      simId: realSimId,
      themeId: 'calm-mentor',
      model: 'sonnet',
      modelId: 'claude-sonnet-4-6',
      startedAt: new Date().toISOString(),
      turnCount: 3
    }));

    recoverSessions(buildPrompt);
    assert.ok(sessions.has('recover-1'), 'session should be recovered');
    const session = sessions.get('recover-1');
    assert.equal(session.simId, realSimId);
    assert.equal(session.turnCount, 3);
  });

  it('recovered sessions include required fields', () => {
    fs.writeFileSync(filePath, JSON.stringify({
      sessionId: 'recover-fields',
      claudeSessionId: 'claude-123',
      simId: realSimId,
      themeId: 'calm-mentor',
      model: 'sonnet',
      modelId: 'claude-sonnet-4-6',
      startedAt: new Date().toISOString(),
      turnCount: 0
    }));

    recoverSessions(buildPrompt);
    const session = sessions.get('recover-fields');
    assert.ok(session, 'session should exist');
    assert.ok(session.claudeSessionId);
    assert.ok(session.simId);
    assert.ok(session.themeId);
    assert.ok(session.model);
    assert.ok(session.modelId);
    assert.ok(session.startedAt);
  });

  it('sessions older than 2 hours are skipped during recovery', () => {
    const oldDate = new Date(Date.now() - SESSION_MAX_AGE_MS - 60000);
    fs.writeFileSync(filePath, JSON.stringify({
      sessionId: 'recover-old',
      claudeSessionId: 'claude-old',
      simId: realSimId,
      themeId: 'calm-mentor',
      model: 'sonnet',
      modelId: 'claude-sonnet-4-6',
      startedAt: oldDate.toISOString(),
      turnCount: 10
    }));

    recoverSessions(buildPrompt);
    assert.ok(!sessions.has('recover-old'), 'old session should not be recovered');
  });

  it('corrupt JSON in web-session.json is silently skipped', () => {
    fs.writeFileSync(filePath, '{invalid json!!!');

    // Should not throw
    recoverSessions(buildPrompt);
    assert.equal(sessions.size, 0, 'no sessions recovered from corrupt file');
  });

  it('skips sims whose manifest no longer exists', () => {
    fs.writeFileSync(filePath, JSON.stringify({
      sessionId: 'recover-missing',
      claudeSessionId: 'claude-miss',
      simId: '__nonexistent-sim__',
      themeId: 'calm-mentor',
      model: 'sonnet',
      modelId: 'claude-sonnet-4-6',
      startedAt: new Date().toISOString(),
      turnCount: 0
    }));

    // Create a temp dir for the nonexistent sim
    const fakeDir = paths.sessionDir('__nonexistent-sim__');
    fs.mkdirSync(fakeDir, { recursive: true });
    fs.writeFileSync(path.join(fakeDir, 'web-session.json'), JSON.stringify({
      sessionId: 'recover-missing',
      claudeSessionId: 'claude-miss',
      simId: '__nonexistent-sim__',
      themeId: 'calm-mentor',
      model: 'sonnet',
      modelId: 'claude-sonnet-4-6',
      startedAt: new Date().toISOString(),
      turnCount: 0
    }));

    recoverSessions(buildPrompt);
    assert.ok(!sessions.has('recover-missing'), 'session with missing sim should not be recovered');

    // Cleanup
    try { fs.rmSync(fakeDir, { recursive: true, force: true }); } catch {}
  });
});

describe('endSession cleanup', () => {
  // require() preserved: claude-process imports paths; must run after env var is set.
  const { endSession } = require('../lib/claude-process');
  const testSimId = '__test-end-cleanup__';
  const testDir = paths.sessionDir(testSimId);
  const filePath = path.join(testDir, 'web-session.json');

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    for (const [id] of sessions) {
      sessions.delete(id);
    }
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  it('removes web-session.json for that sim', async () => {
    const testId = 'end-cleanup-' + Date.now();
    sessions.set(testId, {
      claudeSessionId: 'claude-end',
      simId: testSimId
    });
    fs.writeFileSync(filePath, '{}');

    await endSession(testId);
    assert.ok(!fs.existsSync(filePath), 'web-session.json should be deleted after endSession');
  });
});
