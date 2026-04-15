import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CONSOLIDATOR_SYSTEM_PROMPT } from '../../scripts/consolidator';
import { CONSOLIDATOR_POLICY } from '../lib/agent-policies';

describe('CONSOLIDATOR_SYSTEM_PROMPT', () => {
  const prompt = CONSOLIDATOR_SYSTEM_PROMPT;

  it('contains the 6 target questions verbatim', () => {
    const questions = [
      'How is the player doing overall',
      'What kinds of questions does she ask most',
      'Which services has she touched only superficially',
      'What recurring weakness patterns repeat across sessions',
      'What is her confidence level per axis, per service, per concept',
      'Which concepts co-appear and deserve a dedicated deep-dive sim next',
    ];
    for (const q of questions) {
      assert.ok(prompt.includes(q), `prompt must contain verbatim: ${q}`);
    }
  });

  it('scopes writes to the insights directory', () => {
    assert.ok(
      prompt.includes('learning/player-vault/insights/'),
      'prompt must mention the insights directory'
    );
  });

  it('forbids writes to services, concepts, rank, and sessions', () => {
    assert.ok(prompt.includes('Do not write to learning/player-vault/services/'));
    assert.ok(prompt.includes('learning/player-vault/concepts/'));
    assert.ok(prompt.includes('learning/player-vault/rank.md'));
    assert.ok(prompt.includes('learning/player-vault/sessions/'));
  });

  it('includes the on-duplicate rule for appending updates', () => {
    assert.ok(prompt.includes('append a new'));
    assert.ok(prompt.includes('## Update'));
  });
});

describe('CONSOLIDATOR_POLICY', () => {
  const policy = CONSOLIDATOR_POLICY();

  it('allows Read, Write, Edit, Glob, Grep', () => {
    assert.deepEqual(
      [...policy.allowedTools].sort(),
      ['Edit', 'Glob', 'Grep', 'Read', 'Write']
    );
  });

  it('allows Write under learning/player-vault/insights/', async () => {
    const result = await policy.canUseTool(
      'Write',
      { file_path: 'learning/player-vault/insights/pattern-foo.md' },
      {} as Parameters<typeof policy.canUseTool>[2]
    );
    assert.equal(result.behavior, 'allow');
  });

  it('denies Write to services/', async () => {
    const result = await policy.canUseTool(
      'Write',
      { file_path: 'learning/player-vault/services/ec2.md' },
      {} as Parameters<typeof policy.canUseTool>[2]
    );
    assert.equal(result.behavior, 'deny');
  });

  it('denies Write to concepts/', async () => {
    const result = await policy.canUseTool(
      'Write',
      { file_path: 'learning/player-vault/concepts/security-groups.md' },
      {} as Parameters<typeof policy.canUseTool>[2]
    );
    assert.equal(result.behavior, 'deny');
  });

  it('denies Write to rank.md', async () => {
    const result = await policy.canUseTool(
      'Write',
      { file_path: 'learning/player-vault/rank.md' },
      {} as Parameters<typeof policy.canUseTool>[2]
    );
    assert.equal(result.behavior, 'deny');
  });

  it('denies Write to sessions/', async () => {
    const result = await policy.canUseTool(
      'Write',
      { file_path: 'learning/player-vault/sessions/2026-04-15-foo.md' },
      {} as Parameters<typeof policy.canUseTool>[2]
    );
    assert.equal(result.behavior, 'deny');
  });

  it('denies Edit to services/ (Edit also modifies files)', async () => {
    const result = await policy.canUseTool(
      'Edit',
      { file_path: 'learning/player-vault/services/ec2.md' },
      {} as Parameters<typeof policy.canUseTool>[2]
    );
    assert.equal(result.behavior, 'deny');
  });

  it('allows Edit to insights/', async () => {
    const result = await policy.canUseTool(
      'Edit',
      { file_path: 'learning/player-vault/insights/pattern-foo.md' },
      {} as Parameters<typeof policy.canUseTool>[2]
    );
    assert.equal(result.behavior, 'allow');
  });

  it('allows Read across the vault', async () => {
    const result = await policy.canUseTool(
      'Read',
      { file_path: 'learning/player-vault/services/ec2.md' },
      {} as Parameters<typeof policy.canUseTool>[2]
    );
    assert.equal(result.behavior, 'allow');
  });
});
