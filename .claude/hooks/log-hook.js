#!/usr/bin/env node
// Shared hook: logs tool calls + session events for both terminal /play and web app.
// Reads hook input from stdin, appends JSONL to learning/logs/.

const fs = require('fs');
const path = require('path');

function buildRecord(data) {
  const base = {
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

if (require.main === module) {
  let input = '';
  process.stdin.on('data', d => input += d);
  process.stdin.on('end', () => {
    try {
      const data = JSON.parse(input);
      const dir = path.join(process.cwd(), 'learning', 'logs');
      fs.mkdirSync(dir, { recursive: true });
      const line = JSON.stringify(buildRecord(data)) + '\n';
      fs.appendFileSync(path.join(dir, 'activity.jsonl'), line);
    } catch {
      // Silently ignore parse errors to avoid breaking the hook chain
    }
  });
}

module.exports = { buildRecord };
