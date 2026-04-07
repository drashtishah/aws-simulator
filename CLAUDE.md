# AWS Incident Simulator

Interactive AWS incident-response game played through Claude Code skills.

## Skills

- `/setup`: run once after cloning to create player profile in learning/
- `/play`: run a simulation; the main game loop
- `/create-sim`: generate new sim packages (for authors, not players)
- `/feedback`: log a note during play about the sim system
- `/fix`: analyze feedback, activity logs, and code health, then apply improvements to skills
- `/git`: contextual commits, rollback, GitHub Issues, and git history recall

## Conventions

- No emojis
- No `--` as punctuation (use commas, periods, or colons instead)
- All file paths in markdown and JSON must be root-relative (e.g., `.claude/skills/create-sim/references/exam-topics.md`, not references/exam-topics.md). Run `npm run extract-paths` then `npm test` to validate.
- Backticks in markdown are for file paths and code only. Do not backtick-wrap YAML tags, labels, or other slash-separated values that are not filesystem paths.
- Workspace architecture in references/architecture/workspace-map.md
- Agent navigation index in `references/registries/agent-index.md`, tool registry in `references/registries/tool-registry.md`

## Code Health

Run `npm run health` before and after refactors. See `references/config/code-health.md` for details.

## Logging

All events (tool calls, session lifecycle, warnings, errors) go to one file: `learning/logs/activity.jsonl`. Both the shared hooks (terminal /play) and the web server logger write here. The `/fix` skill reads this file to diagnose issues.

## Git Discipline

All code changes (except during /play sessions) follow the canonical workflow in `references/architecture/core-workflow.md`. No squash merges, every commit independently revertable via `git revert <sha>`.

For standalone git operations (rollback, recall, issue triage): use /git
