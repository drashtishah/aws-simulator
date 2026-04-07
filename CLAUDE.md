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

All events (tool calls, session lifecycle, warnings, errors) go to one file: `learning/logs/raw.jsonl`. Both the shared hooks (terminal /play) and the web server logger write here. The `/fix` skill reads this file to diagnose issues. (PR-B unified the previous `activity.jsonl` + `system.jsonl` split into a single stream; the legacy filenames now alias to `raw.jsonl` via `web/lib/paths.ts`.)

Agents record findings, negative results, workarounds, and decisions to a parallel stream `learning/logs/notes.jsonl` via the `scripts/note.ts` CLI. Schema: `{ts, kind, topic, body}`. Kinds: `finding`, `negative_result`, `workaround`, `decision`, `none`. The `none` kind is the explicit "nothing worth recording" escape hatch and requires `--reason`. A Stop hook enforces that every session records at least one note before exiting.

## System vault

Long-term system memory lives in `learning/system-vault/` (per-user, gitignored). Query it via `system-vault-query` when you need prior findings, decisions, or workarounds; the daily-compile-and-rotate cron compiles `raw.jsonl` into topic notes and the dream-check hook periodically consolidates them. Budgets are enforced by `web/lib/system-vault.ts`.

## Git Discipline

All code changes (except during /play sessions) follow the canonical workflow in `references/architecture/core-workflow.md`. No squash merges, every commit independently revertable via `git revert <sha>`.

For standalone git operations (rollback, recall, issue triage): use /git
