import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { runAgentCheck, parseAgentJSON } from '../../scripts/agent-test-runner';

const ROOT = path.resolve(__dirname, '..', '..');

describe('agent-test-runner', () => {
  const sourcePath = path.join(ROOT, 'scripts', 'agent-test-runner.ts');

  it('module exists', () => {
    assert.ok(fs.existsSync(sourcePath), 'scripts/agent-test-runner.ts should exist');
  });

  it('exports runAgentCheck function', () => {
    assert.equal(typeof runAgentCheck, 'function');
  });

  it('hardcodes claude-sonnet-4-6', () => {
    const source = fs.readFileSync(sourcePath, 'utf8');
    assert.ok(source.includes("'claude-sonnet-4-6'"),
      'must hardcode claude-sonnet-4-6');
  });

  it('does not contain allowDangerouslySkipPermissions', () => {
    const source = fs.readFileSync(sourcePath, 'utf8');
    assert.ok(!source.includes('allowDangerouslySkipPermissions'),
      'must not use allowDangerouslySkipPermissions');
  });

  it('does not contain allowedTools', () => {
    const source = fs.readFileSync(sourcePath, 'utf8');
    assert.ok(!source.includes('allowedTools'),
      'agent checks need no tools');
  });

  it('sets maxTurns to 1', () => {
    const source = fs.readFileSync(sourcePath, 'utf8');
    assert.ok(source.includes('maxTurns: 1'),
      'must set maxTurns to 1 (no tool loop)');
  });

  it('parseAgentJSON extracts JSON from mixed text', () => {
    const text = 'Some preamble\n```json\n{"pass": true, "findings": []}\n```\nMore text';
    const result = parseAgentJSON(text);
    assert.deepStrictEqual(result, { pass: true, findings: [] });
  });

  it('parseAgentJSON extracts bare JSON object', () => {
    const text = '{"pass": false, "findings": [{"dimension": "summary", "pass": false, "detail": "wrong"}]}';
    const result = parseAgentJSON(text);
    assert.equal(result.pass, false);
    assert.equal(result.findings.length, 1);
  });

  it('parseAgentJSON returns null for invalid input', () => {
    assert.equal(parseAgentJSON('no json here'), null);
  });
});
