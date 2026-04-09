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

1. Create a GitHub Issue before any code change (§1).
   See: references/architecture/core-workflow.md

2. After each logical change, follow the commit procedure (§5).
   Stage specific files, contextual commit with Ref #N or Closes #N, include intent action line.

3. Run the per-commit targeted tests after every commit (§6): npx tsx scripts/sim-test.ts run --changed --json

4. If tests fail, rollback immediately via git revert then fix forward (§8).
`);
  } catch {
    process.exit(0);
  }
});
