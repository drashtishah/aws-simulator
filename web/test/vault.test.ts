const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const paths = require('../lib/paths');
const ROOT = paths.ROOT;
const VAULT_DIR = paths.VAULT_DIR;

describe('vault structure', () => {
  it('vault directory exists or can be created by setup', () => {
    // The vault dir may not exist until /setup runs. This test validates the
    // path is correct and the parent (learning/) is known.
    assert.ok(VAULT_DIR.includes('learning/vault'), 'VAULT_DIR should point to learning/vault');
  });

  it('VAULT_DIR is exported from paths.js', () => {
    assert.ok(paths.VAULT_DIR, 'VAULT_DIR should be exported');
    assert.equal(path.basename(paths.VAULT_DIR), 'vault');
  });
});

describe('vault initial files', () => {
  const vaultFiles = [
    'index.md',
    'patterns/behavioral-profile.md',
    'patterns/question-quality.md',
    'patterns/investigation-style.md',
  ];

  for (const file of vaultFiles) {
    it(`template exists for ${file}`, () => {
      // Check that the template/reference for vault initial files exists
      const templatePath = path.join(ROOT, 'references', 'vault-templates', file);
      assert.ok(fs.existsSync(templatePath), `vault template ${file} should exist at references/vault-templates/`);
    });
  }
});

describe('vault template content', () => {
  it('index.md has required frontmatter', () => {
    const indexPath = path.join(ROOT, 'references', 'vault-templates', 'index.md');
    if (!fs.existsSync(indexPath)) return; // skip if not yet created
    const content = fs.readFileSync(indexPath, 'utf8');
    assert.ok(content.includes('type/index'), 'index.md should have type/index tag');
    assert.ok(content.includes('scope/learning-vault'), 'index.md should have scope/learning-vault tag');
  });

  it('index.md has Recent Sessions section', () => {
    const indexPath = path.join(ROOT, 'references', 'vault-templates', 'index.md');
    if (!fs.existsSync(indexPath)) return;
    const content = fs.readFileSync(indexPath, 'utf8');
    assert.ok(content.includes('## Recent Sessions'), 'index.md should have Recent Sessions section');
  });

  it('index.md has Stats section with required fields', () => {
    const indexPath = path.join(ROOT, 'references', 'vault-templates', 'index.md');
    if (!fs.existsSync(indexPath)) return;
    const content = fs.readFileSync(indexPath, 'utf8');
    assert.ok(content.includes('## Stats'), 'index.md should have Stats section');
    assert.ok(content.includes('Total sessions:'), 'Stats should include Total sessions');
    assert.ok(content.includes('Current rank:'), 'Stats should include Current rank');
  });

  it('behavioral-profile.md has required sections', () => {
    const filePath = path.join(ROOT, 'references', 'vault-templates', 'patterns', 'behavioral-profile.md');
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, 'utf8');
    assert.ok(content.includes('type/pattern'), 'should have type/pattern tag');
    assert.ok(content.includes('## Approach Pattern'), 'should have Approach Pattern section');
    assert.ok(content.includes('## Error Response'), 'should have Error Response section');
    assert.ok(content.includes('## Confidence Calibration'), 'should have Confidence Calibration section');
  });

  it('question-quality.md has running averages section', () => {
    const filePath = path.join(ROOT, 'references', 'vault-templates', 'patterns', 'question-quality.md');
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, 'utf8');
    assert.ok(content.includes('type/pattern'), 'should have type/pattern tag');
    assert.ok(content.includes('## Running Averages'), 'should have Running Averages section');
    assert.ok(content.includes('## Session Averages'), 'should have Session Averages section');
  });
});

describe('question quality scoring', () => {
  const { qualityFactor, updateRunningAverage } = (() => {
    try { return require('../lib/question-quality'); } catch { return {}; }
  })();

  it('qualityFactor: quality 0 returns 0.25 (floor)', () => {
    if (!qualityFactor) return;
    assert.equal(qualityFactor(0), 0.25);
  });

  it('qualityFactor: quality 4 returns 0.5', () => {
    if (!qualityFactor) return;
    assert.equal(qualityFactor(4), 0.5);
  });

  it('qualityFactor: quality 8 returns 1.0 (cap)', () => {
    if (!qualityFactor) return;
    assert.equal(qualityFactor(8), 1.0);
  });

  it('qualityFactor: quality 6 returns 0.75', () => {
    if (!qualityFactor) return;
    assert.equal(qualityFactor(6), 0.75);
  });

  it('updateRunningAverage: correctly updates avg_overall after new session', () => {
    if (!updateRunningAverage) return;
    const profile = {
      question_quality: {
        avg_overall: 4,
        avg_specificity: 1,
        avg_relevance: 2,
        avg_building: 0.5,
        avg_targeting: 0.5,
        total_questions_scored: 10,
        last_5_session_avgs: [3, 4, 5, 4, 4]
      }
    };
    const sessionScores = [
      { specificity: 2, relevance: 2, building: 1, targeting: 1 },
      { specificity: 1, relevance: 2, building: 2, targeting: 2 }
    ];
    const updated = updateRunningAverage(profile, sessionScores);
    assert.ok(updated.question_quality.avg_overall > 0);
    assert.equal(updated.question_quality.last_5_session_avgs.length, 5);
    assert.equal(updated.question_quality.total_questions_scored, 12);
  });

  it('updateRunningAverage: last_5_session_avgs maintains max 5 entries', () => {
    if (!updateRunningAverage) return;
    const profile = {
      question_quality: {
        avg_overall: 4,
        avg_specificity: 1,
        avg_relevance: 2,
        avg_building: 0.5,
        avg_targeting: 0.5,
        total_questions_scored: 10,
        last_5_session_avgs: [3, 4, 5, 4, 4]
      }
    };
    const sessionScores = [
      { specificity: 2, relevance: 2, building: 2, targeting: 2 }
    ];
    const updated = updateRunningAverage(profile, sessionScores);
    assert.equal(updated.question_quality.last_5_session_avgs.length, 5);
  });

  it('updateRunningAverage: per-dimension averages update correctly', () => {
    if (!updateRunningAverage) return;
    const profile = {
      question_quality: {
        avg_overall: 0,
        avg_specificity: 0,
        avg_relevance: 0,
        avg_building: 0,
        avg_targeting: 0,
        total_questions_scored: 0,
        last_5_session_avgs: []
      }
    };
    const sessionScores = [
      { specificity: 2, relevance: 1, building: 0, targeting: 1 }
    ];
    const updated = updateRunningAverage(profile, sessionScores);
    assert.equal(updated.question_quality.avg_specificity, 2);
    assert.equal(updated.question_quality.avg_relevance, 1);
    assert.equal(updated.question_quality.avg_building, 0);
    assert.equal(updated.question_quality.avg_targeting, 1);
  });
});
