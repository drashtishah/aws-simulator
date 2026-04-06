#!/usr/bin/env npx tsx
// Shared hook: logs tool calls + session events for both terminal /play and web app.
// Reads hook input from stdin, appends JSONL to learning/logs/.

import fs from 'node:fs';
import path from 'node:path';

interface HookInput {
  hook_event_name?: string;
  session_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  prompt?: string;
  source?: string;
  model?: string;
  reason?: string;
  error?: string;
  error_details?: string;
  is_interrupt?: boolean;
  trigger?: string;
  task_id?: string;
  subject?: string;
  file_path?: string;
  change_type?: string;
  old_cwd?: string;
  new_cwd?: string;
  [key: string]: unknown;
}

interface LogRecord {
  ts: string;
  event: string | undefined;
  session_id: string | undefined;
  tool: string | null;
  [key: string]: unknown;
}

// System events go to system.jsonl, learning events go to activity.jsonl
const SYSTEM_EVENTS: Set<string> = new Set([
  'PostToolUse', 'PostToolUseFailure', 'StopFailure',
  'PreCompact', 'PostCompact',
  'PermissionDenied', 'CwdChanged', 'FileChanged'
]);

function logDestination(eventName: string): string {
  return SYSTEM_EVENTS.has(eventName) ? 'system.jsonl' : 'activity.jsonl';
}

function buildRecord(data: HookInput): LogRecord {
  const base: LogRecord = {
    ts: new Date().toISOString(),
    event: data.hook_event_name,
    session_id: data.session_id,
    tool: data.tool_name || null
  };

  switch (data.hook_event_name) {
    case 'PostToolUse':
      if (data.tool_input) {
        if (data.tool_input.file_path) base.target = data.tool_input.file_path;
        if (data.tool_input.command) base.command = data.tool_input.command;
        if (data.tool_input.pattern) base.pattern = data.tool_input.pattern;
      }
      break;

    case 'UserPromptSubmit':
      base.prompt = data.prompt || null;
      break;

    case 'SessionStart':
      base.source = data.source || null;
      base.model = data.model || null;
      if (data.model) {
        const modelPath: string = path.join(process.cwd(), 'learning', '.current-model');
        try { fs.writeFileSync(modelPath, data.model, 'utf8'); } catch {}
      }
      break;

    case 'SessionEnd':
      base.reason = data.reason || null;
      break;

    case 'PostToolUseFailure':
      base.error = data.error || null;
      base.is_interrupt = data.is_interrupt || false;
      if (data.tool_input) {
        if (data.tool_input.file_path) base.target = data.tool_input.file_path;
        if (data.tool_input.command) base.command = data.tool_input.command;
      }
      break;

    case 'StopFailure':
      base.error_type = data.error || null;
      base.error_details = data.error_details || null;
      break;

    case 'PreCompact':
    case 'PostCompact':
      base.trigger = data.trigger || null;
      break;

    case 'PermissionDenied':
      base.tool_denied = data.tool_name || null;
      base.reason = data.reason || null;
      break;

    case 'TaskCreated':
      base.task_id = data.task_id || null;
      base.task_subject = data.subject || null;
      break;

    case 'FileChanged':
      base.file_path = data.file_path || null;
      base.change_type = data.change_type || null;
      break;

    case 'CwdChanged':
      base.old_cwd = data.old_cwd || null;
      base.new_cwd = data.new_cwd || null;
      break;
  }

  return base;
}

// Main execution
let input = '';
process.stdin.on('data', (d: Buffer) => input += d);
process.stdin.on('end', () => {
  try {
    const data: HookInput = JSON.parse(input);
    const dir: string = path.join(process.cwd(), 'learning', 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const record: LogRecord = buildRecord(data);
    const line: string = JSON.stringify(record) + '\n';
    const dest: string = logDestination(data.hook_event_name || '');
    fs.appendFileSync(path.join(dir, dest), line);
  } catch {
    // Silently ignore parse errors to avoid breaking the hook chain
  }
});

export { buildRecord, logDestination };
