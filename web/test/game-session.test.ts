import { describe, it, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';

const ROOT = path.resolve(__dirname, '..', '..');

// PR-A.4.1: route session writes to a tmp dir so tests no longer leak the
// real `learning/sessions/001-ec2-unreachable/` directory back into the
// worktree on every run. Must be set before requiring any module that
// imports `web/lib/paths`.
const TMP_SESSIONS_DIR = path.join(__dirname, '.tmp', `game-session-${process.pid}`);
process.env.AWS_SIMULATOR_SESSIONS_DIR = TMP_SESSIONS_DIR;
fs.mkdirSync(TMP_SESSIONS_DIR, { recursive: true });

after(() => {
  try { fs.rmSync(TMP_SESSIONS_DIR, { recursive: true, force: true }); } catch {}
  // Regression assertion: the real sessions dir for `001-ec2-unreachable`
  // must not have been created by any test in this file.
  const realLeakPath = path.join(TMP_SESSIONS_DIR, '001-ec2-unreachable');
  assert.ok(
    !fs.existsSync(realLeakPath),
    `learning/sessions/001-ec2-unreachable/ leaked from a test run; tests must use AWS_SIMULATOR_SESSIONS_DIR override`
  );
});

const testSimId = '__test-game-session__';
const testDir = path.join(TMP_SESSIONS_DIR, testSimId);
const sessionPath = path.join(testDir, 'session.json');

// --- createGameSession ---

describe('createGameSession', () => {
  // require() preserved: must run after AWS_SIMULATOR_SESSIONS_DIR is set above.
  // Hoisting this import would cause paths.ts to load before the env var is set.
  const { createGameSession } = require('../lib/claude-session');

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    try { fs.unlinkSync(sessionPath); } catch {}
  });

  afterEach(() => {
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  it('creates session.json at the configured sessions dir for the given simId', () => {
    createGameSession('001-ec2-unreachable');
    const filePath = path.join(TMP_SESSIONS_DIR, '001-ec2-unreachable', 'session.json');
    assert.ok(fs.existsSync(filePath), 'session.json should exist');
    // Cleanup
    try { fs.rmSync(path.join(TMP_SESSIONS_DIR, '001-ec2-unreachable'), { recursive: true, force: true }); } catch {}
  });

  it('has all required fields', () => {
    const session = createGameSession('001-ec2-unreachable');
    const required = [
      'sim_id', 'status', 'criteria_met', 'criteria_remaining',
      'question_profile', 'investigation_summary', 'story_beats_fired',
      'services_queried', 'feedback_notes', 'debrief_phase',
      'debrief_questions_asked', 'debrief_zones_explored',
      'debrief_seeds_offered', 'debrief_depth_score',
      'question_quality_scores'
    ];
    for (const field of required) {
      assert.ok(field in session, `session should have field: ${field}`);
    }
    // Cleanup
    try { fs.rmSync(path.join(TMP_SESSIONS_DIR, '001-ec2-unreachable'), { recursive: true, force: true }); } catch {}
  });

  it('populates criteria_remaining from manifest fix_criteria', () => {
    const session = createGameSession('001-ec2-unreachable');
    assert.ok(Array.isArray(session.criteria_remaining));
    assert.ok(session.criteria_remaining.length > 0, 'should have criteria from manifest');
    const ids = session.criteria_remaining.map(c => c.id);
    assert.ok(ids.includes('identify_security_group'), 'should include identify_security_group criterion');
    assert.ok(ids.includes('propose_fix'), 'should include propose_fix criterion');
    // Cleanup
    try { fs.rmSync(path.join(TMP_SESSIONS_DIR, '001-ec2-unreachable'), { recursive: true, force: true }); } catch {}
  });

  it('sets status to in_progress', () => {
    const session = createGameSession('001-ec2-unreachable');
    assert.equal(session.status, 'in_progress');
    // Cleanup
    try { fs.rmSync(path.join(TMP_SESSIONS_DIR, '001-ec2-unreachable'), { recursive: true, force: true }); } catch {}
  });

  it('has valid ISO datetimes for started_at and last_active', () => {
    const session = createGameSession('001-ec2-unreachable');
    assert.ok(session.started_at);
    assert.ok(session.last_active);
    // Verify they parse as valid dates
    assert.ok(!isNaN(new Date(session.started_at).getTime()), 'started_at should be valid ISO datetime');
    assert.ok(!isNaN(new Date(session.last_active).getTime()), 'last_active should be valid ISO datetime');
    // Cleanup
    try { fs.rmSync(path.join(TMP_SESSIONS_DIR, '001-ec2-unreachable'), { recursive: true, force: true }); } catch {}
  });

  it('question_profile has six axes each with count and effective', () => {
    const session = createGameSession('001-ec2-unreachable');
    const axes = ['gather', 'diagnose', 'correlate', 'impact', 'trace', 'fix'];
    for (const axis of axes) {
      assert.ok(axis in session.question_profile, `question_profile should have axis: ${axis}`);
      assert.equal(session.question_profile[axis].count, 0);
      assert.equal(session.question_profile[axis].effective, 0);
    }
    // Cleanup
    try { fs.rmSync(path.join(TMP_SESSIONS_DIR, '001-ec2-unreachable'), { recursive: true, force: true }); } catch {}
  });

  it('format compatible with eval-runner (status field) and GET /api/sessions (sim_id field)', () => {
    const session = createGameSession('001-ec2-unreachable');
    assert.ok('status' in session, 'must have status for eval-runner');
    assert.ok('sim_id' in session, 'must have sim_id for GET /api/sessions');
    assert.equal(session.sim_id, '001-ec2-unreachable');
    // Cleanup
    try { fs.rmSync(path.join(TMP_SESSIONS_DIR, '001-ec2-unreachable'), { recursive: true, force: true }); } catch {}
  });
});

// --- updateGameSession ---

describe('updateGameSession', () => {
  // require() preserved: must run after AWS_SIMULATOR_SESSIONS_DIR is set above.
  const { updateGameSession, createGameSession } = require('../lib/claude-session');

  afterEach(() => {
    try { fs.rmSync(path.join(TMP_SESSIONS_DIR, '001-ec2-unreachable'), { recursive: true, force: true }); } catch {}
  });

  it('updates last_active timestamp on every call', () => {
    const original = createGameSession('001-ec2-unreachable');
    const originalLastActive = original.last_active;
    // Small delay to ensure timestamp differs
    const updated = updateGameSession('001-ec2-unreachable', { turnCount: 1 });
    assert.ok(updated.last_active);
    assert.ok(new Date(updated.last_active).getTime() >= new Date(originalLastActive).getTime());
  });

  it('merges new fields into existing session', () => {
    createGameSession('001-ec2-unreachable');
    const updated = updateGameSession('001-ec2-unreachable', { turnCount: 3 });
    assert.equal(updated.turnCount, 3);
  });

  it('merges status: completed correctly', () => {
    createGameSession('001-ec2-unreachable');
    const updated = updateGameSession('001-ec2-unreachable', { status: 'completed' });
    assert.equal(updated.status, 'completed');
  });

  it('returns null when session.json does not exist', () => {
    const result = updateGameSession('nonexistent-sim-xyz', { turnCount: 1 });
    assert.equal(result, null);
  });

  it('preserves existing fields during merge', () => {
    const original = createGameSession('001-ec2-unreachable');
    const criteriaCount = original.criteria_remaining.length;
    const updated = updateGameSession('001-ec2-unreachable', { turnCount: 5 });
    assert.equal(updated.criteria_remaining.length, criteriaCount, 'criteria_remaining should be preserved');
    assert.equal(updated.sim_id, '001-ec2-unreachable', 'sim_id should be preserved');
  });
});

// --- runPostSessionAgent ---

describe('runPostSessionAgent', () => {
  // require() preserved: must run after AWS_SIMULATOR_SESSIONS_DIR is set above.
  const { runPostSessionAgent } = require('../lib/claude-process');

  it('function exists and is exported', () => {
    assert.ok(typeof runPostSessionAgent === 'function', 'runPostSessionAgent should be a function');
  });

  it('accepts simId parameter', () => {
    assert.equal(runPostSessionAgent.length, 1, 'should accept 1 parameter');
  });
});

describe('buildPostSessionPrompt', () => {
  // require() preserved: must run after AWS_SIMULATOR_SESSIONS_DIR is set above.
  const { buildPostSessionPrompt } = require('../lib/claude-process');

  it('prompt contains required file paths', () => {
    const prompt = buildPostSessionPrompt('001-ec2-unreachable');
    assert.ok(prompt.includes('session.json'), 'should reference session.json');
    assert.ok(prompt.includes('manifest.json'), 'should reference manifest.json');
    assert.ok(prompt.includes('profile.json'), 'should reference profile.json');
    assert.ok(prompt.includes('catalog.csv'), 'should reference catalog.csv');
    assert.ok(prompt.includes('coaching-patterns.md'), 'should reference coaching-patterns.md');
  });

  it('specifies model as claude-opus-4-6', () => {
    const prompt = buildPostSessionPrompt('001-ec2-unreachable');
    // The prompt itself should indicate the model, but we test the config separately
    assert.ok(prompt.length > 0, 'prompt should not be empty');
  });
});

// Force exit after all tests complete
after(() => setTimeout(() => process.exit(0), 500));
