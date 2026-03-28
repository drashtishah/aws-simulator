const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const { logEvent, generateFixManifest } = require('../lib/logger');

const LOGS_DIR = path.resolve(__dirname, '..', '..', 'learning', 'logs');
const LOG_FILE = path.join(LOGS_DIR, 'activity.jsonl');

function lastLogLine() {
  const content = fs.readFileSync(LOG_FILE, 'utf8').trim();
  const lines = content.split('\n');
  return JSON.parse(lines[lines.length - 1]);
}

function lastNLogLines(n) {
  const content = fs.readFileSync(LOG_FILE, 'utf8').trim();
  const lines = content.split('\n');
  return lines.slice(-n).map(l => JSON.parse(l));
}

describe('logEvent', () => {
  it('writes a JSON line to activity.jsonl', () => {
    const sizeBefore = fs.existsSync(LOG_FILE) ? fs.statSync(LOG_FILE).size : 0;
    logEvent('test-session-1', { level: 'info', event: 'unit_test' });
    const sizeAfter = fs.statSync(LOG_FILE).size;
    assert.ok(sizeAfter > sizeBefore, 'log file should grow');
  });

  it('includes timestamp and session_id', () => {
    logEvent('test-session-2', { level: 'info', event: 'unit_test_ts' });
    const line = lastLogLine();
    assert.equal(line.session_id, 'test-session-2');
    assert.ok(line.ts, 'should have timestamp');
    assert.ok(new Date(line.ts).getTime() > 0, 'timestamp should be valid date');
  });

  it('includes custom event fields', () => {
    logEvent('test-session-3', { level: 'warn', event: 'custom_event', extra: 'data' });
    const line = lastLogLine();
    assert.equal(line.level, 'warn');
    assert.equal(line.event, 'custom_event');
    assert.equal(line.extra, 'data');
  });

  it('does nothing when sessionId is falsy', () => {
    const sizeBefore = fs.statSync(LOG_FILE).size;
    logEvent(null, { level: 'info', event: 'should_not_log' });
    logEvent('', { level: 'info', event: 'should_not_log' });
    logEvent(undefined, { level: 'info', event: 'should_not_log' });
    const sizeAfter = fs.statSync(LOG_FILE).size;
    assert.equal(sizeBefore, sizeAfter, 'log file should not grow for null session');
  });
});

describe('generateFixManifest', () => {
  it('does not log when outcome is success', () => {
    const sizeBefore = fs.statSync(LOG_FILE).size;
    generateFixManifest('test-session-fix', 'success', 'none', [], []);
    const sizeAfter = fs.statSync(LOG_FILE).size;
    assert.equal(sizeBefore, sizeAfter, 'should not log for success outcome');
  });

  it('logs fix_manifest event for non-success outcomes', () => {
    generateFixManifest('test-session-fix2', 'failure', 'root cause here', ['err1'], ['fix1']);
    const line = lastLogLine();
    assert.equal(line.event, 'fix_manifest');
    assert.equal(line.outcome, 'failure');
    assert.equal(line.root_cause, 'root cause here');
    assert.deepEqual(line.error_chain, ['err1']);
    assert.deepEqual(line.suggested_fixes, ['fix1']);
  });
});

describe('checkThresholds', () => {
  it('logs CONTEXT_HIGH when input_tokens > 80% of context window', () => {
    logEvent('test-threshold-ctx', {
      level: 'info',
      event: 'turn',
      usage: { input_tokens: 170000 }
    });
    const lines = lastNLogLines(2);
    const warning = lines.find(l => l.event === 'CONTEXT_HIGH');
    assert.ok(warning, 'should log CONTEXT_HIGH warning');
    assert.equal(warning.level, 'warn');
    assert.ok(warning.context_pct, 'should include context_pct');
  });

  it('does not log CONTEXT_HIGH when input_tokens < 80%', () => {
    const sizeBefore = fs.statSync(LOG_FILE).size;
    logEvent('test-threshold-ctx-ok', {
      level: 'info',
      event: 'turn',
      usage: { input_tokens: 100000 }
    });
    // Should only have written one line (the original event), not two
    const content = fs.readFileSync(LOG_FILE, 'utf8').trim();
    const lines = content.split('\n');
    const warnings = lines.filter(l => {
      const parsed = JSON.parse(l);
      return parsed.session_id === 'test-threshold-ctx-ok' && parsed.event === 'CONTEXT_HIGH';
    });
    assert.equal(warnings.length, 0, 'should not log CONTEXT_HIGH below 80%');
  });

  it('logs HIGH_LATENCY when duration_ms > 30000', () => {
    logEvent('test-threshold-lat', {
      level: 'info',
      event: 'turn',
      usage: { duration_ms: 35000 }
    });
    const lines = lastNLogLines(2);
    const warning = lines.find(l => l.event === 'HIGH_LATENCY');
    assert.ok(warning, 'should log HIGH_LATENCY warning');
    assert.equal(warning.level, 'warn');
    assert.equal(warning.duration_ms, 35000);
  });

  it('logs TOOL_LOOP when same tool+target called > 5 times', () => {
    const sessionId = 'test-threshold-loop-' + Date.now();
    for (let i = 0; i < 6; i++) {
      logEvent(sessionId, {
        level: 'info',
        event: 'tool_use',
        tool: 'Read',
        target: '/some/file.js'
      });
    }
    const content = fs.readFileSync(LOG_FILE, 'utf8').trim();
    const lines = content.split('\n');
    const warnings = lines.filter(l => {
      const parsed = JSON.parse(l);
      return parsed.session_id === sessionId && parsed.event === 'TOOL_LOOP';
    });
    assert.ok(warnings.length > 0, 'should log TOOL_LOOP warning after > 5 calls');
    const warning = JSON.parse(warnings[0]);
    assert.equal(warning.tool, 'Read');
    assert.equal(warning.target, '/some/file.js');
  });

  it('writes valid JSONL (each line parseable as JSON)', () => {
    logEvent('test-jsonl-valid', { level: 'info', event: 'test_jsonl' });
    const content = fs.readFileSync(LOG_FILE, 'utf8').trim();
    const lines = content.split('\n');
    for (const line of lines) {
      assert.doesNotThrow(() => JSON.parse(line), 'every line must be valid JSON');
    }
  });
});
