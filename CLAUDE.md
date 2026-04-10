# AWS Incident Simulator

Interactive AWS incident-response game played through Claude Code skills.

## Skills

- `/setup`: run once after cloning to create player profile in learning/
- `/play`: run a simulation; the main game loop
- `/create-sim`: generate new sim packages (for authors, not players)
- `/feedback`: log a note during play about the sim system
- `/fix`: analyze feedback, activity logs, and code health, then apply improvements to skills

## Where things are

- Architecture, components, shared data files, scheduled jobs: `references/architecture/workspace-map.md`
- Commit, PR, test, revert, cleanup, Issue-closure workflow: `references/architecture/core-workflow.md`
- Test layers, sim-test CLI, browser tests, persona tests: `references/architecture/testing-system.md`
- Code health metrics, buckets, healthignore: `references/config/code-health.md`
- Agent navigation index and tool registry: `references/registries/agent-index.md`, `references/registries/tool-registry.md`
- Notes CLI and `notes.jsonl` schema: `scripts/note.ts` source comments and `references/architecture/core-workflow.md` §6b
- Logs (`raw.jsonl`, `notes.jsonl`, `learning/system-vault/`): `references/architecture/workspace-map.md` Shared Data Files

## Behavioral guidelines

All agents (local Claude Code sessions and GitHub Actions workflows) must
follow `references/guidelines/karpathy.md`: state assumptions, simplicity
first, surgical changes, goal-driven execution.

## Conventions

- No emojis.
- No `--` as punctuation. Use commas, periods, or colons instead.
- All file paths in markdown and JSON must be root-relative. Run `npm run extract-paths` then `npm test` to validate.
- Backticks in markdown are for file paths and code only. Never backtick-wrap YAML tags, labels, or other slash-separated values that are not filesystem paths.
