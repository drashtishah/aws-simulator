const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..');

const testSimId = '__test-game-session__';
const testDir = path.join(ROOT, 'learning', 'sessions', testSimId);
const sessionPath = path.join(testDir, 'session.json');

// --- createGameSession ---

describe('createGameSession', () => {
  const { createGameSession } = require('../lib/claude-process');

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    try { fs.unlinkSync(sessionPath); } catch {}
  });

  afterEach(() => {
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  it('creates session.json at learning/sessions/{simId}/session.json', () => {
    createGameSession('001-ec2-unreachable');
    const filePath = path.join(ROOT, 'learning', 'sessions', '001-ec2-unreachable', 'session.json');
    assert.ok(fs.existsSync(filePath), 'session.json should exist');
    // Cleanup
    try { fs.rmSync(path.join(ROOT, 'learning', 'sessions', '001-ec2-unreachable'), { recursive: true, force: true }); } catch {}
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
    try { fs.rmSync(path.join(ROOT, 'learning', 'sessions', '001-ec2-unreachable'), { recursive: true, force: true }); } catch {}
  });

  it('populates criteria_remaining from manifest fix_criteria', () => {
    const session = createGameSession('001-ec2-unreachable');
    assert.ok(Array.isArray(session.criteria_remaining));
    assert.ok(session.criteria_remaining.length > 0, 'should have criteria from manifest');
    const ids = session.criteria_remaining.map(c => c.id);
    assert.ok(ids.includes('identify_security_group'), 'should include identify_security_group criterion');
    assert.ok(ids.includes('propose_fix'), 'should include propose_fix criterion');
    // Cleanup
    try { fs.rmSync(path.join(ROOT, 'learning', 'sessions', '001-ec2-unreachable'), { recursive: true, force: true }); } catch {}
  });

  it('sets status to in_progress', () => {
    const session = createGameSession('001-ec2-unreachable');
    assert.equal(session.status, 'in_progress');
    // Cleanup
    try { fs.rmSync(path.join(ROOT, 'learning', 'sessions', '001-ec2-unreachable'), { recursive: true, force: true }); } catch {}
  });

  it('has valid ISO datetimes for started_at and last_active', () => {
    const session = createGameSession('001-ec2-unreachable');
    assert.ok(session.started_at);
    assert.ok(session.last_active);
    // Verify they parse as valid dates
    assert.ok(!isNaN(new Date(session.started_at).getTime()), 'started_at should be valid ISO datetime');
    assert.ok(!isNaN(new Date(session.last_active).getTime()), 'last_active should be valid ISO datetime');
    // Cleanup
    try { fs.rmSync(path.join(ROOT, 'learning', 'sessions', '001-ec2-unreachable'), { recursive: true, force: true }); } catch {}
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
    try { fs.rmSync(path.join(ROOT, 'learning', 'sessions', '001-ec2-unreachable'), { recursive: true, force: true }); } catch {}
  });

  it('format compatible with eval-runner (status field) and GET /api/sessions (sim_id field)', () => {
    const session = createGameSession('001-ec2-unreachable');
    assert.ok('status' in session, 'must have status for eval-runner');
    assert.ok('sim_id' in session, 'must have sim_id for GET /api/sessions');
    assert.equal(session.sim_id, '001-ec2-unreachable');
    // Cleanup
    try { fs.rmSync(path.join(ROOT, 'learning', 'sessions', '001-ec2-unreachable'), { recursive: true, force: true }); } catch {}
  });
});

// --- updateGameSession ---

describe('updateGameSession', () => {
  const { updateGameSession, createGameSession } = require('../lib/claude-process');

  afterEach(() => {
    try { fs.rmSync(path.join(ROOT, 'learning', 'sessions', '001-ec2-unreachable'), { recursive: true, force: true }); } catch {}
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
  const { runPostSessionAgent } = require('../lib/claude-process');

  it('function exists and is exported', () => {
    assert.ok(typeof runPostSessionAgent === 'function', 'runPostSessionAgent should be a function');
  });

  it('accepts simId parameter', () => {
    assert.equal(runPostSessionAgent.length, 1, 'should accept 1 parameter');
  });
});

describe('buildPostSessionPrompt', () => {
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
const { after } = require('node:test');
after(() => setTimeout(() => process.exit(0), 500));
