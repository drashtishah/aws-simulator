#!/usr/bin/env node
// PreToolUse hook for Bash: blocks commits without issue references.

let input = '';
process.stdin.on('data', d => input += d);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const cmd = (data.tool_input && data.tool_input.command) || '';
    if (!/\bgit\s+commit\b/.test(cmd)) process.exit(0);

    // Search the entire command for issue reference patterns
    const hasRef = /(?:closes|fixes|ref|part of)\s+#\d+/i.test(cmd);
    const hasExplicit = /no related issue/i.test(cmd);

    if (!hasRef && !hasExplicit) {
      process.stderr.write(
        'BLOCKED: Commit message must reference a GitHub issue.\n' +
        'Include one of: "Closes #N", "Ref #N", "Fixes #N", "Part of #N"\n' +
        'Or explicitly: "No related issue"\n' +
        'Run: gh issue list --state open\n'
      );
      process.exit(2);
    }
    process.exit(0);
  } catch {
    process.exit(0);
  }
});
