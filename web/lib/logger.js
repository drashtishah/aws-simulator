const fs = require('fs');
const crypto = require('crypto');
const paths = require('./paths');

const LOGS_DIR = paths.LOGS_DIR;

// Warning thresholds
const CONTEXT_WARN_PCT = 0.80;
const LATENCY_WARN_MS = 30000;
const TOOL_LOOP_THRESHOLD = 5;

// Track tool calls per session for loop detection
const toolCallTracker = new Map();

// Track trace IDs per session
const sessionTraces = new Map();

function ensureLogsDir() {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function logEvent(sessionId, event) {
  if (!sessionId) return;

  let trace_id = sessionTraces.get(sessionId);
  if (!trace_id) {
    trace_id = crypto.randomUUID();
    sessionTraces.set(sessionId, trace_id);
  }

  ensureLogsDir();

  const record = {
    ts: new Date().toISOString(),
    session_id: sessionId,
    trace_id,
    ...event
  };
  const line = JSON.stringify(record) + '\n';

  // Route system-level events to system.jsonl, learning events to activity.jsonl
  const isSystemEvent = event.level === 'warn' ||
    ['CONTEXT_HIGH', 'HIGH_LATENCY', 'TOOL_LOOP'].includes(event.event);
  const logFile = isSystemEvent ? paths.SYSTEM_LOG_FILE : paths.LOG_FILE;
  try {
    fs.appendFileSync(logFile, line);
  } catch (err) {
    console.error(`Failed to write log to ${logFile}: ${err.message}`);
  }

  // Check warning thresholds
  checkThresholds(sessionId, event);

  // Clean up session state on session end
  if (event.event === 'session_end') {
    sessionTraces.delete(sessionId);
    const prefix = sessionId + ':';
    for (const key of toolCallTracker.keys()) {
      if (key.startsWith(prefix)) {
        toolCallTracker.delete(key);
      }
    }
  }
}

function checkThresholds(sessionId, event) {
  // Context utilization warning
  if (event.usage && event.usage.input_tokens) {
    const contextWindow = 1000000; // opus context window
    const pct = event.usage.input_tokens / contextWindow;
    if (pct > CONTEXT_WARN_PCT) {
      logEvent(sessionId, {
        level: 'warn',
        event: 'CONTEXT_HIGH',
        context_pct: pct.toFixed(2)
      });
    }
  }

  // Latency warning
  if (event.usage && event.usage.duration_ms && event.usage.duration_ms > LATENCY_WARN_MS) {
    logEvent(sessionId, {
      level: 'warn',
      event: 'HIGH_LATENCY',
      duration_ms: event.usage.duration_ms
    });
  }

  // API retry warning
  if (event.event === 'retry') {
    // Already logged at warn level
  }

  // Tool loop detection
  if (event.event === 'tool_use' && event.tool && event.target) {
    const key = sessionId + ':' + event.tool + ':' + event.target;
    const count = (toolCallTracker.get(key) || 0) + 1;
    toolCallTracker.set(key, count);
    if (count > TOOL_LOOP_THRESHOLD) {
      logEvent(sessionId, {
        level: 'warn',
        event: 'TOOL_LOOP',
        tool: event.tool,
        target: event.target,
        count
      });
    }
  }
}

function generateFixManifest(sessionId, outcome, rootCause, errorChain, suggestedFixes) {
  if (outcome === 'success') return;

  logEvent(sessionId, {
    event: 'fix_manifest',
    outcome,
    root_cause: rootCause,
    error_chain: errorChain || [],
    suggested_fixes: suggestedFixes || []
  });
}

module.exports = {
  logEvent,
  generateFixManifest,
  sessionTraces
};
