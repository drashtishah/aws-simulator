# Workspace Context: aws-simulator

## What This Project Is
Interactive AWS incident-response training game played through Claude Code skills.

## Infrastructure In Use

### Skills (5)
- play: Main game loop with narrator + console agents, coaching feedback
- create-sim: Generates sim packages using web research + AWS MCP
- setup: Initializes player profile and workspace
- fix: Analyzes feedback + activity logs, applies skill improvements
- test: CLI for deterministic tests, agent browser specs, persona tests

### Hooks (2)
- guard-write.js: PreToolUse Write hook. Skill ownership enforcement, protected paths (path-registry.csv, activity.jsonl, scripts/, node_modules/, web/test-specs/)
- log-hook.js: PostToolUse, SessionStart/End, PreCompact, PostCompact, UserPromptSubmit, PostToolUseFailure. Appends JSONL to learning/logs/activity.jsonl

### MCP Servers (2)
- aws-knowledge-mcp-server (HTTP): AWS API schemas, error codes, agent SOPs
- chrome-devtools (npx): Browser automation for agent testing

### Plugins
- superpowers, playground, cli-anything
- CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1

### Web App
- Express server (web/server.js) + Claude subprocess
- Snowy mountain theme, skill polygon dashboard
- prompt-builder.js constructs game prompts from sim manifests + themes

### Testing (3 layers)
- Layer 1: node --test (unit tests for server, hooks, code health)
- Layer 2: Agent browser specs (YAML specs + Chrome DevTools MCP)
- Layer 3: Agent personas (JSON profiles: impatient-beginner, hostile-user, screen-reader-user, power-user, mobile-first-user)

### Key Tooling
- npm run health: Code health metrics (modularity, complexity, size balance, dependency depth)
- npm test: Path extraction + test CLI
- npm run feedback:personas: Run persona-based testing

### Data Patterns
- JSONL for append-only logs (activity.jsonl, health-scores.jsonl)
- JSON for state (profile.json, sessions/*.json, registry.json)
- CSV for catalog (catalog.csv)
- YAML for progression rules (progression.yaml)
- Markdown for narrative content (journal.md, themes/*.md, agent-prompts.md)
