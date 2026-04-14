import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import { buildPrompt } from '../lib/prompt-builder';

const ROOT = path.resolve(__dirname, '..', '..');
const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'sims', 'registry.json'), 'utf8'));
const testSimId = registry.sims[0].id;

describe('buildPrompt (persona template)', () => {
  it('returns a non-empty prompt with the persona text', () => {
    const prompt = buildPrompt(testSimId, 'calm-mentor');
    assert.ok(typeof prompt === 'string');
    assert.ok(prompt.length > 100);
    assert.ok(prompt.includes('You are the narrator of an AWS incident'));
  });

  it('throws for nonexistent sim with sim id in error', () => {
    assert.throws(() => buildPrompt('nonexistent-sim-999', 'calm-mentor'), /nonexistent-sim-999/);
  });

  it('accepts any themeId without crashing (themes are no longer injected)', () => {
    const prompt = buildPrompt(testSimId, 'nonexistent-theme-999');
    assert.ok(prompt.length > 100);
  });

  it('substitutes {sim_id} so the journal path resolves', () => {
    const prompt = buildPrompt(testSimId, 'calm-mentor');
    assert.ok(prompt.includes(`learning/sessions/${testSimId}/narrator-notes.md`));
    assert.ok(!prompt.includes('{sim_id}'));
  });

  it('injects manifest.json content under its heading', () => {
    const prompt = buildPrompt(testSimId, 'calm-mentor');
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'sims', testSimId, 'manifest.json'), 'utf8'));
    assert.ok(prompt.includes('### manifest.json'));
    assert.ok(prompt.includes(manifest.title));
    for (const console of manifest.consoles ?? []) {
      assert.ok(prompt.includes(console.service), `prompt should mention service: ${console.service}`);
    }
  });

  it('injects story.md content under its heading', () => {
    const prompt = buildPrompt(testSimId, 'calm-mentor');
    const story = fs.readFileSync(path.join(ROOT, 'sims', testSimId, 'story.md'), 'utf8');
    assert.ok(prompt.includes('### story.md'));
    const firstLine = story.split('\n').find(l => l.trim().length > 0) ?? '';
    if (firstLine) assert.ok(prompt.includes(firstLine.trim()));
  });

  it('does not inject theme files (themes are not part of the prompt)', () => {
    const prompt = buildPrompt(testSimId, 'calm-mentor');
    assert.ok(!prompt.includes('### themes/_base.md'));
    assert.ok(!prompt.includes('### themes/calm-mentor.md'));
  });

  it('does not inline artifact file contents (narrator Read()s them on demand)', () => {
    const prompt = buildPrompt(testSimId, 'calm-mentor');
    assert.ok(!prompt.includes('### artifacts/'), 'prompt should not inline artifact headings');
  });

  it('injects resolution.md so the narrator can guide and verify fixes', () => {
    const prompt = buildPrompt(testSimId, 'calm-mentor');
    const resolutionPath = path.join(ROOT, 'sims', testSimId, 'resolution.md');
    if (fs.existsSync(resolutionPath)) {
      assert.ok(prompt.includes('### resolution.md'));
    }
  });

  it('injects opening.md so the narrator knows what the player has already seen', () => {
    const prompt = buildPrompt(testSimId, 'calm-mentor');
    const opening = fs.readFileSync(path.join(ROOT, 'sims', testSimId, 'opening.md'), 'utf8');
    assert.ok(prompt.includes('## Opening (already shown)'), 'prompt must include the opening header');
    const firstLine = opening.split('\n').find(l => l.trim().length > 0) ?? '';
    if (firstLine) assert.ok(prompt.includes(firstLine.trim()), 'prompt must contain the opening content');
  });

  it('builds for every registered sim', () => {
    for (const sim of registry.sims) {
      const prompt = buildPrompt(sim.id, 'calm-mentor');
      assert.ok(prompt.length > 100, `prompt should be non-trivial for sim: ${sim.id}`);
      assert.ok(prompt.includes(`learning/sessions/${sim.id}/narrator-notes.md`), `sim id should be substituted: ${sim.id}`);
    }
  });

  it('builds identically for every themeId (themeId is cosmetic)', () => {
    const p1 = buildPrompt(testSimId, 'calm-mentor');
    const p2 = buildPrompt(testSimId, 'some-other-theme');
    assert.equal(p1, p2);
  });
});
