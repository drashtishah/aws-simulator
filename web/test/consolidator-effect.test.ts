import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runConsolidator } from '../../scripts/consolidator';

// The consolidator's real effect is file creation, which happens inside the
// spawned agent's tool calls. We inject a fake spawnFn that yields a plausible
// SDK message stream without side-effects and assert runConsolidator completes
// cleanly. The scope test covers the write-policy contract; the isolation test
// covers D2+D3 disjointness; this test locks the success path.

describe('runConsolidator success path', () => {
  it('returns normally when the injected SDK yields a clean message stream', async () => {
    const calls: { prompt: string; options: Record<string, unknown> }[] = [];

    async function* fakeSpawn(input: { prompt: string; options: Record<string, unknown> }): AsyncGenerator<unknown> {
      calls.push(input);
      yield { type: 'system', subtype: 'init', session_id: 'fake', model: 'claude-opus-4-7' };
      yield {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Consolidation complete. Wrote 3 insight notes.' },
          ],
        },
      };
      yield {
        type: 'result',
        subtype: 'success',
        usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 80 },
        duration_ms: 2000,
      };
    }

    type SpawnFn = NonNullable<Parameters<typeof runConsolidator>[1]>['spawnFn'];
    await runConsolidator(5, { spawnFn: fakeSpawn as unknown as SpawnFn });

    assert.equal(calls.length, 1, 'spawnFn must be invoked exactly once');
    const [call] = calls;
    assert.ok(call!.prompt.includes('sim #5'), 'prompt must mention the session number');
    assert.ok(
      call!.prompt.includes('learning/player-vault/insights/'),
      'prompt must reference insights directory'
    );
    assert.equal(
      (call!.options as { model: string }).model,
      'claude-opus-4-7',
      'consolidator must run on opus'
    );
  });
});
