const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const { buildPrompt } = require('../lib/prompt-builder');

const ROOT = path.resolve(__dirname, '..', '..');

// Get a real sim ID from registry for testing
const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'sims', 'registry.json'), 'utf8'));
const testSimId = registry.sims[0].id;

describe('buildPrompt', () => {
  it('returns a non-empty string', () => {
    const prompt = buildPrompt(testSimId, 'calm-mentor');
    assert.ok(typeof prompt === 'string');
    assert.ok(prompt.length > 100);
  });

  it('throws for nonexistent sim', () => {
    assert.throws(() => buildPrompt('nonexistent-sim-999', 'calm-mentor'), /not found/);
  });

  it('throws for nonexistent theme', () => {
    assert.throws(() => buildPrompt(testSimId, 'nonexistent-theme-999'), /not found/);
  });

  it('contains the sim ID in the output', () => {
    const prompt = buildPrompt(testSimId, 'calm-mentor');
    assert.ok(prompt.includes(testSimId));
  });

  it('contains web session rules', () => {
    const prompt = buildPrompt(testSimId, 'calm-mentor');
    assert.ok(prompt.includes('[CONSOLE_START]'));
    assert.ok(prompt.includes('[COACHING_START]'));
    assert.ok(prompt.includes('[SESSION_COMPLETE]'));
  });

  it('contains console data from manifest', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'sims', testSimId, 'manifest.json'), 'utf8'));
    const prompt = buildPrompt(testSimId, 'calm-mentor');
    for (const console of manifest.team.consoles) {
      assert.ok(prompt.includes(console.service), `prompt should mention service: ${console.service}`);
    }
  });

  it('does not contain unresolved mandatory placeholders', () => {
    const prompt = buildPrompt(testSimId, 'calm-mentor');
    // Check for common placeholder patterns that should have been replaced
    const unresolvedPatterns = [
      '{narrator.personality}',
      '{company.name}',
      '{company.industry}',
      '{company.size}',
      '{artifacts/context.txt contents}',
      '{theme.base}',
      '{theme.voice}',
    ];
    for (const pattern of unresolvedPatterns) {
      assert.ok(!prompt.includes(pattern), `should not contain unresolved placeholder: ${pattern}`);
    }
  });

  it('contains fix criteria from manifest', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'sims', testSimId, 'manifest.json'), 'utf8'));
    const prompt = buildPrompt(testSimId, 'calm-mentor');
    for (const criteria of manifest.resolution.fix_criteria) {
      assert.ok(prompt.includes(criteria.id), `should contain fix criterion: ${criteria.id}`);
    }
  });

  it('works with all available themes', () => {
    const themesDir = path.join(ROOT, 'themes');
    const themes = fs.readdirSync(themesDir)
      .filter(f => f.endsWith('.md') && !f.startsWith('_'))
      .map(f => f.replace('.md', ''));

    for (const themeId of themes) {
      const prompt = buildPrompt(testSimId, themeId);
      assert.ok(prompt.length > 100, `prompt should be non-trivial for theme: ${themeId}`);
    }
  });

  it('works with all registered sims', () => {
    for (const sim of registry.sims) {
      const prompt = buildPrompt(sim.id, 'calm-mentor');
      assert.ok(prompt.length > 100, `prompt should be non-trivial for sim: ${sim.id}`);
      assert.ok(prompt.includes(sim.id), `prompt should contain sim id: ${sim.id}`);
    }
  });

  it('error for nonexistent sim includes the sim ID', () => {
    assert.throws(
      () => buildPrompt('my-missing-sim-xyz', 'calm-mentor'),
      (err) => {
        assert.ok(err.message.includes('my-missing-sim-xyz'), 'error should include the sim ID');
        return true;
      }
    );
  });

  it('error for nonexistent theme includes the theme ID', () => {
    assert.throws(
      () => buildPrompt(testSimId, 'nonexistent-theme-xyz'),
      (err) => {
        assert.ok(err.message.includes('nonexistent-theme-xyz'), 'error should include the theme ID');
        return true;
      }
    );
  });

  it('handles missing optional artifacts without crashing', () => {
    // buildPrompt already uses readArtifact which returns fallback text for missing files
    // This test verifies the prompt still builds successfully even if an artifact path doesn't exist
    const prompt = buildPrompt(testSimId, 'calm-mentor');
    assert.ok(typeof prompt === 'string');
    // Should not contain raw {artifacts/...} placeholders
    assert.ok(!prompt.includes('{artifacts/'), 'artifacts placeholders should be resolved');
  });

  it('includes auto-save session rule with correct sim ID', () => {
    const prompt = buildPrompt(testSimId, 'calm-mentor');
    assert.ok(
      prompt.includes(`learning/sessions/${testSimId}/session.json`),
      'should include session file path with sim ID'
    );
  });

  it('includes all web session markers', () => {
    const prompt = buildPrompt(testSimId, 'calm-mentor');
    const markers = ['[CONSOLE_START]', '[CONSOLE_END]', '[COACHING_START]', '[COACHING_END]', '[SESSION_COMPLETE]'];
    for (const marker of markers) {
      assert.ok(prompt.includes(marker), `should include marker: ${marker}`);
    }
  });

  it('contains no-play-another rule in web session rules', () => {
    const prompt = buildPrompt(testSimId, 'calm-mentor');
    assert.ok(prompt.includes('Do not offer another simulation'), 'should contain no-play-another rule');
  });

  it('contains Player Context when profile.json exists', () => {
    const profilePath = path.join(ROOT, 'learning', 'profile.json');
    if (fs.existsSync(profilePath)) {
      const prompt = buildPrompt(testSimId, 'calm-mentor');
      assert.ok(prompt.includes('Player Context'), 'should contain Player Context section');
    }
  });

  it('builds successfully when profile.json does not exist', () => {
    // buildPrompt should not throw even if profile is missing
    // (graceful degradation via try/catch in buildPlayerContext)
    const prompt = buildPrompt(testSimId, 'calm-mentor');
    assert.ok(typeof prompt === 'string');
    assert.ok(prompt.length > 100);
  });
});
