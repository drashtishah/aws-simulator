# Tool Registry

Available tools by execution context.

## Web App (Agent SDK via claude-process.js)

The web app spawns Claude via `@anthropic-ai/claude-agent-sdk` `query()` with a restricted tool set.

| Tool | Available | Notes |
|------|-----------|-------|
| Read | yes | File reads, images, PDFs |
| Write | yes | File creation/overwrite |
| Edit | NO | Not in allowedTools |
| Glob | NO | Not in allowedTools |
| Grep | NO | Not in allowedTools |
| Bash | NO | Not in allowedTools |
| Agent | NO | Not in allowedTools |
| WebSearch | NO | Not in allowedTools |
| WebFetch | NO | Not in allowedTools |
| MCP tools | NO | Not in allowedTools |

Enforcement: `web/lib/claude-process.ts` lines 195, 280, 311.
Test: `web/test/permission-contracts.test.ts`.

## Terminal (Claude Code via /play skill)

The terminal session has full tool access controlled by `.claude/settings.local.json`.

| Tool | Available | Notes |
|------|-----------|-------|
| Read | yes | Preferred for all file reads |
| Write | yes | For creating/overwriting files |
| Edit | yes | For partial modifications (guarded by `guard-write.js`) |
| Glob | yes | For file pattern matching |
| Grep | yes | For content search |
| Bash | yes | For shell commands (guarded by pre-commit hooks) |
| Agent | yes | For subagent spawning |
| WebSearch | yes | For web search |
| WebFetch | yes | For URL fetching |
| MCP aws___ | available but DISABLED during /play | /create-sim and GHA pipeline (Planner, Critic) on sim-content issues |
| MCP chrome-devtools | available | Browser testing, GHA pipeline (Implementer, Verifier) on ui issues |

## Agent SDK Tool Names

The Agent SDK uses the same short tool names as Claude Code:
Read, Write, Edit, Glob, Grep, Bash, Agent, WebSearch, WebFetch

These map to the Claude Code tool names in the system prompt.
The `allowedTools` parameter accepts these short names.
