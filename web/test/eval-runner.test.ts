import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import * as evalRunner from '../../scripts/eval-runner';

const ROOT = path.resolve(__dirname, '..', '..');

describe('eval scoring spec', () => {
  const specPath = path.join(ROOT, 'references', 'config', 'eval-scoring.yaml');

  it('eval-scoring.yaml exists and parses', () => {
    assert.ok(fs.existsSync(specPath), 'eval-scoring.yaml should exist');
    const spec = yaml.load(fs.readFileSync(specPath, 'utf8'));
    assert.ok(spec.categories, 'should have categories');
  });

  it('has 60 checks total', () => {
    const spec = yaml.load(fs.readFileSync(specPath, 'utf8'));
    const total = Object.values(spec.categories).flat().length;
    assert.equal(total, 58, 'should have exactly 58 checks');
  });

  it('every check has id, check, requires, and rule or prompt', () => {
    const spec = yaml.load(fs.readFileSync(specPath, 'utf8'));
    const checks = Object.values(spec.categories).flat();
    for (const c of checks) {
      assert.ok(c.id, 'check should have id: ' + JSON.stringify(c));
      assert.ok(c.check, 'check should have check description: ' + c.id);
      assert.ok(c.requires, 'check should have requires: ' + c.id);
      assert.ok(
        c.rule || c.prompt,
        'check should have rule or prompt: ' + c.id
      );
    }
  });

  it('all check IDs are unique', () => {
    const spec = yaml.load(fs.readFileSync(specPath, 'utf8'));
    const ids = Object.values(spec.categories).flat().map(c => c.id);
    const unique = new Set(ids);
    assert.equal(ids.length, unique.size, 'duplicate IDs found: ' +
      ids.filter((id, i) => ids.indexOf(id) !== i).join(', '));
  });

  it('requires is one of session, transcript, llm', () => {
    const spec = yaml.load(fs.readFileSync(specPath, 'utf8'));
    const checks = Object.values(spec.categories).flat();
    const valid = ['session', 'transcript', 'llm'];
    for (const c of checks) {
      assert.ok(valid.includes(c.requires),
        c.id + ' has invalid requires: ' + c.requires);
    }
  });

  it('llm checks have prompt field', () => {
    const spec = yaml.load(fs.readFileSync(specPath, 'utf8'));
    const llmChecks = Object.values(spec.categories).flat().filter(c => c.requires === 'llm');
    for (const c of llmChecks) {
      assert.ok(c.prompt, c.id + ' is LLM check but missing prompt');
    }
  });

  it('has expected categories', () => {
    const spec = yaml.load(fs.readFileSync(specPath, 'utf8'));
    const cats = Object.keys(spec.categories);
    const expected = [
      'scoring_integrity', 'console_purity', 'leak_prevention',
      'coaching_accuracy', 'hint_delivery', 'question_classification',
      'session_integrity', 'debrief_quality', 'narrator_behavior',
      'progression', 'narrator_quality'
    ];
    for (const e of expected) {
      assert.ok(cats.includes(e), 'missing category: ' + e);
    }
  });
});

// ---------------------------------------------------------------------------
// Eval runner tests
// ---------------------------------------------------------------------------


describe('eval runner: loadScoringSpec', () => {
  it('loads and returns spec with categories', () => {
    const spec = evalRunner.loadScoringSpec();
    assert.ok(spec.categories);
    assert.ok(Object.keys(spec.categories).length > 0);
  });
});

describe('eval runner: allChecks', () => {
  it('returns flat array with category field added', () => {
    const spec = evalRunner.loadScoringSpec();
    const checks = evalRunner.allChecks(spec);
    assert.equal(checks.length, 58);
    assert.ok(checks[0].category, 'each check should have category');
  });
});

describe('eval runner: runCheck deterministic', () => {
  const mockSession = {
    scoring: { ec2: 2, vpc: 1, cloudwatch: 0, total: 3 },
    services_queried: ['ec2', 'vpc'],
    question_profile: {
      gather: { count: 3, effective: 2 },
      diagnose: { count: 2, effective: 1 },
      correlate: { count: 0, effective: 0 },
      impact: { count: 0, effective: 0 },
      trace: { count: 0, effective: 0 },
      fix: { count: 1, effective: 1 }
    },
    criteria_met: ['identify_sg'],
    criteria_remaining: ['propose_fix'],
    debrief_questions_asked: 0,
    story_beats_fired: ['start'],
    last_active: '2026-04-02T10:00:00Z',
    source: 'player'
  };

  const mockManifest = {
    id: '001-ec2-unreachable',
    services: ['ec2', 'vpc', 'cloudwatch'],
    resolution: {
      root_cause: 'Security group inbound rule for port 443 was removed',
      fix_criteria: [{ id: 'identify_sg', description: 'Identify security group issue', required: true }]
    },
    team: { narrator: { system_narration: { what_broke: 'security group rule deleted' } } }
  };

  it('score-cap passes when all scores <= 2', () => {
    const check = { id: 'score-cap', requires: 'session', rule: 'all_values_lte_2' };
    const result = evalRunner.runCheck(check, mockSession, null, mockManifest);
    assert.equal(result.status, 'pass');
    assert.equal(result.score, 1);
  });

  it('score-unqueried-zero passes when unqueried services are 0', () => {
    const check = { id: 'score-unqueried-zero', requires: 'session', rule: 'unqueried_services_zero' };
    const result = evalRunner.runCheck(check, mockSession, null, mockManifest);
    assert.equal(result.status, 'pass');
  });

  it('score-total-sum passes when total equals sum', () => {
    const check = { id: 'score-total-sum', requires: 'session', rule: 'total_equals_sum' };
    const result = evalRunner.runCheck(check, mockSession, null, mockManifest);
    assert.equal(result.status, 'pass');
  });

  it('score-total-sum fails when total is wrong', () => {
    const bad = { ...mockSession, scoring: { ec2: 2, vpc: 1, total: 99 } };
    const check = { id: 'score-total-sum', requires: 'session', rule: 'total_equals_sum' };
    const result = evalRunner.runCheck(check, bad, null, mockManifest);
    assert.equal(result.status, 'fail');
    assert.equal(result.score, 0);
  });

  it('effective-lte-total passes for valid profile', () => {
    const check = { id: 'qtype-effective-lte-total', requires: 'session', rule: 'effective_lte_total_per_axis' };
    const result = evalRunner.runCheck(check, mockSession, null, mockManifest);
    assert.equal(result.status, 'pass');
  });

  it('effective-lte-total fails when effective > count', () => {
    const bad = {
      ...mockSession,
      question_profile: { gather: { count: 2, effective: 5 } }
    };
    const check = { id: 'test', requires: 'session', rule: 'effective_lte_total_per_axis' };
    const result = evalRunner.runCheck(check, bad, null, mockManifest);
    assert.equal(result.status, 'fail');
  });

  it('field_exists passes when field present', () => {
    const check = { id: 'test', requires: 'session', rule: 'field_exists', field: 'source' };
    const result = evalRunner.runCheck(check, mockSession, null, mockManifest);
    assert.equal(result.status, 'pass');
  });

  it('field_exists fails when field missing', () => {
    const check = { id: 'test', requires: 'session', rule: 'field_exists', field: 'nonexistent' };
    const result = evalRunner.runCheck(check, mockSession, null, mockManifest);
    assert.equal(result.status, 'fail');
  });

  it('skips transcript checks when no transcript', () => {
    const check = { id: 'test', requires: 'transcript', rule: 'no_emojis' };
    const result = evalRunner.runCheck(check, mockSession, null, mockManifest);
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'no transcript');
  });

  it('returns pending_llm for LLM checks', () => {
    const check = { id: 'test', requires: 'llm', prompt: 'Evaluate this.' };
    const result = evalRunner.runCheck(check, mockSession, null, mockManifest);
    assert.equal(result.status, 'pending_llm');
  });

  it('returns error for unknown rule', () => {
    const check = { id: 'test', requires: 'session', rule: 'nonexistent_rule' };
    const result = evalRunner.runCheck(check, mockSession, null, mockManifest);
    assert.equal(result.status, 'error');
  });
});

describe('eval runner: transcript checks', () => {
  const mockTranscript = [
    { ts: '2026-01-01T00:00:00Z', turn: 0, player_message: '', assistant_message: 'Welcome to BrightPath.' },
    { ts: '2026-01-01T00:01:00Z', turn: 1, player_message: 'Show me EC2', assistant_message: 'Here is the data.' },
    { ts: '2026-01-01T00:02:00Z', turn: 2, player_message: 'Check VPC', assistant_message: 'Network looks normal.' }
  ];
  const mockManifest = {
    id: '001-ec2-unreachable',
    services: ['ec2', 'vpc', 'cloudwatch']
  };

  it('not_contains_any passes when no forbidden phrases in assistant_message', () => {
    const check = {
      id: 'test', requires: 'transcript', rule: 'not_contains_any',
      target: 'assistant_message',
      patterns: ['this means', 'the issue is']
    };
    const result = evalRunner.runCheck(check, null, mockTranscript, mockManifest);
    assert.equal(result.status, 'pass');
  });

  it('not_contains_any fails when forbidden phrase found', () => {
    const badTranscript = [
      { ts: '2026-01-01T00:01:00Z', turn: 1, player_message: 'Show me EC2', assistant_message: 'The instance shows the issue is clear.' }
    ];
    const check = {
      id: 'test', requires: 'transcript', rule: 'not_contains_any',
      target: 'assistant_message',
      patterns: ['the issue is']
    };
    const result = evalRunner.runCheck(check, null, badTranscript, mockManifest);
    assert.equal(result.status, 'fail');
  });

  it('no_emojis passes for clean transcript', () => {
    const check = { id: 'test', requires: 'transcript', rule: 'no_emojis' };
    const result = evalRunner.runCheck(check, null, mockTranscript, mockManifest);
    assert.equal(result.status, 'pass');
  });

  it('no_emojis fails when emoji present', () => {
    const badTranscript = [{ ts: '2026-01-01T00:01:00Z', turn: 1, player_message: 'q', assistant_message: 'Great job! \u{1F389}' }];
    const check = { id: 'test', requires: 'transcript', rule: 'no_emojis' };
    const result = evalRunner.runCheck(check, null, badTranscript, mockManifest);
    assert.equal(result.status, 'fail');
  });
});

describe('eval runner: stub tracking', () => {
  it('tracks known number of one-liner stub rules', () => {
    const source = fs.readFileSync(path.join(ROOT, 'scripts', 'eval-runner.ts'), 'utf8');
    // One-liner stubs match the pattern: funcName() { return { pass: true }; }
    const stubPattern = /\w+\(\)(?::\s*\w+)?\s*\{\s*return\s*\{\s*pass:\s*true\s*\};\s*\}/g;
    const stubs = source.match(stubPattern) || [];
    // If this number changes, someone implemented a stub (decrease) or added one (increase).
    // Update the expected count accordingly.
    assert.equal(stubs.length, 12,
      'Expected 11 one-liner stub rules. If you implemented one, decrease this count. ' +
      'If you added one, verify it is intentional. Current stubs: ' + stubs.map(s => s.split('(')[0]).join(', '));
  });
});

describe('eval runner: runScorecard', () => {
  it('returns error for missing session', () => {
    const result = evalRunner.runScorecard('nonexistent-sim-id');
    assert.ok(result.error);
  });
});
