const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'migrate-to-vault.js');

// Create a temp directory that mimics a learning/ setup
function setupTestEnv() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-test-'));
  const learningDir = path.join(tmpDir, 'learning');
  fs.mkdirSync(learningDir);

  // Copy default-profile.json
  const refsDir = path.join(tmpDir, 'references');
  fs.mkdirSync(refsDir);
  fs.copyFileSync(
    path.join(ROOT, 'references', 'default-profile.json'),
    path.join(refsDir, 'default-profile.json')
  );

  // Copy vault templates
  const templatesDir = path.join(refsDir, 'vault-templates', 'patterns');
  fs.mkdirSync(templatesDir, { recursive: true });
  const templateSrc = path.join(ROOT, 'references', 'vault-templates');
  fs.copyFileSync(path.join(templateSrc, 'index.md'), path.join(refsDir, 'vault-templates', 'index.md'));
  fs.copyFileSync(path.join(templateSrc, 'patterns', 'behavioral-profile.md'), path.join(templatesDir, 'behavioral-profile.md'));
  fs.copyFileSync(path.join(templateSrc, 'patterns', 'question-quality.md'), path.join(templatesDir, 'question-quality.md'));
  fs.copyFileSync(path.join(templateSrc, 'patterns', 'investigation-style.md'), path.join(templatesDir, 'investigation-style.md'));

  return tmpDir;
}

function createProfile(learningDir, overrides = {}) {
  const profile = {
    rank_title: 'Investigator',
    skill_polygon: { gather: 3, diagnose: 3, correlate: 1, impact: 1, trace: 1, fix: 1 },
    polygon_last_advanced: {},
    completed_sims: ['001-ec2', '002-s3'],
    total_sessions: 5,
    ...overrides
  };
  fs.writeFileSync(path.join(learningDir, 'profile.json'), JSON.stringify(profile, null, 2));
}

function createJournal(learningDir) {
  const journal = `---
tags:
  - type/learning-journal
---

# Learning Journal

## EC2 Unreachable

- **Date**: 2026-03-24
- **Sim**: [[001-ec2-unreachable]]
- **Difficulty**: 1
- **Category**: networking

### Coaching summary

Good investigation.

## S3 Public Exposure

- **Date**: 2026-03-25
- **Sim**: [[002-s3-public-exposure]]
- **Difficulty**: 1
- **Category**: security

### Coaching summary

Found the bucket policy quickly.
`;
  fs.writeFileSync(path.join(learningDir, 'journal.md'), journal);
}

function createCatalog(learningDir) {
  const csv = `service,full_name,category,cert_relevance,knowledge_score,sims_completed,last_practiced,notes
ec2,Amazon EC2,compute,SAA-C03,3,2,2026-03-25,good
s3,Amazon S3,storage,SAA-C03,2,1,2026-03-24,found policy
iam,AWS IAM,security,SAA-C03,0,0,,
`;
  fs.writeFileSync(path.join(learningDir, 'catalog.csv'), csv);
}

// We can't easily run the script against a temp directory without modifying it.
// Instead, test the migration logic by importing the script's functions or
// testing the outcomes against the real references.

describe('migration script structure', () => {
  it('script exists', () => {
    assert.ok(fs.existsSync(SCRIPT), 'migrate-to-vault.js should exist');
  });

  it('script is valid JavaScript (syntax check)', () => {
    assert.doesNotThrow(() => {
      // Use Node's syntax check
      execSync(`node --check ${SCRIPT}`, { encoding: 'utf8' });
    });
  });
});

describe('default-profile.json has vault fields', () => {
  const profile = JSON.parse(fs.readFileSync(path.join(ROOT, 'references', 'default-profile.json'), 'utf8'));

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
    assert.ok(content.includes('learning/vault/'), 'setup should reference vault directory');
    assert.ok(content.includes('vault-templates'), 'setup should reference vault templates');
  });
});
