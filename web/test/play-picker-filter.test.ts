import { describe, it } from 'node:test';
import assert from 'node:assert';
import { filterAvailableSims } from '../public/sim-picker-filter.js';

describe('sim picker filter', () => {
  const sims = [
    { id: 'a', title: 'A' },
    { id: 'b', title: 'B' },
    { id: 'c', title: 'C' }
  ];

  it('hides sims with a completed session', () => {
    const sessions = [{ sim_id: 'b', status: 'completed' }];
    const result = filterAvailableSims(sims, sessions);
    assert.deepEqual(result.map(s => s.id), ['a', 'c']);
  });

  it('keeps sims with in_progress sessions', () => {
    const sessions = [{ sim_id: 'a', status: 'in_progress' }];
    const result = filterAvailableSims(sims, sessions);
    assert.deepEqual(result.map(s => s.id), ['a', 'b', 'c']);
  });

  it('handles no sessions', () => {
    const result = filterAvailableSims(sims, []);
    assert.equal(result.length, 3);
  });
});
