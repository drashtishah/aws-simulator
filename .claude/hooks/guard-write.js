#!/usr/bin/env node
// PreToolUse guard: blocks Write/Edit to production code and node_modules.
// Allows writes anywhere else in the project and to Claude Code paths.

const path = require('path');
const os = require('os');

const ROOT = process.cwd();
const HOME_CLAUDE = path.join(os.homedir(), '.claude');

const BLOCKED_PREFIXES = [
  path.join(ROOT, 'node_modules'),
  path.join(ROOT, 'web')
];

const SAFE_PREFIXES = [
  ROOT,
  HOME_CLAUDE,
  '/tmp/aws-sim-'
];

let input = '';
process.stdin.on('data', d => input += d);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const filePath = data.tool_input && data.tool_input.file_path;
    if (!filePath) process.exit(0);

    const resolved = path.resolve(ROOT, filePath);

    // Block writes to production code and dependencies
    const blocked = BLOCKED_PREFIXES.some(p => resolved.startsWith(p));
    if (blocked) {
      process.stderr.write(
        'BLOCKED: Write to ' + resolved + ' is not allowed. ' +
        'web/ and node_modules/ are protected from modification during play.'
      );
      process.exit(2);
    }

    // Allow writes within the project, ~/.claude/, and /tmp/aws-sim-*
    const safe = SAFE_PREFIXES.some(p => resolved.startsWith(p));
    if (!safe) {
      process.stderr.write(
        'BLOCKED: Write to ' + resolved + ' is outside the project.'
      );
      process.exit(2);
    }

    process.exit(0);
  } catch {
    process.exit(0); // fail-open on parse errors
  }
});
