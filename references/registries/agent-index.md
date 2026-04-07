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
| `.claude/hooks/guard-write.ts` | PreToolUse | Edit|Write | Block writes to protected files and directories |
| `.claude/hooks/git-discipline-reminder.ts` | PreToolUse | Edit|Write | Remind about git workflow before edits |
| `.claude/hooks/pre-commit-issues.ts` | PreToolUse | Bash | Require GitHub Issue before commits |
| `.claude/hooks/pre-commit-self-audit.ts` | PreToolUse | Bash | Self-audit checklist before commits |
| `.claude/hooks/log-hook.ts` | PostToolUse | Edit|Write|Bash|Agent | Log tool call events to activity.jsonl |
| `.claude/hooks/plan-exit-reminder.ts` | PostToolUse | ExitPlanMode | Remind about next steps after plan mode |
| `.claude/hooks/log-hook.ts` | Stop | (all) | Log tool call events to activity.jsonl |
| `.claude/hooks/log-hook.ts` | UserPromptSubmit | (all) | Log tool call events to activity.jsonl |
| `.claude/hooks/log-hook.ts` | SessionStart | (all) | Log tool call events to activity.jsonl |
| `.claude/hooks/log-hook.ts` | SessionEnd | (all) | Log tool call events to activity.jsonl |
| `.claude/hooks/log-hook.ts` | PostToolUseFailure | (all) | Log tool call events to activity.jsonl |
| `.claude/hooks/log-hook.ts` | StopFailure | (all) | Log tool call events to activity.jsonl |
| `.claude/hooks/log-hook.ts` | PreCompact | (all) | Log tool call events to activity.jsonl |
| `.claude/hooks/log-hook.ts` | PostCompact | (all) | Log tool call events to activity.jsonl |
| `.claude/hooks/log-hook.ts` | PermissionDenied | (all) | Log tool call events to activity.jsonl |
| `.claude/hooks/log-hook.ts` | TaskCreated | (all) | Log tool call events to activity.jsonl |
| `.claude/hooks/log-hook.ts` | FileChanged | (all) | Log tool call events to activity.jsonl |
| `.claude/hooks/log-hook.ts` | CwdChanged | (all) | Log tool call events to activity.jsonl |

## Key References

| Document | Purpose |
|----------|---------|
| `references/workspace-map.md` | Workspace architecture |
| `references/progression.yaml` | Rank and scoring config |
| `references/testing-system.md` | Testing system reference |

## Data Files

| File | Protected? |
|------|------------|

## Tests

| Command | Layer | Description |
|---------|-------|-------------|
| `npm test` | 1 | Deterministic unit tests |
| `npm run test:agent` | 2 | Agent browser specs |
| `npm run test:personas` | 3 | Persona integration |
| `npm run test:evals` | 4 | Eval scorecard |
