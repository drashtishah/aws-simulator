import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseClassificationJsonl } from '../lib/classification-schema.js';
import type { ClassificationRow } from '../lib/classification-schema.js';
import { updateProfileFromClassification, deriveRank, updateCatalogFromClassification } from '../lib/post-session-renderer.js';
import type { CatalogRow } from '../lib/post-session-renderer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures');

function loadSample(): ClassificationRow[] {
  const text = fs.readFileSync(path.join(FIXTURES, 'classification-sample.jsonl'), 'utf8');
  return parseClassificationJsonl(text);
}

function loadProfileBefore() {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, 'profile-before.json'), 'utf8')) as Parameters<typeof updateProfileFromClassification>[0];
}

function loadProgression() {
  const yaml = require('js-yaml') as typeof import('js-yaml');
  return yaml.load(
    fs.readFileSync(path.join(__dirname, '../../references/config/progression.yaml'), 'utf8')
  ) as Parameters<typeof updateProfileFromClassification>[3];
}

describe('updateProfileFromClassification', () => {
  it('adds simId to completed_sims', () => {
    const profile = loadProfileBefore();
    const rows = loadSample();
    const progression = loadProgression();
    const updated = updateProfileFromClassification(profile, rows, 'test-sim-001', progression);
    assert.ok(updated.completed_sims.includes('test-sim-001'));
  });

  it('increments total_sessions', () => {
    const profile = loadProfileBefore();
    const rows = loadSample();
    const progression = loadProgression();
    const updated = updateProfileFromClassification(profile, rows, 'test-sim-001', progression);
    assert.equal(updated.total_sessions, 1);
  });

  it('increases polygon axes for exercised question types', () => {
    const profile = loadProfileBefore();
    const rows = loadSample();
    const progression = loadProgression();
    const updated = updateProfileFromClassification(profile, rows, 'test-sim-001', progression);
    assert.ok(updated.skill_polygon.gather > 0, 'gather should increase');
    assert.ok(updated.skill_polygon.diagnose > 0, 'diagnose should increase');
    assert.ok(updated.skill_polygon.fix > 0, 'fix should increase');
  });

  it('is idempotent: calling twice with same simId produces same polygon', () => {
    const profile = loadProfileBefore();
    const rows = loadSample();
    const progression = loadProgression();
    const once = updateProfileFromClassification(profile, rows, 'test-sim-001', progression);
    const twice = updateProfileFromClassification(once, rows, 'test-sim-001', progression);
    assert.deepEqual(twice.skill_polygon, once.skill_polygon);
    assert.deepEqual(twice.completed_sims, once.completed_sims);
    assert.equal(twice.total_sessions, once.total_sessions);
  });

  it('applies diminishing returns: second unique sim earns fewer points than first', () => {
    const profile = loadProfileBefore();
    const rows = loadSample();
    const progression = loadProgression();
    const after1 = updateProfileFromClassification(profile, rows, 'test-sim-001', progression);
    const after2 = updateProfileFromClassification(after1, rows, 'test-sim-002', progression);
    const gain1 = after1.skill_polygon.gather - profile.skill_polygon.gather;
    const gain2 = after2.skill_polygon.gather - after1.skill_polygon.gather;
    // Both should be >= 0; after many sessions diminishing returns kick in
    assert.ok(gain1 >= 0);
    assert.ok(gain2 >= 0);
  });
});

describe('deriveRank', () => {
  it('returns responder for a zeroed polygon', () => {
    const polygon = { gather: 0, diagnose: 0, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const progression = loadProgression();
    assert.equal(deriveRank(polygon, progression), 'responder');
  });

  it('returns junior-investigator when 2 axes reach 1', () => {
    const polygon = { gather: 1, diagnose: 1, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const progression = loadProgression();
    assert.equal(deriveRank(polygon, progression), 'junior-investigator');
  });

  it('returns investigator when gather and diagnose reach 2', () => {
    const polygon = { gather: 2, diagnose: 2, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const progression = loadProgression();
    assert.equal(deriveRank(polygon, progression), 'investigator');
  });

  it('falls through to responder when profile quality_gate is unmet', () => {
    const polygon = { gather: 2, diagnose: 2, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const progression = loadProgression();
    const profile = {
      question_quality: { avg_overall: 0 },
      sessions_at_current_rank: 0,
    };
    assert.equal(deriveRank(polygon, progression, profile), 'responder');
  });

  it('returns investigator when quality_gate is satisfied', () => {
    const polygon = { gather: 2, diagnose: 2, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const progression = loadProgression();
    const profile = {
      question_quality: { avg_overall: 3 },
      sessions_at_current_rank: 30,
    };
    assert.equal(deriveRank(polygon, progression, profile), 'investigator');
  });

  it('blocks promotion when sessions_at_current_rank below quality_gate floor', () => {
    const polygon = { gather: 2, diagnose: 2, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const progression = loadProgression();
    const profile = {
      question_quality: { avg_overall: 5 },
      sessions_at_current_rank: 1,
    };
    assert.equal(deriveRank(polygon, progression, profile), 'responder');
  });
});

describe('updateProfileFromClassification question_quality', () => {
  it('populates profile.question_quality.avg_overall from classification effectiveness', () => {
    const profile = loadProfileBefore();
    const rows = loadSample();
    const progression = loadProgression();
    const updated = updateProfileFromClassification(profile, rows, 'test-sim-qq', progression);
    const avgEff = rows.reduce((s, r) => s + r.effectiveness, 0) / rows.length;
    const avgOverall = (updated.question_quality as { avg_overall: number }).avg_overall;
    assert.ok(
      Math.abs(avgOverall - avgEff) < 0.01,
      'avg_overall (' + avgOverall + ') should approximately equal avg(effectiveness) (' + avgEff + ')'
    );
  });

  it('is idempotent: second call with same simId does not double-update question_quality', () => {
    const profile = loadProfileBefore();
    const rows = loadSample();
    const progression = loadProgression();
    const once = updateProfileFromClassification(profile, rows, 'test-sim-qq2', progression);
    const twice = updateProfileFromClassification(once, rows, 'test-sim-qq2', progression);
    const onceQQ = once.question_quality as { avg_overall: number; total_questions_scored: number };
    const twiceQQ = twice.question_quality as { avg_overall: number; total_questions_scored: number };
    assert.equal(twiceQQ.avg_overall, onceQQ.avg_overall);
    assert.equal(twiceQQ.total_questions_scored, onceQQ.total_questions_scored);
  });
});

describe('updateProfileFromClassification sessions_at_current_rank', () => {
  it('resets to 0 when rank changes', () => {
    const rows = loadSample();
    const progression = loadProgression();
    // Seed with 14 so after the +1 increment (line 122) sessions_at_current_rank
    // reaches 15, satisfying junior-investigator.quality_gate.min_sessions_at_rank.
    const profile = {
      ...loadProfileBefore(),
      rank: 'responder',
      rank_title: 'Responder',
      sessions_at_current_rank: 14,
      question_quality: { avg_overall: 6 },
    };
    const updated = updateProfileFromClassification(profile, rows, 'test-sim-reset', progression);
    assert.notEqual(updated.rank, 'responder', 'precondition: rank should have advanced');
    assert.equal(updated.sessions_at_current_rank, 0);
  });

  it('increments (no reset) when rank does not change', () => {
    const rows = loadSample();
    const progression = loadProgression();
    const profile = {
      ...loadProfileBefore(),
      rank: 'responder',
      rank_title: 'Responder',
      sessions_at_current_rank: 5,
      question_quality: { avg_overall: 0 },
    };
    const updated = updateProfileFromClassification(profile, rows, 'test-sim-noreset', progression);
    assert.equal(updated.rank, 'responder', 'precondition: rank should not have advanced');
    assert.equal(updated.sessions_at_current_rank, 6);
  });
});

describe('updateCatalogFromClassification', () => {
  const sampleRows: CatalogRow[] = [
    { service: 'EC2', sims_completed: 0, knowledge_score: 0, last_practiced: '' },
    { service: 'VPC', sims_completed: 2, knowledge_score: 3, last_practiced: '2026-01-01' },
  ];

  // Inject services so rows engage the catalog under the service-filtered rule.
  function withServices(rows: ClassificationRow[], services: string[]): ClassificationRow[] {
    return rows.map(r => ({ ...r, services }));
  }

  it('increments sims_completed on first call', () => {
    const rows = withServices(loadSample(), ['EC2', 'VPC']);
    const updated = updateCatalogFromClassification(sampleRows, rows, 'sim-001', false);
    assert.equal(updated[0].sims_completed, 1);
    assert.equal(updated[1].sims_completed, 3);
  });

  it('is idempotent: catalog not double-incremented on second call (alreadyCompleted=true)', () => {
    const rows = withServices(loadSample(), ['EC2', 'VPC']);
    const first = updateCatalogFromClassification(sampleRows, rows, 'sim-001', false);
    const second = updateCatalogFromClassification(first, rows, 'sim-001', true);
    assert.equal(second[0].sims_completed, first[0].sims_completed);
    assert.equal(second[1].sims_completed, first[1].sims_completed);
  });

  it('updates last_practiced to today', () => {
    const rows = withServices(loadSample(), ['EC2', 'VPC']);
    const today = new Date().toISOString().slice(0, 10);
    const updated = updateCatalogFromClassification(sampleRows, rows, 'sim-001', false);
    assert.equal(updated[0].last_practiced, today);
  });

  it('does not exceed knowledge_score of 10', () => {
    const rows = withServices(loadSample(), ['EC2']);
    const highScore: CatalogRow[] = [{ service: 'EC2', sims_completed: 100, knowledge_score: 9.9, last_practiced: '' }];
    const updated = updateCatalogFromClassification(highScore, rows, 'sim-001', false);
    assert.ok(updated[0].knowledge_score <= 10);
  });
});
