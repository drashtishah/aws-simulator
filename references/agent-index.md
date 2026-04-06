# Agent Index

Quick-reference for navigating this workspace. See `references/workspace-map.md` for full architecture.

## Skills

| Skill | Trigger | SKILL.md |
|-------|---------|----------|
| create-sim | /create-sim | `.claude/skills/create-sim/SKILL.md` |
| fight-team | /fight-team | `.claude/skills/fight-team/SKILL.md` |
| fix | /fix | `.claude/skills/fix/SKILL.md` |
| git | /git | `.claude/skills/git/SKILL.md` |
| play | /play | `.claude/skills/play/SKILL.md` |
| setup | /setup | `.claude/skills/setup/SKILL.md` |
| sim-test | /sim-test | `.claude/skills/sim-test/SKILL.md` |
| upgrade | /upgrade | `.claude/skills/upgrade/SKILL.md` |

## Hooks

| Hook File | Event | Matcher | Purpose |
|-----------|-------|---------|---------|
| `.claude/hooks/guard-write.js` | PreToolUse | Edit|Write | Block writes to protected files and directories |
| `.claude/hooks/git-discipline-reminder.js` | PreToolUse | Edit|Write | Remind about git workflow before edits |
| `.claude/hooks/pre-commit-issues.js` | PreToolUse | Bash | Require GitHub Issue before commits |
| `.claude/hooks/pre-commit-self-audit.js` | PreToolUse | Bash | Self-audit checklist before commits |
| `.claude/hooks/log-hook.js` | PostToolUse | Edit|Write|Bash|Agent | Log tool call events to activity.jsonl |
| `.claude/hooks/plan-exit-reminder.js` | PostToolUse | ExitPlanMode | Remind about next steps after plan mode |
| `.claude/hooks/log-hook.js` | Stop | (all) | Log tool call events to activity.jsonl |
| `.claude/hooks/log-hook.js` | UserPromptSubmit | (all) | Log tool call events to activity.jsonl |
| `.claude/hooks/log-hook.js` | SessionStart | (all) | Log tool call events to activity.jsonl |
| `.claude/hooks/log-hook.js` | SessionEnd | (all) | Log tool call events to activity.jsonl |
| `.claude/hooks/log-hook.js` | PostToolUseFailure | (all) | Log tool call events to activity.jsonl |
| `.claude/hooks/log-hook.js` | StopFailure | (all) | Log tool call events to activity.jsonl |
| `.claude/hooks/log-hook.js` | PreCompact | (all) | Log tool call events to activity.jsonl |
| `.claude/hooks/log-hook.js` | PostCompact | (all) | Log tool call events to activity.jsonl |
| `.claude/hooks/log-hook.js` | PermissionDenied | (all) | Log tool call events to activity.jsonl |
| `.claude/hooks/log-hook.js` | TaskCreated | (all) | Log tool call events to activity.jsonl |
| `.claude/hooks/log-hook.js` | FileChanged | (all) | Log tool call events to activity.jsonl |
| `.claude/hooks/log-hook.js` | CwdChanged | (all) | Log tool call events to activity.jsonl |

## Key References

| Document | Purpose |
|----------|---------|
| `references/workspace-map.md` | Workspace architecture |
| `references/progression.yaml` | Rank and scoring config |
| `references/testing-system.md` | Testing system reference |

## Data Files

| File | Protected? |
|------|------------|
| `references/path-registry.csv` | Yes |
| `learning/logs/activity.jsonl` | Yes |
| `package-lock.json` | Yes |
| `node_modules/` | Yes (entire directory) |
| `web/test-specs/` | Yes (entire directory) |

## Tests

| Command | Layer | Description |
|---------|-------|-------------|
| `npm test` | 1 | Deterministic unit tests |
| `npm run test:agent` | 2 | Agent browser specs |
| `npm run test:personas` | 3 | Persona integration |
| `npm run test:evals` | 4 | Eval scorecard |
