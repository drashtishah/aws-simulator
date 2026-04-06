const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

describe('end-session-checks', () => {
  const sourcePath = path.join(ROOT, 'scripts', 'end-session-checks.ts');

  it('module exists', () => {
    assert.ok(fs.existsSync(sourcePath), 'scripts/end-session-checks.ts should exist');
  });

  it('exports buildEndSessionPrompt function', () => {
    const mod = require(sourcePath);
    assert.equal(typeof mod.buildEndSessionPrompt, 'function');
  });

  it('exports runEndSessionCheck function', () => {
    const mod = require(sourcePath);
    assert.equal(typeof mod.runEndSessionCheck, 'function');
  });

  it('buildEndSessionPrompt returns string with all 3 dimensions', () => {
    const { buildEndSessionPrompt } = require(sourcePath);
    const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'sims', 'registry.json'), 'utf8'));
    const simId = registry.sims[0].id;
    const prompt = buildEndSessionPrompt(simId);
    assert.ok(typeof prompt === 'string');
    const dimensions = ['no_play_another', 'session_complete_present', 'no_post_complete'];
    for (const d of dimensions) {
      assert.ok(prompt.includes(d), 'prompt should mention dimension: ' + d);
    }
  });

  it('buildEndSessionPrompt includes SESSION_COMPLETE reference', () => {
    const { buildEndSessionPrompt } = require(sourcePath);
    const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'sims', 'registry.json'), 'utf8'));
    const simId = registry.sims[0].id;
    const prompt = buildEndSessionPrompt(simId);
    assert.ok(prompt.includes('SESSION_COMPLETE'), 'prompt should reference SESSION_COMPLETE');
  });

  it('buildEndSessionPrompt throws for nonexistent sim', () => {
    const { buildEndSessionPrompt } = require(sourcePath);
    assert.throws(() => buildEndSessionPrompt('nonexistent-sim-999'), /not found/i);
  });
});
