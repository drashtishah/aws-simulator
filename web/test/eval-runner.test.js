const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..', '..');

describe('eval scoring spec', () => {
  const specPath = path.join(ROOT, 'references', 'eval-scoring.yaml');

  it('eval-scoring.yaml exists and parses', () => {
    assert.ok(fs.existsSync(specPath), 'eval-scoring.yaml should exist');
    const spec = yaml.load(fs.readFileSync(specPath, 'utf8'));
    assert.ok(spec.categories, 'should have categories');
  });

  it('has 60 checks total', () => {
    const spec = yaml.load(fs.readFileSync(specPath, 'utf8'));
    const total = Object.values(spec.categories).flat().length;
    assert.equal(total, 60, 'should have exactly 60 checks');
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
