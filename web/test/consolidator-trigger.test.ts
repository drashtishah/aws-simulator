import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldRunConsolidator, runConsolidator } from '../../scripts/consolidator';

describe('shouldRunConsolidator', () => {
  it('returns false when total_sessions is 0', () => {
    assert.equal(shouldRunConsolidator(0, undefined), false);
  });

  it('returns true on every sim when interval is 1', () => {
    assert.equal(shouldRunConsolidator(1, '1'), true);
    assert.equal(shouldRunConsolidator(2, '1'), true);
  });

  it('returns false for 1 to 4 when interval is default 5', () => {
    assert.equal(shouldRunConsolidator(1, undefined), false);
    assert.equal(shouldRunConsolidator(2, undefined), false);
    assert.equal(shouldRunConsolidator(3, undefined), false);
    assert.equal(shouldRunConsolidator(4, undefined), false);
  });

  it('returns true at multiples of the default 5', () => {
    assert.equal(shouldRunConsolidator(5, undefined), true);
    assert.equal(shouldRunConsolidator(10, undefined), true);
    assert.equal(shouldRunConsolidator(15, undefined), true);
  });

  it('returns false for 1..4 when interval env is 5', () => {
    assert.equal(shouldRunConsolidator(1, '5'), false);
    assert.equal(shouldRunConsolidator(2, '5'), false);
    assert.equal(shouldRunConsolidator(3, '5'), false);
    assert.equal(shouldRunConsolidator(4, '5'), false);
  });
});

describe('runConsolidator error handling', () => {
  it('swallows errors from the spawned agent and resolves normally', async () => {
    async function* throwingSpawn(): AsyncGenerator<unknown> {
      yield { type: 'system', subtype: 'init', session_id: 'mock', model: 'claude-opus-4-7' };
      throw new Error('simulated agent failure');
    }
    const spawnFn = throwingSpawn as unknown as Parameters<typeof runConsolidator>[1] extends { spawnFn?: infer S } ? S : never;
    // Assertion: runConsolidator must resolve (not reject) even when the agent throws.
    await runConsolidator(5, { spawnFn });
    assert.ok(true, 'runConsolidator resolved without rethrowing');
  });

  it('resolves cleanly when the spawned generator yields nothing', async () => {
    async function* emptySpawn(): AsyncGenerator<unknown> {
      // yield nothing
    }
    const spawnFn = emptySpawn as unknown as Parameters<typeof runConsolidator>[1] extends { spawnFn?: infer S } ? S : never;
    await runConsolidator(10, { spawnFn });
    assert.ok(true, 'runConsolidator resolved on empty-iterator spawn');
  });
});
