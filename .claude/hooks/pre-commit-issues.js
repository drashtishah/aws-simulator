#!/usr/bin/env node
// PreToolUse hook for Bash: reminds to check open issues before committing.

let input = '';
process.stdin.on('data', d => input += d);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const cmd = (data.tool_input && data.tool_input.command) || '';
    if (!/\bgit\s+commit\b/.test(cmd)) process.exit(0);

    process.stdout.write(`[Git Issues] Before committing, check if any open issues can be closed or referenced by this change.
Run: gh issue list --state open
Include "Closes #N" or "Ref #N" in the commit message as appropriate.
`);
  } catch {
    process.exit(0);
  }
});
