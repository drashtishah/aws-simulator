import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');

describe('default-profile.json has vault fields', () => {
  const profile = JSON.parse(fs.readFileSync(path.join(ROOT, 'references', 'config', 'default-profile.json'), 'utf8'));

  it('has vault_version field', () => {
    assert.equal(profile.vault_version, 1);
  });

  it('has question_quality fields with zero defaults', () => {
    assert.ok(profile.question_quality);
    assert.equal(profile.question_quality.avg_overall, 0);
    assert.equal(profile.question_quality.avg_specificity, 0);
    assert.equal(profile.question_quality.avg_relevance, 0);
    assert.equal(profile.question_quality.avg_building, 0);
    assert.equal(profile.question_quality.avg_targeting, 0);
    assert.equal(profile.question_quality.total_questions_scored, 0);
    assert.deepEqual(profile.question_quality.last_5_session_avgs, []);
  });

  it('has sessions_at_current_rank field', () => {
    assert.equal(profile.sessions_at_current_rank, 0);
  });

  it('has behavioral_profile_summary field', () => {
    assert.ok(profile.behavioral_profile_summary);
    assert.equal(profile.behavioral_profile_summary.primary_approach, null);
    assert.equal(profile.behavioral_profile_summary.confidence_calibration, null);
    assert.equal(profile.behavioral_profile_summary.debrief_engagement, null);
  });

  it('has rank_title set to Responder', () => {
    assert.equal(profile.rank_title, 'Responder');
  });

  it('has polygon zeroed', () => {
    for (const axis of Object.values(profile.skill_polygon)) {
      assert.equal(axis, 0);
    }
  });
});

describe('setup creates vault structure', () => {
  // Verify the setup skill references vault creation
  it('setup SKILL.md references vault creation step', () => {
    const skillPath = path.join(ROOT, '.claude', 'skills', 'setup', 'SKILL.md');
    const content = fs.readFileSync(skillPath, 'utf8');
    assert.ok(content.includes('learning/player-vault/'), 'setup should reference player-vault directory');
    assert.ok(content.includes('vault-templates'), 'setup should reference vault templates');
  });
});
