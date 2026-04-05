const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { loadConfig, axisNames, currentRank } = require('../lib/progression');

const ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_PATH = path.join(ROOT, 'references', 'progression.yaml');
const DEFAULT_PROFILE_PATH = path.join(ROOT, 'references', 'default-profile.json');
const SETUP_SKILL_PATH = path.join(ROOT, '.claude', 'skills', 'setup', 'SKILL.md');
const PLAY_SKILL_PATH = path.join(ROOT, '.claude', 'skills', 'play', 'SKILL.md');

// Load the shared default profile template
function loadDefaultProfile() {
  const content = fs.readFileSync(DEFAULT_PROFILE_PATH, 'utf8');
  const jsonStr = content.replace(/"\{today\}"/g, '"2026-01-01"');
  return JSON.parse(jsonStr);
}

// Verify the skill references the shared profile
function verifySkillReferencesProfile(skillPath, label) {
  const content = fs.readFileSync(skillPath, 'utf8');
  assert.ok(content.includes('references/default-profile.json'),
    label + ' SKILL.md must reference references/default-profile.json');
}

describe('setup skill profile template consistency', () => {
  const config = loadConfig(CONFIG_PATH);
  const setupProfile = loadDefaultProfile();

  it('setup SKILL.md references shared default-profile.json', () => {
    verifySkillReferencesProfile(SETUP_SKILL_PATH, 'setup');
  });

  it('skill_polygon axes match progression.yaml axes', () => {
    const configAxes = axisNames(config).sort();
    const profileAxes = Object.keys(setupProfile.skill_polygon).sort();
    assert.deepEqual(profileAxes, configAxes,
      'setup profile skill_polygon keys must match progression.yaml axes');
  });

  it('skill_polygon axes all initialize to 0', () => {
    for (const [axis, value] of Object.entries(setupProfile.skill_polygon)) {
      assert.equal(value, 0, axis + ' should initialize to 0');
    }
  });

  it('rank_title matches the default rank from progression.yaml', () => {
    // An all-zero polygon should evaluate to the last rank (default/fallback)
    const defaultRank = currentRank(setupProfile.skill_polygon, config);
    assert.equal(setupProfile.rank_title, defaultRank.title,
      'setup rank_title must match the rank computed from an all-zero polygon');
  });

  it('rank_history default entry uses the correct rank id', () => {
    const defaultRank = currentRank(setupProfile.skill_polygon, config);
    assert.ok(Array.isArray(setupProfile.rank_history), 'rank_history must be an array');
    assert.ok(setupProfile.rank_history.length >= 1, 'rank_history must have at least one entry');
    assert.equal(setupProfile.rank_history[0].rank, defaultRank.id,
      'rank_history initial entry must match the default rank id');
  });

  it('has all required profile fields', () => {
    const requiredFields = [
      'rank_title',
      'skill_polygon',
      'polygon_last_advanced',
      'completed_sims',
      'service_exposure',
      'question_patterns',
      'challenge_runs',
      'rank_history',
      'total_sessions',
      'last_session',
      'vault_version',
      'question_quality',
      'sessions_at_current_rank',
      'behavioral_profile_summary'
    ];
    for (const field of requiredFields) {
      assert.ok(field in setupProfile,
        'setup profile template must include "' + field + '"');
    }
  });

  it('completed_sims initializes as empty array', () => {
    assert.ok(Array.isArray(setupProfile.completed_sims));
    assert.equal(setupProfile.completed_sims.length, 0);
  });

  it('challenge_runs initializes as empty array', () => {
    assert.ok(Array.isArray(setupProfile.challenge_runs));
    assert.equal(setupProfile.challenge_runs.length, 0);
  });

  it('total_sessions initializes to 0', () => {
    assert.equal(setupProfile.total_sessions, 0);
  });

  it('vault_version is 1', () => {
    assert.equal(setupProfile.vault_version, 1);
  });

  it('sessions_at_current_rank initializes to 0', () => {
    assert.equal(setupProfile.sessions_at_current_rank, 0);
  });

  it('question_quality has expected sub-fields', () => {
    const qq = setupProfile.question_quality;
    assert.ok(qq, 'question_quality must exist');
    assert.equal(qq.avg_overall, 0);
    assert.equal(qq.total_questions_scored, 0);
    assert.deepEqual(qq.last_5_session_avgs, []);
  });

  it('behavioral_profile_summary has expected sub-fields', () => {
    const bp = setupProfile.behavioral_profile_summary;
    assert.ok(bp, 'behavioral_profile_summary must exist');
    assert.equal(bp.primary_approach, null);
    assert.equal(bp.confidence_calibration, null);
    assert.equal(bp.debrief_engagement, null);
  });

  it('question_patterns has expected sub-fields', () => {
    const qp = setupProfile.question_patterns;
    assert.ok(qp, 'question_patterns must exist');
    assert.ok('first_action_frequency' in qp, 'must have first_action_frequency');
    assert.ok('avg_questions_before_fix' in qp, 'must have avg_questions_before_fix');
    assert.ok('audit_trail_check_rate' in qp, 'must have audit_trail_check_rate');
    assert.ok('multi_service_investigation_rate' in qp, 'must have multi_service_investigation_rate');
  });
});

describe('setup and play skill profile templates match', () => {
  it('both skills reference the same shared default-profile.json', () => {
    verifySkillReferencesProfile(SETUP_SKILL_PATH, 'setup');
    verifySkillReferencesProfile(PLAY_SKILL_PATH, 'play');
  });
});

describe('setup creates vault structure', () => {
  it('setup SKILL.md includes vault creation step', () => {
    const content = fs.readFileSync(SETUP_SKILL_PATH, 'utf8');
    assert.ok(content.includes('5b. Create learning vault'), 'setup should have vault creation step');
  });

  it('vault templates exist for all required files', () => {
    const templateDir = path.join(ROOT, 'references', 'vault-templates');
    assert.ok(fs.existsSync(path.join(templateDir, 'index.md')), 'index.md template should exist');
    assert.ok(fs.existsSync(path.join(templateDir, 'patterns', 'behavioral-profile.md')), 'behavioral-profile.md template should exist');
    assert.ok(fs.existsSync(path.join(templateDir, 'patterns', 'question-quality.md')), 'question-quality.md template should exist');
    assert.ok(fs.existsSync(path.join(templateDir, 'patterns', 'investigation-style.md')), 'investigation-style.md template should exist');
  });
});

describe('progression.yaml and theme consistency', () => {
  const config = loadConfig(CONFIG_PATH);

  it('default rank (empty polygon) exists in config', () => {
    const rank = currentRank({}, config);
    assert.ok(rank.id, 'default rank must have an id');
    assert.ok(rank.title, 'default rank must have a title');
    assert.ok(rank.max_difficulty >= 1, 'default rank must allow at least difficulty 1');
  });

  it('calm-mentor theme file exists', () => {
    const themePath = path.join(ROOT, 'themes', 'calm-mentor.md');
    assert.ok(fs.existsSync(themePath), 'themes/calm-mentor.md must exist');
  });

  it('_base.md theme file exists', () => {
    const basePath = path.join(ROOT, 'themes', '_base.md');
    assert.ok(fs.existsSync(basePath), 'themes/_base.md must exist');
  });

  it('no stale theme files remain', () => {
    const themesDir = path.join(ROOT, 'themes');
    const themeFiles = fs.readdirSync(themesDir).filter(f => f.endsWith('.md') && !f.startsWith('_'));
    assert.deepEqual(themeFiles, ['calm-mentor.md'],
      'only calm-mentor.md should exist as a non-base theme');
  });

  it('category_map references only valid axes', () => {
    const validAxes = new Set(axisNames(config));
    for (const [category, axes] of Object.entries(config.category_map)) {
      for (const axis of axes) {
        assert.ok(validAxes.has(axis),
          'category_map.' + category + ' references unknown axis "' + axis + '"');
      }
    }
  });

  it('modifier bonus_axes reference only valid axes', () => {
    const validAxes = new Set(axisNames(config));
    for (const mod of config.modifiers) {
      for (const axis of mod.bonus_axes) {
        assert.ok(validAxes.has(axis),
          'modifier ' + mod.id + ' bonus_axes references unknown axis "' + axis + '"');
      }
    }
  });

  it('assist config has standard and guided modes', () => {
    assert.ok(config.assist.standard, 'assist must have standard mode');
    assert.ok(config.assist.guided, 'assist must have guided mode');
    assert.ok(config.assist.standard.label, 'standard must have a label');
    assert.ok(config.assist.guided.label, 'guided must have a label');
  });
});
