import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PLAY_AGENT_POLICY, POST_SESSION_POLICY } from '../lib/agent-policies.js';

const SIM_ID = 'ec2-unreachable';

describe('PLAY_AGENT_POLICY', () => {
  const policy = PLAY_AGENT_POLICY(SIM_ID);

  it('allows Write to session narrator-notes', async () => {
    const result = await policy.canUseTool('Write', { file_path: `learning/sessions/${SIM_ID}/narrator-notes.md` }, {} as Parameters<typeof policy.canUseTool>[2]);
    assert.equal(result.behavior, 'allow');
  });

  it('allows Write to any file under session dir', async () => {
    const result = await policy.canUseTool('Write', { file_path: `learning/sessions/${SIM_ID}/turns.jsonl` }, {} as Parameters<typeof policy.canUseTool>[2]);
    assert.equal(result.behavior, 'allow');
  });

  it('denies Write to sims directory', async () => {
    const result = await policy.canUseTool('Write', { file_path: 'sims/foo.md' }, {} as Parameters<typeof policy.canUseTool>[2]);
    assert.equal(result.behavior, 'deny');
  });

  it('denies Write to player-vault', async () => {
    const result = await policy.canUseTool('Write', { file_path: 'learning/player-vault/x.md' }, {} as Parameters<typeof policy.canUseTool>[2]);
    assert.equal(result.behavior, 'deny');
  });

  it('denies path traversal outside workspace root', async () => {
    const result = await policy.canUseTool('Write', { file_path: '../etc/passwd' }, {} as Parameters<typeof policy.canUseTool>[2]);
    assert.equal(result.behavior, 'deny');
  });

  it('allows Read unconditionally', async () => {
    const result = await policy.canUseTool('Read', { file_path: 'sims/foo.md' }, {} as Parameters<typeof policy.canUseTool>[2]);
    assert.equal(result.behavior, 'allow');
  });
});

describe('POST_SESSION_POLICY', () => {
  const policy = POST_SESSION_POLICY(SIM_ID);

  it('allows Write to player-vault profile', async () => {
    const result = await policy.canUseTool('Write', { file_path: 'learning/player-vault/profile.json' }, {} as Parameters<typeof policy.canUseTool>[2]);
    assert.equal(result.behavior, 'allow');
  });

  it('allows Write to player-vault catalog', async () => {
    const result = await policy.canUseTool('Write', { file_path: 'learning/player-vault/catalog.json' }, {} as Parameters<typeof policy.canUseTool>[2]);
    assert.equal(result.behavior, 'allow');
  });

  it('allows Write to session json', async () => {
    const result = await policy.canUseTool('Write', { file_path: `learning/sessions/${SIM_ID}/session.json` }, {} as Parameters<typeof policy.canUseTool>[2]);
    assert.equal(result.behavior, 'allow');
  });

  it('allows Write to session markdown', async () => {
    const result = await policy.canUseTool('Write', { file_path: `learning/sessions/${SIM_ID}/notes.md` }, {} as Parameters<typeof policy.canUseTool>[2]);
    assert.equal(result.behavior, 'allow');
  });

  it('denies Write to sims', async () => {
    const result = await policy.canUseTool('Write', { file_path: 'sims/foo.md' }, {} as Parameters<typeof policy.canUseTool>[2]);
    assert.equal(result.behavior, 'deny');
  });

  it('denies Write to system-vault', async () => {
    const result = await policy.canUseTool('Write', { file_path: 'learning/system-vault/x.md' }, {} as Parameters<typeof policy.canUseTool>[2]);
    assert.equal(result.behavior, 'deny');
  });
});
