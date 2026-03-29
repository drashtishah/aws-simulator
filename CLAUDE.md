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

## Logging

All events (tool calls, session lifecycle, warnings, errors) go to one file: `learning/logs/activity.jsonl`. Both the shared hooks (terminal /play) and the web server logger write here. The `/fix` skill reads this file to diagnose issues.
