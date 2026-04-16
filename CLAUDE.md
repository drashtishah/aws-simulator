# AWS Incident Simulator

Interactive AWS incident-response game played through Claude Code skills.

## Skills

- `/setup`: run once after cloning to create player profile in learning/
- `/play`: run a simulation; the main game loop
- `/create-sim`: generate new sim packages (for authors, not players)
- `/feedback`: log a note during play about the sim system
- `/fix`: gather feedback, create Issues for the GHA pipeline, and chain into /test

## Behavioral guidelines

All agents (local Claude Code sessions and GitHub Actions workflows) must
follow `references/guidelines/karpathy.md`: state assumptions, simplicity
first, surgical changes, goal-driven execution.

Use `rtk git fetch`, `rtk git diff`, `rtk git log`, and `rtk git status` instead of their plain git equivalents.

## Conventions

- No emojis.
- No `--` as punctuation. Use commas, periods, or colons instead.
- All file paths in markdown and JSON must be root-relative. Run `npm run extract-paths` then `npm test` to validate.
- Backticks in markdown are for file paths and code only. Never backtick-wrap YAML tags, labels, or other slash-separated values that are not filesystem paths.
- Be concise in ALL output, workspace-wide: terminal conversation, commit message bodies, PR descriptions, code comments, subagent dispatch prompts, and any authored markdown. Remove filler words, preambles, and trailing summaries. Code explanations include only what is necessary; skip restating what is visible in the diff. Exemption: reasoning steps (debugging, root-cause analysis, design trade-offs) are NOT capped; padding around them is. Research shows conciseness improves accuracy on non-reasoning tasks with negligible impact on reasoning tasks, and can reduce length 48 to 65 percent. See Issue #165 for sources.

## graphify

This project has a graphify knowledge graph at `graphify-out/`.

Rules:
- Before exploring the workspace (navigating, searching, answering questions about structure or behavior), read `graphify-out/GRAPH_REPORT.md` for community hubs and god nodes
- If `graphify-out/wiki/index.md` exists, navigate it instead of reading raw files
- After modifying files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)
