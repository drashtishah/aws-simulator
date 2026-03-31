const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildRecord } = require('../../.claude/hooks/log-hook');

describe('buildRecord', () => {
  it('always includes base fields', () => {
    const rec = buildRecord({ hook_event_name: 'Stop', session_id: 's1' });
    assert.equal(typeof rec.ts, 'string');
    assert.equal(rec.event, 'Stop');
    assert.equal(rec.session_id, 's1');
    assert.equal(rec.tool, null);
  });

  it('PostToolUse with Bash extracts command', () => {
    const rec = buildRecord({
      hook_event_name: 'PostToolUse',
      session_id: 's1',
      tool_name: 'Bash',
      tool_input: { command: 'npm test' }
    });
    assert.equal(rec.tool, 'Bash');
    assert.equal(rec.command, 'npm test');
  });

  it('PostToolUse with Read extracts file_path as target', () => {
    const rec = buildRecord({
      hook_event_name: 'PostToolUse',
      session_id: 's1',
      tool_name: 'Read',
      tool_input: { file_path: '/foo/bar.js' }
    });
    assert.equal(rec.target, '/foo/bar.js');
  });

  it('PostToolUse with Grep extracts pattern', () => {
    const rec = buildRecord({
      hook_event_name: 'PostToolUse',
      session_id: 's1',
      tool_name: 'Grep',
      tool_input: { pattern: 'logEvent' }
    });
    assert.equal(rec.pattern, 'logEvent');
  });

  it('PostToolUse without tool_input does not crash', () => {
    const rec = buildRecord({
      hook_event_name: 'PostToolUse',
      session_id: 's1',
      tool_name: 'Bash'
    });
    assert.equal(rec.tool, 'Bash');
    assert.equal(rec.target, undefined);
    assert.equal(rec.command, undefined);
  });

  it('UserPromptSubmit includes prompt', () => {
    const rec = buildRecord({
      hook_event_name: 'UserPromptSubmit',
      session_id: 's1',
      prompt: 'what CloudWatch metrics?'
    });
    assert.equal(rec.prompt, 'what CloudWatch metrics?');
    assert.equal(rec.tool, null);
  });

  it('SessionStart includes source and model', () => {
    const rec = buildRecord({
      hook_event_name: 'SessionStart',
      session_id: 's1',
      source: 'startup',
      model: 'claude-sonnet-4-6'
    });
    assert.equal(rec.source, 'startup');
    assert.equal(rec.model, 'claude-sonnet-4-6');
  });

  it('SessionEnd includes reason', () => {
    const rec = buildRecord({
      hook_event_name: 'SessionEnd',
      session_id: 's1',
      reason: 'prompt_input_exit'
    });
    assert.equal(rec.reason, 'prompt_input_exit');
  });

  it('PostToolUseFailure includes error, is_interrupt, and optional target/command', () => {
    const rec = buildRecord({
      hook_event_name: 'PostToolUseFailure',
      session_id: 's1',
      tool_name: 'Bash',
      error: 'command timed out',
      is_interrupt: false,
      tool_input: { command: 'curl http://example.com', file_path: '/tmp/out' }
    });
    assert.equal(rec.error, 'command timed out');
    assert.equal(rec.is_interrupt, false);
    assert.equal(rec.command, 'curl http://example.com');
    assert.equal(rec.target, '/tmp/out');
  });

  it('StopFailure includes error_type and error_details', () => {
    const rec = buildRecord({
      hook_event_name: 'StopFailure',
      session_id: 's1',
      error: 'rate_limit',
      error_details: 'Too many requests'
    });
    assert.equal(rec.error_type, 'rate_limit');
    assert.equal(rec.error_details, 'Too many requests');
  });

  it('PreCompact includes trigger', () => {
    const rec = buildRecord({
      hook_event_name: 'PreCompact',
      session_id: 's1',
      trigger: 'auto'
    });
    assert.equal(rec.trigger, 'auto');
  });

  it('PostCompact includes trigger', () => {
    const rec = buildRecord({
      hook_event_name: 'PostCompact',
      session_id: 's1',
      trigger: 'auto'
    });
    assert.equal(rec.trigger, 'auto');
  });

  it('unknown event returns base fields only', () => {
    const rec = buildRecord({
      hook_event_name: 'SomeNewEvent',
      session_id: 's1',
      tool_name: 'Foo'
    });
    assert.equal(rec.event, 'SomeNewEvent');
    assert.equal(rec.tool, 'Foo');
    assert.equal(rec.prompt, undefined);
    assert.equal(rec.source, undefined);
  });

  it('handles missing optional fields gracefully', () => {
    const rec = buildRecord({
      hook_event_name: 'SessionStart',
      session_id: 's1'
    });
    assert.equal(rec.source, null);
    assert.equal(rec.model, null);
  });
});
