import fs from 'node:fs';
import crypto from 'node:crypto';
import { LOGS_DIR, RAW_LOG_FILE } from './paths.js';

const CONTEXT_WARN_PCT = 0.80;
const LATENCY_WARN_MS = 30000;
const TOOL_LOOP_THRESHOLD = 5;

const toolCallTracker = new Map<string, number>();
const sessionTraces = new Map<string, string>();

interface LogRecord {
  ts: string;
  session_id: string;
  trace_id: string;
  [key: string]: unknown;
}

interface EventData {
  level?: string;
  event?: string;
  usage?: { input_tokens?: number; duration_ms?: number };
  tool?: string;
  target?: string;
  [key: string]: unknown;
}

function ensureLogsDir(): void {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function logEvent(sessionId: string | null, event: EventData): void {
  if (!sessionId) return;

  let trace_id = sessionTraces.get(sessionId);
  if (!trace_id) {
    trace_id = crypto.randomUUID();
    sessionTraces.set(sessionId, trace_id);
  }

  ensureLogsDir();

  const record: LogRecord = {
    ts: new Date().toISOString(),
    session_id: sessionId,
    trace_id,
    ...event
  };
  const line = JSON.stringify(record) + '\n';

  // PR-B: unified destination. The previous system/activity split is gone;
  // downstream consumers filter on `level` and `event` fields instead.
  try {
    fs.appendFileSync(RAW_LOG_FILE, line);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to write log to ${RAW_LOG_FILE}: ${message}`);
  }

  checkThresholds(sessionId, event);

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

function checkThresholds(sessionId: string, event: EventData): void {
  if (event.usage?.input_tokens) {
    const contextWindow = 1000000;
    const pct = event.usage.input_tokens / contextWindow;
    if (pct > CONTEXT_WARN_PCT) {
      logEvent(sessionId, {
        level: 'warn',
        event: 'CONTEXT_HIGH',
        context_pct: pct.toFixed(2)
      });
    }
  }

  if (event.usage?.duration_ms && event.usage.duration_ms > LATENCY_WARN_MS) {
    logEvent(sessionId, {
      level: 'warn',
      event: 'HIGH_LATENCY',
      duration_ms: event.usage.duration_ms
    });
  }

  if (event.event === 'tool_use' && event.tool && event.target) {
    const key = sessionId + ':' + event.tool + ':' + event.target;
    const count = (toolCallTracker.get(key) ?? 0) + 1;
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

function generateFixManifest(
  sessionId: string,
  outcome: string,
  rootCause: string,
  errorChain: string[],
  suggestedFixes: string[]
): void {
  if (outcome === 'success') return;

  logEvent(sessionId, {
    event: 'fix_manifest',
    outcome,
    root_cause: rootCause,
    error_chain: errorChain || [],
    suggested_fixes: suggestedFixes || []
  });
}

export { logEvent, generateFixManifest, sessionTraces };
