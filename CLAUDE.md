# AWS Incident Simulator

Interactive AWS incident-response game played through Claude Code skills.

## Skills

- `/setup`: run once after cloning to create player profile in learning/
- `/play`: run a simulation; the main game loop
- `/create-sim`: generate new sim packages (for authors, not players)
- `/feedback`: log a note during play about the sim system
- `/fix`: gather feedback, create Issues for the GHA pipeline, and chain into /test

## Where things are

- Architecture, components, shared data files, scheduled jobs: `references/architecture/workspace-map.md`
- Commit, PR, test, revert, cleanup, Issue-closure workflow: `references/architecture/core-workflow.md`
- Test layers, test CLI, browser tests: `references/architecture/testing-system.md`
- Code health metrics, buckets, healthignore: `references/config/code-health.md`
- Agent navigation index and tool registry: `references/registries/agent-index.md`, `references/registries/tool-registry.md`
- GHA pipeline (planner/critic/implementer/verifier): `references/architecture/gha-pipeline.md`
- Pipeline prompt files and label routing: `references/pipeline/`
- MCP servers (AWS Knowledge, Chrome DevTools): `.mcp.json`, `references/registries/tool-registry.md`
- Logs (`raw.jsonl`) and shared git-tracked `learning/system-vault/` (problems, solutions, playbooks, patterns), written by the reflector pipeline stage and enforced by `scripts/vault-lint.ts`: `references/architecture/workspace-map.md` Shared Data Files

## Behavioral guidelines

All agents (local Claude Code sessions and GitHub Actions workflows) must
follow `references/guidelines/karpathy.md`: state assumptions, simplicity
first, surgical changes, goal-driven execution.

## Conventions

- No emojis.
- No `--` as punctuation. Use commas, periods, or colons instead.
- All file paths in markdown and JSON must be root-relative. Run `npm run extract-paths` then `npm test` to validate.
- Backticks in markdown are for file paths and code only. Never backtick-wrap YAML tags, labels, or other slash-separated values that are not filesystem paths.
- Be concise in ALL output, workspace-wide: terminal conversation, commit message bodies, PR descriptions, code comments, subagent dispatch prompts, and any authored markdown. Remove filler words, preambles, and trailing summaries. Code explanations include only what is necessary; skip restating what is visible in the diff. Exemption: reasoning steps (debugging, root-cause analysis, design trade-offs) are NOT capped; padding around them is. Research shows conciseness improves accuracy on non-reasoning tasks with negligible impact on reasoning tasks, and can reduce length 48 to 65 percent. See Issue #165 for sources.
