#!/usr/bin/env npx tsx
// PreToolUse hook for Bash: asks the agent to self-audit before committing.

interface SelfAuditInput {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

let auditInput = '';
process.stdin.on('data', (d: Buffer) => auditInput += d);
process.stdin.on('end', () => {
  try {
    const data: SelfAuditInput = JSON.parse(auditInput);
    const cmd: string = (data.tool_input && (data.tool_input.command as string)) || '';
    if (!/\bgit\s+commit\b/.test(cmd)) process.exit(0);

    process.stdout.write(`[Self-Audit] Before committing, pause and ask yourself:

1. Did I do anything questionable? (skipped a step, made an assumption, changed something outside scope)
2. Did I follow the task-to-issue workflow? (tasks created, promoted to issues, referenced in commit)
3. Did I run tests after my changes?
4. Are there files I changed that I should not have?

If the answer to #1 is yes, tell the user before committing.

You MUST answer each question above in your response before committing. This is not optional.
`);
  } catch {
    process.exit(0);
  }
});
