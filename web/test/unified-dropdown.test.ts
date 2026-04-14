import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseEvents } from '../lib/claude-parse.js';

describe('unified dropdown tag', () => {
  it('parses [DROPDOWN label=".." open="false"] body [/DROPDOWN]', () => {
    const text = 'Here is the policy.\n[DROPDOWN label="IAM policy" open="false"]\n```json\n{"Version":"2012"}\n```\n[/DROPDOWN]\nMore text.';
    const { events } = parseEvents(text);
    const dropdown = events.find(e => e.type === 'dropdown');
    assert.ok(dropdown, 'expected a dropdown event');
    assert.equal(dropdown.label, 'IAM policy');
    assert.equal(dropdown.open, false);
    assert.ok((dropdown.content ?? '').includes('"Version":"2012"'));
  });

  it('defaults open to false when attribute missing', () => {
    const text = '[DROPDOWN label="Logs"]\nline1\n[/DROPDOWN]';
    const { events } = parseEvents(text);
    const dropdown = events.find(e => e.type === 'dropdown');
    assert.equal(dropdown?.open, false);
  });

  it('supports open="true"', () => {
    const text = '[DROPDOWN label="Tip" open="true"]\nhi\n[/DROPDOWN]';
    const { events } = parseEvents(text);
    const dropdown = events.find(e => e.type === 'dropdown');
    assert.equal(dropdown?.open, true);
  });

  it('leaves plain text alone', () => {
    const text = 'No tags here. Just prose.';
    const { events } = parseEvents(text);
    assert.equal(events[0]?.type, 'text');
  });

  it('strips [SESSION_COMPLETE] from rendered content', () => {
    const text = 'Ending now. [SESSION_COMPLETE]';
    const { events, sessionComplete } = parseEvents(text);
    assert.equal(sessionComplete, true);
    assert.ok(!events.some(e => (e.content ?? '').includes('[SESSION_COMPLETE]')));
  });
});
