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
    assert.ok(prompt.includes('You are a guide inside an AWS incident'));
  });

  it('throws for nonexistent sim with sim id in error', () => {
    assert.throws(() => buildPrompt('nonexistent-sim-999', 'calm-mentor'), /nonexistent-sim-999/);
  });

  it('throws for nonexistent theme with theme id in error', () => {
    assert.throws(() => buildPrompt(testSimId, 'nonexistent-theme-999'), /nonexistent-theme-999/);
  });

  it('substitutes {sim_id} so the journal/session paths resolve', () => {
    const prompt = buildPrompt(testSimId, 'calm-mentor');
    assert.ok(prompt.includes(`learning/sessions/${testSimId}/narrator-notes.md`));
    assert.ok(prompt.includes(`learning/sessions/${testSimId}/session.json`));
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

  it('injects themes/_base.md and selected theme', () => {
    const prompt = buildPrompt(testSimId, 'calm-mentor');
    const baseFirstLine = fs.readFileSync(path.join(ROOT, 'themes', '_base.md'), 'utf8').split('\n').find(l => l.trim() && !l.startsWith('---')) ?? '';
    assert.ok(prompt.includes('### themes/_base.md'));
    assert.ok(prompt.includes('### themes/calm-mentor.md'));
    if (baseFirstLine) assert.ok(prompt.includes(baseFirstLine.trim()));
  });

  it('injects every artifact file under its own ### artifacts/{name} heading', () => {
    const prompt = buildPrompt(testSimId, 'calm-mentor');
    const artifactsDir = path.join(ROOT, 'sims', testSimId, 'artifacts');
    if (fs.existsSync(artifactsDir)) {
      const files = fs.readdirSync(artifactsDir);
      for (const f of files) {
        assert.ok(prompt.includes(`### artifacts/${f}`), `prompt should reference artifact heading ${f}`);
      }
    }
  });

  it('builds for every registered sim', () => {
    for (const sim of registry.sims) {
      const prompt = buildPrompt(sim.id, 'calm-mentor');
      assert.ok(prompt.length > 100, `prompt should be non-trivial for sim: ${sim.id}`);
      assert.ok(prompt.includes(`learning/sessions/${sim.id}/narrator-notes.md`), `sim id should be substituted: ${sim.id}`);
    }
  });

  it('builds for every theme', () => {
    const themesDir = path.join(ROOT, 'themes');
    const themes = fs.readdirSync(themesDir)
      .filter(f => f.endsWith('.md') && !f.startsWith('_'))
      .map(f => f.replace('.md', ''));
    for (const themeId of themes) {
      const prompt = buildPrompt(testSimId, themeId);
      assert.ok(prompt.length > 100, `prompt should be non-trivial for theme: ${themeId}`);
    }
  });

  it('strips theme frontmatter (--- fenced block) from the injected theme', () => {
    const prompt = buildPrompt(testSimId, 'calm-mentor');
    const themeFile = fs.readFileSync(path.join(ROOT, 'themes', 'calm-mentor.md'), 'utf8');
    if (themeFile.startsWith('---')) {
      const fm = themeFile.split('---')[1] ?? '';
      const fmKeys = fm.split('\n').map(l => l.split(':')[0]?.trim()).filter(Boolean);
      const idx = prompt.indexOf('### themes/calm-mentor.md');
      assert.ok(idx >= 0, 'theme heading should be present');
      const after = prompt.slice(idx, idx + 200);
      for (const key of fmKeys) {
        if (key && key !== 'name' && key !== 'description') {
          assert.ok(!after.startsWith('---\n'), 'frontmatter fence should be stripped');
        }
      }
    }
  });
});
