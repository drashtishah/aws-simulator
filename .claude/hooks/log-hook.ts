#!/usr/bin/env npx tsx
// Shared hook: logs tool calls + session events for both terminal /play and web app.
// Reads hook input from stdin, appends JSONL to learning/logs/raw.jsonl.
//
// PR-B (giggly-riding-comet plan): the previous activity.jsonl + system.jsonl
// split was incidental. Both files now collapse into a single raw.jsonl
// stream. Keeping a single producer means we never have to reason about
// which events landed where, and the per-event `kind` subfield (Failure
// events) preserves the information that the file split previously implied.

import { execSync } from 'node:child_process';
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
  cwd: string;
  branch: string | null;
  [key: string]: unknown;
}

const RAW_LOG_FILENAME = 'raw.jsonl';

// PR-B: unified destination. Kept as a function so the test suite can lock
// the contract that every event class lands in the same file.
function logFileName(_eventName: string): string {
  return RAW_LOG_FILENAME;
}

// Cached at module load. Both fields are best-effort: branch detection runs
// `git` once per process and falls back to null if anything goes wrong.
const PROCESS_CWD: string = process.cwd();
let cachedBranch: string | null | undefined;

function currentBranch(): string | null {
  if (cachedBranch !== undefined) return cachedBranch;
  try {
    const out: string = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: PROCESS_CWD,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      timeout: 1000
    }).trim();
    cachedBranch = out || null;
  } catch {
    cachedBranch = null;
  }
  return cachedBranch;
}

function buildRecord(data: HookInput): LogRecord {
  // PR-B: PostToolUseFailure and StopFailure collapse into a single
  // `Failure` event with a `kind` discriminator. Anything reading the
  // logs that previously branched on the original event name should now
  // filter on `event === 'Failure' && kind === '...'`.
  const eventName: string | undefined = data.hook_event_name;
  const isToolFailure: boolean = eventName === 'PostToolUseFailure';
  const isStopFailure: boolean = eventName === 'StopFailure';
  const isFailure: boolean = isToolFailure || isStopFailure;

  const base: LogRecord = {
    ts: new Date().toISOString(),
    event: isFailure ? 'Failure' : eventName,
    session_id: data.session_id,
    tool: data.tool_name || null,
    cwd: PROCESS_CWD,
    branch: currentBranch()
  };

  if (isFailure) {
    base.kind = isToolFailure ? 'tool' : 'stop';
  }

  switch (eventName) {
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
    const dest: string = logFileName(data.hook_event_name || '');
    fs.appendFileSync(path.join(dir, dest), line);
  } catch {
    // Silently ignore parse errors to avoid breaking the hook chain
  }
});

export { buildRecord, logFileName };
