import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildClassifierPrompt } from '../lib/classifier-prompt.js';

describe('buildClassifierPrompt', () => {
  const SIM_ID = '001-ec2-unreachable';

  it('returns a string', () => {
    const prompt = buildClassifierPrompt(SIM_ID);
    assert.equal(typeof prompt, 'string');
  });

  it('references turns.jsonl', () => {
    const prompt = buildClassifierPrompt(SIM_ID);
    assert.ok(prompt.includes('turns.jsonl'));
  });

  it('references session.json', () => {
    const prompt = buildClassifierPrompt(SIM_ID);
    assert.ok(prompt.includes('session.json'));
  });

  it('references manifest.json', () => {
    const prompt = buildClassifierPrompt(SIM_ID);
    assert.ok(prompt.includes('manifest.json'));
  });

  it('references coaching-patterns.md', () => {
    const prompt = buildClassifierPrompt(SIM_ID);
    assert.ok(prompt.includes('coaching-patterns.md'));
  });

  it('references progression.yaml', () => {
    const prompt = buildClassifierPrompt(SIM_ID);
    assert.ok(prompt.includes('progression.yaml'));
  });

  it('references classification.jsonl output path', () => {
    const prompt = buildClassifierPrompt(SIM_ID);
    assert.ok(prompt.includes('classification.jsonl'));
  });

  it('does not reference profile.json', () => {
    const prompt = buildClassifierPrompt(SIM_ID);
    assert.ok(!prompt.includes('profile.json'), 'Tier 1 prompt must not reference profile.json');
  });

  it('does not reference catalog.csv', () => {
    const prompt = buildClassifierPrompt(SIM_ID);
    assert.ok(!prompt.includes('catalog.csv'), 'Tier 1 prompt must not reference catalog.csv');
  });

  it('does not reference player-vault', () => {
    const prompt = buildClassifierPrompt(SIM_ID);
    assert.ok(!prompt.includes('player-vault'), 'Tier 1 prompt must not reference player-vault');
  });
});
