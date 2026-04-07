const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const paths = require('../lib/paths');

// PR-B unification: there is now a single raw.jsonl. The legacy LOG_FILE
// and SYSTEM_LOG_FILE constants alias to RAW_LOG_FILE; tests that used to
// distinguish between them now filter by `level` / `event` fields instead.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logger-test-'));
const tmpRawLogFile = path.join(tmpDir, 'raw.jsonl');
paths.LOGS_DIR = tmpDir;
paths.RAW_LOG_FILE = tmpRawLogFile;
paths.LOG_FILE = tmpRawLogFile;
paths.SYSTEM_LOG_FILE = tmpRawLogFile;

const { logEvent, generateFixManifest, sessionTraces } = require('../lib/logger');

const RAW_LOG_FILE = tmpRawLogFile;

function lastLogLine() {
  const content = fs.readFileSync(RAW_LOG_FILE, 'utf8').trim();
  const lines = content.split('\n');
  return JSON.parse(lines[lines.length - 1]);
}

function lastNLogLines(n) {
  const content = fs.readFileSync(RAW_LOG_FILE, 'utf8').trim();
  const lines = content.split('\n');
  return lines.slice(-n).map(l => JSON.parse(l));
}

function allLogLines() {
  if (!fs.existsSync(RAW_LOG_FILE)) return [];
  const content = fs.readFileSync(RAW_LOG_FILE, 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map(l => JSON.parse(l));
}

describe('logEvent', () => {
  it('writes a JSON line to raw.jsonl', () => {
    const sizeBefore = fs.existsSync(RAW_LOG_FILE) ? fs.statSync(RAW_LOG_FILE).size : 0;
    logEvent('test-session-1', { level: 'info', event: 'unit_test' });
    const sizeAfter = fs.statSync(RAW_LOG_FILE).size;
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
    const sizeBefore = fs.statSync(RAW_LOG_FILE).size;
    logEvent(null, { level: 'info', event: 'should_not_log' });
    logEvent('', { level: 'info', event: 'should_not_log' });
    logEvent(undefined, { level: 'info', event: 'should_not_log' });
    const sizeAfter = fs.statSync(RAW_LOG_FILE).size;
    assert.equal(sizeBefore, sizeAfter, 'log file should not grow for null session');
  });
});

describe('generateFixManifest', () => {
  it('does not log when outcome is success', () => {
    const sizeBefore = fs.statSync(RAW_LOG_FILE).size;
    generateFixManifest('test-session-fix', 'success', 'none', [], []);
    const sizeAfter = fs.statSync(RAW_LOG_FILE).size;
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
      usage: { input_tokens: 850000 }
    });
    const lines = allLogLines();
    const warning = lines.find(l => l.session_id === 'test-threshold-ctx' && l.event === 'CONTEXT_HIGH');
    assert.ok(warning, 'should log CONTEXT_HIGH warning in raw.jsonl');
    assert.equal(warning.level, 'warn');
    assert.ok(warning.context_pct, 'should include context_pct');
  });

  it('does not log CONTEXT_HIGH when input_tokens < 80%', () => {
    logEvent('test-threshold-ctx-ok', {
      level: 'info',
      event: 'turn',
      usage: { input_tokens: 500000 }
    });
    const warnings = allLogLines().filter(l =>
      l.session_id === 'test-threshold-ctx-ok' && l.event === 'CONTEXT_HIGH'
    );
    assert.equal(warnings.length, 0, 'should not log CONTEXT_HIGH below 80%');
  });

  it('logs HIGH_LATENCY when duration_ms > 30000', () => {
    logEvent('test-threshold-lat', {
      level: 'info',
      event: 'turn',
      usage: { duration_ms: 35000 }
    });
    const warning = allLogLines().find(l =>
      l.session_id === 'test-threshold-lat' && l.event === 'HIGH_LATENCY'
    );
    assert.ok(warning, 'should log HIGH_LATENCY warning in raw.jsonl');
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
    const warnings = allLogLines().filter(l => l.session_id === sessionId && l.event === 'TOOL_LOOP');
    assert.ok(warnings.length > 0, 'should log TOOL_LOOP warning in raw.jsonl after > 5 calls');
    assert.equal(warnings[0].tool, 'Read');
    assert.equal(warnings[0].target, '/some/file.js');
  });

  it('writes valid JSONL (each line parseable as JSON)', () => {
    logEvent('test-jsonl-valid', { level: 'info', event: 'test_jsonl' });
    const content = fs.readFileSync(RAW_LOG_FILE, 'utf8').trim();
    const lines = content.split('\n');
    for (const line of lines) {
      assert.doesNotThrow(() => JSON.parse(line), 'every line must be valid JSON');
    }
  });
});

describe('trace ID correlation', () => {
  it('includes trace_id for same session across multiple calls (same trace_id)', () => {
    const sid = 'test-trace-same-' + Date.now();
    logEvent(sid, { level: 'info', event: 'first' });
    logEvent(sid, { level: 'info', event: 'second' });
    const lines = lastNLogLines(2);
    assert.ok(lines[0].trace_id, 'first line should have trace_id');
    assert.ok(lines[1].trace_id, 'second line should have trace_id');
    assert.equal(lines[0].trace_id, lines[1].trace_id, 'same session should produce same trace_id');
  });

  it('different sessionIds produce different trace_ids', () => {
    const sid1 = 'test-trace-diff-a-' + Date.now();
    const sid2 = 'test-trace-diff-b-' + Date.now();
    logEvent(sid1, { level: 'info', event: 'a' });
    logEvent(sid2, { level: 'info', event: 'b' });
    const lines = lastNLogLines(2);
    assert.ok(lines[0].trace_id, 'first session should have trace_id');
    assert.ok(lines[1].trace_id, 'second session should have trace_id');
    assert.notEqual(lines[0].trace_id, lines[1].trace_id, 'different sessions should have different trace_ids');
  });
});

describe('unified log destination (PR-B)', () => {
  it('all events, including warnings, land in raw.jsonl', () => {
    logEvent('test-route-sys', {
      level: 'info',
      event: 'turn',
      usage: { input_tokens: 850000 }
    });
    assert.ok(fs.existsSync(RAW_LOG_FILE), 'raw.jsonl should be created');
    const lines = allLogLines();
    const warning = lines.find(l => l.event === 'CONTEXT_HIGH' && l.session_id === 'test-route-sys');
    assert.ok(warning, 'CONTEXT_HIGH warning should be in raw.jsonl');
    const turn = lines.find(l => l.event === 'turn' && l.session_id === 'test-route-sys');
    assert.ok(turn, 'turn event should also be in raw.jsonl');
  });

  it('regular learning events grow raw.jsonl', () => {
    const sizeBefore = fs.existsSync(RAW_LOG_FILE) ? fs.statSync(RAW_LOG_FILE).size : 0;
    logEvent('test-route-learn', { level: 'info', event: 'unit_test_route' });
    const sizeAfter = fs.statSync(RAW_LOG_FILE).size;
    assert.ok(sizeAfter > sizeBefore, 'raw.jsonl should grow with learning events');
  });
});

describe('session cleanup on session_end', () => {
  it('toolCallTracker is cleared on session_end', () => {
    const sid = 'test-cleanup-tool-' + Date.now();
    for (let i = 0; i < 4; i++) {
      logEvent(sid, { level: 'info', event: 'tool_use', tool: 'Read', target: '/cleanup/file.js' });
    }
    logEvent(sid, { level: 'info', event: 'session_end' });
    for (let i = 0; i < 4; i++) {
      logEvent(sid, { level: 'info', event: 'tool_use', tool: 'Read', target: '/cleanup/file.js' });
    }
    const warnings = allLogLines().filter(l => l.session_id === sid && l.event === 'TOOL_LOOP');
    assert.equal(warnings.length, 0, 'should not trigger TOOL_LOOP after session_end reset');
  });

  it('sessionTraces is cleaned on session_end', () => {
    const sid = 'test-cleanup-trace-' + Date.now();
    logEvent(sid, { level: 'info', event: 'first_batch' });
    const firstLine = lastLogLine();
    const firstTraceId = firstLine.trace_id;
    assert.ok(firstTraceId, 'should have a trace_id');

    logEvent(sid, { level: 'info', event: 'session_end' });
    assert.equal(sessionTraces.has(sid), false, 'sessionTraces should not contain the session after session_end');

    logEvent(sid, { level: 'info', event: 'second_batch' });
    const secondLine = lastLogLine();
    const secondTraceId = secondLine.trace_id;
    assert.ok(secondTraceId, 'should have a new trace_id');
    assert.notEqual(firstTraceId, secondTraceId, 'trace_id should differ after session_end');
  });
});
