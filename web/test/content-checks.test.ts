const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

describe('content-checks', () => {
  const sourcePath = path.join(ROOT, 'scripts', 'content-checks.ts');

  it('module exists', () => {
    assert.ok(fs.existsSync(sourcePath), 'scripts/content-checks.ts should exist');
  });

  it('exports buildContentPrompt function', () => {
    const mod = require(sourcePath);
    assert.equal(typeof mod.buildContentPrompt, 'function');
  });

  it('exports runContentCheck function', () => {
    const mod = require(sourcePath);
    assert.equal(typeof mod.runContentCheck, 'function');
  });

  it('buildContentPrompt returns string containing manifest content', () => {
    const { buildContentPrompt } = require(sourcePath);
    const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'sims', 'registry.json'), 'utf8'));
    const simId = registry.sims[0].id;
    const prompt = buildContentPrompt(simId);
    assert.ok(typeof prompt === 'string');
    assert.ok(prompt.length > 500, 'prompt should be substantial');
    // Should contain the sim's title from manifest
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'sims', simId, 'manifest.json'), 'utf8'));
    assert.ok(prompt.includes(manifest.title), 'prompt should contain sim title');
  });

  it('buildContentPrompt includes story.md content', () => {
    const { buildContentPrompt } = require(sourcePath);
    const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'sims', 'registry.json'), 'utf8'));
    const simId = registry.sims[0].id;
    const prompt = buildContentPrompt(simId);
    const story = fs.readFileSync(path.join(ROOT, 'sims', simId, 'story.md'), 'utf8');
    // At least part of the story should appear
    const firstLine = story.split('\n').find(l => l.trim().length > 20);
    if (firstLine) {
      assert.ok(prompt.includes(firstLine.trim()), 'prompt should contain story content');
    }
  });

  it('buildContentPrompt includes artifact filenames', () => {
    const { buildContentPrompt } = require(sourcePath);
    const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'sims', 'registry.json'), 'utf8'));
    const simId = registry.sims[0].id;
    const artifactsDir = path.join(ROOT, 'sims', simId, 'artifacts');
    if (fs.existsSync(artifactsDir)) {
      const prompt = buildContentPrompt(simId);
      const files = fs.readdirSync(artifactsDir);
      if (files.length > 0) {
        assert.ok(prompt.includes(files[0]), 'prompt should reference artifact filenames');
      }
    }
  });

  it('buildContentPrompt includes all 7 validation dimensions', () => {
    const { buildContentPrompt } = require(sourcePath);
    const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'sims', 'registry.json'), 'utf8'));
    const simId = registry.sims[0].id;
    const prompt = buildContentPrompt(simId);
    const dimensions = ['summary', 'title', 'difficulty', 'services', 'tags', 'category', 'learning_objectives'];
    for (const d of dimensions) {
      assert.ok(prompt.includes(d), 'prompt should mention dimension: ' + d);
    }
  });

  it('buildContentPrompt throws for nonexistent sim', () => {
    const { buildContentPrompt } = require(sourcePath);
    assert.throws(() => buildContentPrompt('nonexistent-sim-999'), /not found/i);
  });
});
