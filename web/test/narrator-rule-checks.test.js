const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

describe('narrator-rule-checks', () => {
  const sourcePath = path.join(ROOT, 'scripts', 'narrator-rule-checks.js');

  it('module exists', () => {
    assert.ok(fs.existsSync(sourcePath), 'scripts/narrator-rule-checks.js should exist');
  });

  it('exports buildNarratorRulesPrompt function', () => {
    const mod = require(sourcePath);
    assert.equal(typeof mod.buildNarratorRulesPrompt, 'function');
  });

  it('exports runNarratorRulesCheck function', () => {
    const mod = require(sourcePath);
    assert.equal(typeof mod.runNarratorRulesCheck, 'function');
  });

  it('buildNarratorRulesPrompt returns string with all 6 dimensions', () => {
    const { buildNarratorRulesPrompt } = require(sourcePath);
    const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'sims', 'registry.json'), 'utf8'));
    const simId = registry.sims[0].id;
    const prompt = buildNarratorRulesPrompt(simId);
    assert.ok(typeof prompt === 'string');
    const dimensions = ['no_emojis', 'no_fourth_wall', 'console_format', 'no_premature_hints', 'voice_consistency', 'no_fix_criteria_leak'];
    for (const d of dimensions) {
      assert.ok(prompt.includes(d), 'prompt should mention dimension: ' + d);
    }
  });

  it('buildNarratorRulesPrompt throws for nonexistent sim', () => {
    const { buildNarratorRulesPrompt } = require(sourcePath);
    assert.throws(() => buildNarratorRulesPrompt('nonexistent-sim-999'), /not found/i);
  });
});
