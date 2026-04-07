---
name: git
description: >
  Git workflow orchestrator for contextual commits, rollback, and GitHub Issues.
  Use when user says /git, or for standalone git operations like rollback, recall,
  issue triage, or reviewing commit history. Other skills reference this skill's
  procedures directly via shared reference docs.
effort: medium
paths:
  - .claude/skills/git/**
hooks:
  PreToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "npx tsx .claude/hooks/guard-write.ts --ownership .claude/skills/git/ownership.json"
---

# git Skill

Standalone git workflow orchestrator. For the shared commit procedure used by all skills, see `references/architecture/core-workflow.md`.

---

## Modes

Determine which mode to use from the user's input or arguments.

### Default: /git (commit)

Follow `references/architecture/core-workflow.md` end-to-end.

### /git rollback

Follow `.claude/skills/git/references/rollback-procedure.md` end-to-end.

### /git issues

Three sub-modes based on context:

**List** (default, no arguments):

    gh issue list --state open

**Create** (user provides a description):
Create a task and promote to a GitHub Issue per `.claude/skills/git/references/task-to-issue.md`.

**Plan** (user provides a plan file path):
Read the plan, create a task per plan step, then promote to issues per `.claude/skills/git/references/task-to-issue.md`.

**Promote** (user says "promote tasks" or "tasks to issues"):
Promote any pending tasks that don't yet have an issue number per `.claude/skills/git/references/task-to-issue.md` Stage 2.

### /git recall <topic>

Query git history for contextual knowledge:

    git log --all --grep="<topic>" --format="%h %s%n%b" | head -100

Present relevant commits grouped by action line type (intent, decision, rejected, learned). Summarize what the history says about the topic.

---

## Rules

1. No emojis.
2. Never use `git add -A` or `git add .`. Always stage specific files.
3. Never force-push or delete commits. Use `git revert` to undo.
4. Never skip tests after a commit.
5. Do not push automatically. Let the user decide.
6. All commit messages follow `.claude/skills/git/references/contextual-commits-spec.md`.
