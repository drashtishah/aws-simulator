import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { filterAvailableSims } from '../public/sim-picker-filter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

describe('session lifecycle: sim-picker filter', () => {
  const sims = [
    { id: 'a', title: 'A' },
    { id: 'b', title: 'B' },
    { id: 'c', title: 'C' }
  ];

  it('hides sims whose session is completed', () => {
    const sessions = [{ sim_id: 'a', status: 'completed' }];
    const result = filterAvailableSims(sims, sessions);
    assert.deepEqual(result.map(s => s.id), ['b', 'c']);
  });

  it('hides sims whose session is in post-processing', () => {
    const sessions = [{ sim_id: 'b', status: 'post-processing' }];
    const result = filterAvailableSims(sims, sessions);
    assert.deepEqual(result.map(s => s.id), ['a', 'c']);
  });

  it('hides both completed and post-processing sims together', () => {
    const sessions = [
      { sim_id: 'a', status: 'completed' },
      { sim_id: 'b', status: 'post-processing' },
      { sim_id: 'c', status: 'in_progress' }
    ];
    const result = filterAvailableSims(sims, sessions);
    assert.deepEqual(result.map(s => s.id), ['c']);
  });
});

describe('session lifecycle: claude-stream completion path', () => {
  const streamSrc = fs.readFileSync(
    path.join(REPO_ROOT, 'web', 'lib', 'claude-stream.ts'),
    'utf8'
  );

  it('sets gameSessionUpdate.status to post-processing on sessionComplete', () => {
    // Source-text assertion: the streaming path is a long async generator
    // that would require a large mock harness to exercise end-to-end. We
    // verify the exact literal used when sessionComplete is true.
    assert.ok(
      streamSrc.includes("gameSessionUpdate.status = 'post-processing'"),
      "claude-stream must set status to 'post-processing' (not 'completed') on sessionComplete"
    );
    assert.ok(
      !streamSrc.includes("gameSessionUpdate.status = 'completed'"),
      "claude-stream must not set status to 'completed' directly; the Tier 2 renderer is the only authoritative flip"
    );
  });

  it('claude-process mid-turn update also emits post-processing, not completed', () => {
    const processSrc = fs.readFileSync(
      path.join(REPO_ROOT, 'web', 'lib', 'claude-process.ts'),
      'utf8'
    );
    assert.ok(
      processSrc.includes("gameSessionUpdate.status = 'post-processing'"),
      "claude-process sendMessage path must set status to 'post-processing'"
    );
    assert.ok(
      !processSrc.includes("gameSessionUpdate.status = 'completed'"),
      "claude-process must not flip gameSessionUpdate.status to 'completed' directly"
    );
  });
});

describe('session lifecycle: tier-2 renderer is the only completed flip', () => {
  it('post-session-orchestrator.ts contains exactly one session.status = completed assignment (tier-2)', () => {
    const orchestratorSrc = fs.readFileSync(
      path.join(REPO_ROOT, 'scripts', 'post-session-orchestrator.ts'),
      'utf8'
    );
    const matches = orchestratorSrc.match(/session\.status\s*=\s*'completed'/g) ?? [];
    assert.equal(
      matches.length,
      1,
      'exactly one site in post-session-orchestrator.ts may flip session.status to completed (the Tier 2 renderer)'
    );
  });

  it('classifier prompt does not instruct the Tier 1 agent to set status to completed', () => {
    const classifierSrc = fs.readFileSync(
      path.join(REPO_ROOT, 'web', 'lib', 'classifier-prompt.ts'),
      'utf8'
    );
    assert.ok(
      !classifierSrc.includes('status: "completed"'),
      'Tier 1 classifier prompt must not instruct the agent to flip status to completed'
    );
  });
});
