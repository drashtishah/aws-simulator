---
name: setup
description: Initialize the local workspace for a new player. Creates the learning directory, profile, journal, and feedback files. Verifies sim packages and MCP configuration. Use when user says "setup", "initialize", or on first clone.
effort: low
paths:
  - learning/**
hooks:
  PreToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "node .claude/hooks/guard-write.js --ownership .claude/skills/setup/ownership.json"
---

# setup Skill

Prepares the workspace for a new player. Run once after cloning.

## Tool Reference

| Step | Action | Tool | Target |
|------|--------|------|--------|
| 2 | Load default profile | Read | `references/default-profile.json` |
| 2 | Create profile | Write | `learning/profile.json` |
| 3 | Create journal | Write | `learning/journal.md` |
| 4 | Create feedback log | Write | `learning/feedback.md` |
| 5 | Load exam topics | Read | `.claude/skills/create-sim/references/exam-topics.md` |
| 5 | Create catalog | Write | `learning/catalog.csv` |
| 5b | Copy vault templates | Read, Write | `references/vault-templates/*` -> `learning/vault/*` |
| 6 | Load registry | Read | `sims/registry.json` |

---

## Steps

### 1. Check learning directory

If `learning/` does not exist, create it. If `learning/sessions/` does not exist, create it.

### 2. Create profile

If `learning/profile.json` does not exist, create it.

Read `references/default-profile.json` for the default structure. Replace `{today}` with the current date in YYYY-MM-DD format.

If it already exists, leave it. Do not overwrite.

### 3. Create journal

If `learning/journal.md` does not exist, create it:

```markdown
---
tags:
  - type/learning-journal
  - domain/aws-simulator
---

# Learning Journal

Progress entries are added automatically after each completed simulation.
```

### 4. Create feedback log

If `learning/feedback.md` does not exist, create it:

```markdown
---
tags:
  - type/log
  - scope/feedback
---

# Simulation Feedback

Feedback collected during play sessions via /feedback. Processed after each sim resolution.
```

### 5. Create services catalog

If `learning/catalog.csv` does not exist, generate it with a starter set of high-priority services extracted from `.claude/skills/create-sim/references/exam-topics.md`. Each row uses the merged format:

```csv
service,full_name,category,cert_relevance,knowledge_score,sims_completed,last_practiced,notes
```

All progress columns default to `0,0,,`.

If `learning/catalog.csv` already exists, leave it. Do not overwrite.

### 5b. Create learning vault

If `learning/vault/` does not exist, create the vault directory structure:

1. Create directories: `learning/vault/sessions/`, `learning/vault/concepts/`, `learning/vault/patterns/`, `learning/vault/services/`, `learning/vault/raw/`
2. Copy vault templates from `references/vault-templates/` to `learning/vault/`:
   - `references/vault-templates/index.md` -> `learning/vault/index.md`
   - `references/vault-templates/patterns/behavioral-profile.md` -> `learning/vault/patterns/behavioral-profile.md`
   - `references/vault-templates/patterns/question-quality.md` -> `learning/vault/patterns/question-quality.md`
   - `references/vault-templates/patterns/investigation-style.md` -> `learning/vault/patterns/investigation-style.md`

If `learning/vault/` already exists, leave it. Do not overwrite.

### 6. Verify sim packages

Read `sims/registry.json`. Count the entries. If the file is missing, warn the user: "No simulations found. The sims/ directory may be incomplete."

### 7. Verify MCP configuration

Check that `.mcp.json` exists and contains `aws-knowledge-mcp-server`. If missing, warn the user: "The AWS Knowledge MCP server is not configured. Some features of /create-sim will be limited."

This is not a blocker. The MCP server enriches sim creation but is not required for playing existing sims.

### 8. Welcome

Print the number of available sims and current profile state. Use flat, quiet tone:

> Everything is in order. {n} simulations are loaded. Your profile is fresh, rank Responder, nothing completed. Run /play when you are ready.

If the profile already had progress:

> Workspace verified. {n} simulations loaded. You have completed {completed} so far, currently ranked {rank_title}. Run /play to continue.

---

## Rules

1. No emojis.
2. Do not modify any existing files. Only create missing ones.
3. Do not start a simulation. Setup is setup.
