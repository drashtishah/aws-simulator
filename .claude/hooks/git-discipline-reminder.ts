#!/usr/bin/env npx tsx
// PreToolUse hook for Edit|Write: reminds Claude to follow git discipline once per session.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

interface HookInput {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  session_id?: string;
  [key: string]: unknown;
}

let input = '';
process.stdin.on('data', (d: Buffer) => input += d);
process.stdin.on('end', () => {
  try {
    const data: HookInput = JSON.parse(input);
    const sessionId: string | undefined = data.session_id;
    if (!sessionId) process.exit(0);

    const marker: string = path.join(os.tmpdir(), `claude-git-reminded-${sessionId}`);
    if (fs.existsSync(marker)) process.exit(0);

    // Create marker for this session
    fs.writeFileSync(marker, '');

    process.stdout.write(`[Git Discipline] Code changes starting. Follow the git workflow:

1. Create tasks for work items, then promote to GitHub Issues.
   See: .claude/skills/git/references/task-to-issue.md

2. After each logical change, follow the commit procedure.
   See: references/architecture/core-workflow.md
   Stage specific files, contextual commit with issue ref, include intent action line.

3. Run tests after every commit: npm test

4. If tests fail, rollback immediately (git revert), then fix forward.
   See: .claude/skills/git/references/rollback-procedure.md
`);
  } catch {
    process.exit(0);
  }
});
