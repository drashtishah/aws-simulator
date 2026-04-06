const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

describe('debrief-checks', () => {
  const sourcePath = path.join(ROOT, 'scripts', 'debrief-checks.ts');

  it('module exists', () => {
    assert.ok(fs.existsSync(sourcePath), 'scripts/debrief-checks.ts should exist');
  });

  it('exports buildDebriefPrompt function', () => {
    const mod = require(sourcePath);
    assert.equal(typeof mod.buildDebriefPrompt, 'function');
  });

  it('exports runDebriefCheck function', () => {
    const mod = require(sourcePath);
    assert.equal(typeof mod.runDebriefCheck, 'function');
  });

  it('buildDebriefPrompt returns string with all 5 dimensions', () => {
    const { buildDebriefPrompt } = require(sourcePath);
    const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'sims', 'registry.json'), 'utf8'));
    const simId = registry.sims[0].id;
    const prompt = buildDebriefPrompt(simId);
    assert.ok(typeof prompt === 'string');
    const dimensions = ['summary_brevity', 'seed_quality', 'zone_accuracy', 'no_new_info', 'voice_continuity'];
    for (const d of dimensions) {
      assert.ok(prompt.includes(d), 'prompt should mention dimension: ' + d);
    }
  });

  it('buildDebriefPrompt includes resolution data', () => {
    const { buildDebriefPrompt } = require(sourcePath);
    const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'sims', 'registry.json'), 'utf8'));
    const simId = registry.sims[0].id;
    const prompt = buildDebriefPrompt(simId);
    assert.ok(prompt.includes('Fix criteria'), 'prompt should include fix criteria section');
    assert.ok(prompt.includes('Learning objectives'), 'prompt should include learning objectives');
  });

  it('buildDebriefPrompt throws for nonexistent sim', () => {
    const { buildDebriefPrompt } = require(sourcePath);
    assert.throws(() => buildDebriefPrompt('nonexistent-sim-999'), /not found/i);
  });
});
