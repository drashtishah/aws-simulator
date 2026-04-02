#!/usr/bin/env node
// PreToolUse hook for Edit|Write: reminds Claude to follow git discipline once per session.

const fs = require('fs');
const path = require('path');
const os = require('os');

let input = '';
process.stdin.on('data', d => input += d);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const sessionId = data.session_id;
    if (!sessionId) process.exit(0);

    const marker = path.join(os.tmpdir(), `claude-git-reminded-${sessionId}`);
    if (fs.existsSync(marker)) process.exit(0);

    // Create marker for this session
    fs.writeFileSync(marker, '');

    process.stdout.write(`[Git Discipline] Code changes starting. Follow the git workflow:

1. Create tasks for work items, then promote to GitHub Issues.
   See: .claude/skills/git/references/task-to-issue.md

2. After each logical change, follow the commit procedure.
   See: .claude/skills/git/references/commit-procedure.md
   Stage specific files, contextual commit with issue ref, include intent action line.

3. Run tests after every commit: npm test

4. If tests fail, rollback immediately (git revert), then fix forward.
   See: .claude/skills/git/references/rollback-procedure.md
`);
  } catch {
    process.exit(0);
  }
});
