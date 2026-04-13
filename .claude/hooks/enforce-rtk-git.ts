#!/usr/bin/env npx tsx
// PreToolUse hook for Bash: blocks plain git fetch/diff/log/status.
// These commands must use `rtk git` instead.

export {};

interface HookInput {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

const RTK_SUBCOMMANDS = ['fetch', 'diff', 'log', 'status'];

let hookInput = '';
process.stdin.on('data', (d: Buffer) => hookInput += d);
process.stdin.on('end', () => {
  try {
    const data: HookInput = JSON.parse(hookInput);
    const cmd: string = (data.tool_input && (data.tool_input.command as string)) || '';
    const segments: string[] = cmd.split(/&&|\|\||;|\|/);

    for (const seg of segments) {
      const trimmed = seg.trim();
      for (const sub of RTK_SUBCOMMANDS) {
        // Match plain `git <sub>` but not `rtk git <sub>`
        const plainGit = new RegExp(`^git\\s+${sub}\\b`);
        const rtkGit = new RegExp(`rtk\\s+git\\s+${sub}\\b`);
        if (plainGit.test(trimmed) && !rtkGit.test(trimmed)) {
          process.stderr.write(
            `BLOCKED: use \`rtk git ${sub}\` instead of \`git ${sub}\`.\n` +
            `CLAUDE.md requires rtk git for fetch, diff, log, and status.\n`
          );
          process.exit(2);
        }
      }
    }
    process.exit(0);
  } catch {
    process.exit(0);
  }
});
