const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

describe('hint-progression-checks', () => {
  const sourcePath = path.join(ROOT, 'scripts', 'hint-progression-checks.js');

  it('module exists', () => {
    assert.ok(fs.existsSync(sourcePath), 'scripts/hint-progression-checks.js should exist');
  });

  it('exports buildHintProgressionPrompt function', () => {
    const mod = require(sourcePath);
    assert.equal(typeof mod.buildHintProgressionPrompt, 'function');
  });

  it('exports runHintProgressionCheck function', () => {
    const mod = require(sourcePath);
    assert.equal(typeof mod.runHintProgressionCheck, 'function');
  });

  it('buildHintProgressionPrompt returns string with all 4 dimensions', () => {
    const { buildHintProgressionPrompt } = require(sourcePath);
    const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'sims', 'registry.json'), 'utf8'));
    const simId = registry.sims[0].id;
    const prompt = buildHintProgressionPrompt(simId);
    assert.ok(typeof prompt === 'string');
    const dimensions = ['no_premature_hints', 'correct_ordering', 'skip_logic', 'natural_delivery'];
    for (const d of dimensions) {
      assert.ok(prompt.includes(d), 'prompt should mention dimension: ' + d);
    }
  });

  it('buildHintProgressionPrompt includes hints from manifest', () => {
    const { buildHintProgressionPrompt } = require(sourcePath);
    const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'sims', 'registry.json'), 'utf8'));
    const simId = registry.sims[0].id;
    const prompt = buildHintProgressionPrompt(simId);
    assert.ok(prompt.includes('skip_if_queried'), 'prompt should include skip_if_queried references');
  });

  it('buildHintProgressionPrompt throws for nonexistent sim', () => {
    const { buildHintProgressionPrompt } = require(sourcePath);
    assert.throws(() => buildHintProgressionPrompt('nonexistent-sim-999'), /not found/i);
  });
});
