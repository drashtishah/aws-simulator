# AWS Incident Simulator

Interactive AWS incident-response game played through Claude Code skills.

## Skills

- `/setup`: run once after cloning to create player profile in learning/
- `/play`: run a simulation; the main game loop
- `/create-sim`: generate new sim packages (for authors, not players)
- `/feedback`: log a note during play about the sim system
- `/fix`: apply accumulated feedback to skills

## Conventions

- No emojis
- No `--` as punctuation (use commas, periods, or colons instead)
- All file paths in markdown and JSON must be root-relative (e.g., `.claude/skills/create-sim/references/exam-topics.md`, not references/exam-topics.md). Run `npm run extract-paths` then `npm test` to validate.
- Backticks in markdown are for file paths and code only. Do not backtick-wrap YAML tags, labels, or other slash-separated values that are not filesystem paths.
- Workspace architecture in references/workspace-map.md

## Permissions and Hooks (.claude/settings.local.json)

Ships with the repo so players get a zero-config experience on clone.

**Allowed tools and why:**

| Tool | Used by | Why |
|------|---------|-----|
| Read | all skills | Read sim packages, player profile, catalogs, references |
| Write | setup, play, create-sim, fix | Create/update player data, sim packages, skill files |
| Edit | fix | Patch skill files when applying feedback |
| Glob | play, create-sim | Find sim packages, artifact files, theme files |
| Grep | fix | Search skill files and logs for patterns |
| Bash | play, create-sim | npm commands (web app), git commands (commit new sims) |
| WebSearch | create-sim | Research realistic AWS incident patterns |
| WebFetch | create-sim | Fetch AWS documentation pages |
| Agent | create-sim | Parallel research across multiple AWS services |
| mcp__aws-knowledge-mcp-server | create-sim | AWS documentation search, SOPs, regional availability |

**Hooks:**

| Hook | Script | Purpose |
|------|--------|---------|
| PostToolUse (*) | log-hook.js | Logs every tool call to learning/logs/activity.jsonl |
| Stop | log-hook.js | Logs session end to learning/logs/activity.jsonl |

## Logging

All events (tool calls, session lifecycle, warnings, errors) go to one file: `learning/logs/activity.jsonl`. Both the shared hooks (terminal /play) and the web server logger write here. The `/fix` skill reads this file to diagnose issues.
