#!/usr/bin/env npx tsx
// PreToolUse hook for Bash: blocks commits without issue references.

interface HookInput {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

let hookInput = '';
process.stdin.on('data', (d: Buffer) => hookInput += d);
process.stdin.on('end', () => {
  try {
    const data: HookInput = JSON.parse(hookInput);
    const cmd: string = (data.tool_input && (data.tool_input.command as string)) || '';
    if (!/\bgit\s+commit\b/.test(cmd)) process.exit(0);

    // Search the entire command for issue reference patterns
    const hasRef: boolean = /(?:closes|fixes|ref|part of)\s+#\d+/i.test(cmd);
    const hasExplicit: boolean = /no related issue/i.test(cmd);

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
