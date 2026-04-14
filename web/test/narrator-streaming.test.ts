import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { stripNarratorMarkers } from '../public/narrator-markers.ts';

describe('stripNarratorMarkers', () => {
  it('removes DROPDOWN blocks and SESSION_COMPLETE', () => {
    const input = '[DROPDOWN label="Console" open="false"]output[/DROPDOWN]before [SESSION_COMPLETE] after';
    const result = stripNarratorMarkers(input);
    assert.ok(!result.includes('[DROPDOWN'), 'should not contain [DROPDOWN');
    assert.ok(!result.includes('[/DROPDOWN]'), 'should not contain [/DROPDOWN]');
    assert.ok(!result.includes('[SESSION_COMPLETE]'), 'should not contain [SESSION_COMPLETE]');
  });

  it('preserves prose outside DROPDOWN blocks', () => {
    const input = 'Hello world. [SESSION_COMPLETE]';
    const result = stripNarratorMarkers(input);
    assert.ok(result.includes('Hello world.'), 'should preserve prose');
  });

  it('handles multiple DROPDOWN blocks', () => {
    const input = 'intro[DROPDOWN label="A"]aaa[/DROPDOWN]middle[DROPDOWN label="B"]bbb[/DROPDOWN]end';
    const result = stripNarratorMarkers(input);
    assert.ok(!result.includes('[DROPDOWN'), 'no DROPDOWN markers remain');
    assert.ok(result.includes('intro'), 'intro preserved');
    assert.ok(result.includes('middle'), 'middle preserved');
    assert.ok(result.includes('end'), 'end preserved');
  });
});
