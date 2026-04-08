#!/usr/bin/env npx tsx
// PostToolUse hook for ExitPlanMode: reinforces git discipline at plan approval.

process.stdout.write(`[Git Discipline] Plan approved. Before implementing:
- Create a GitHub Issue for this work (or reference an existing one).
- Follow references/architecture/core-workflow.md after each change.
- Run npm test after every commit. Rollback on failure.
- After merge, run \`npm run doctor\` to confirm 0 fails before closing the worktree.
`);
