#!/usr/bin/env node
// Shared hook: logs tool calls + session events for both terminal /play and web app.
// Reads hook input from stdin, appends JSONL to learning/logs/.

const fs = require('fs');
const path = require('path');

let input = '';
process.stdin.on('data', d => input += d);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const dir = path.join(process.cwd(), 'learning', 'logs');
    fs.mkdirSync(dir, { recursive: true });

    const line = JSON.stringify({
      ts: new Date().toISOString(),
      event: data.hook_event_name,
      session_id: data.session_id,
      tool: data.tool_name || null
    }) + '\n';

    fs.appendFileSync(path.join(dir, 'activity.jsonl'), line);
  } catch {
    // Silently ignore parse errors to avoid breaking the hook chain
  }
});
