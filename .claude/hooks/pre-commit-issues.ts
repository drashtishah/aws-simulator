#!/usr/bin/env npx tsx
// PreToolUse hook for Bash: blocks commits without issue references.

export {};

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
    const segments: string[] = cmd.split(/&&|\|\||;|\|/);
    const isCommitInvocation: boolean = segments.some(s => /^\s*git\s+commit\b/.test(s));
    if (!isCommitInvocation) process.exit(0);

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

    // PR-C invariant 6: refuse commits that delete learning/logs/health-scores.jsonl.
    // The file holds monotonic per-bucket floor history; deleting it would
    // wipe the anti-gaming floor invariant. learning/ is currently gitignored,
    // so this is a forward-looking guard for any future un-ignoring.
    // Match a real `git rm` invocation (not a string inside a -m commit body).
    // We split on shell separators and look for a token-led command.
    const hasDeleteCmd: boolean = segments.some(s =>
      /^\s*git\s+rm\b/.test(s) && /learning\/logs\/health-scores\.jsonl/.test(s)
    );
    if (hasDeleteCmd) {
      process.stderr.write(
        'BLOCKED: refuse to delete learning/logs/health-scores.jsonl\n' +
        '(holds monotonic per-bucket floor history; PR-C invariant 6).\n' +
        'To reset floors, run: npm run health -- --rebase-floors\n'
      );
      process.exit(2);
    }
    process.exit(0);
  } catch {
    process.exit(0);
  }
});
