---
name: fight-team
description: >
  Adversarial workspace review using a 3-agent debate team.
  One coordinator orchestrates two debaters (Challenger and Defender)
  who argue through a checklist of workspace quality topics across 3 rounds.
  Produces actionable findings with consensus recommendations.
  Use when user says "fight", "fight-team", "adversarial review",
  "debate review", or "workspace review".
---

# fight-team Skill

Three-agent adversarial review of the entire workspace. A coordinator (this session) orchestrates two debaters who argue through a 13-topic checklist across 3 rounds, then synthesizes findings into actionable GitHub Issues.

**Roles:**
- **Coordinator** (this session): manages rounds, synthesizes report, creates tasks and issues
- **Challenger**: finds problems, complexity, gaps, risks. Critical lens.
- **Defender**: justifies existing decisions, finds strengths, argues against unnecessary changes. Pragmatic lens.

**Structure:** 3 rounds (independent analysis, rebuttal, convergence), then synthesis and issue pipeline.

---

## Phase 1: Setup

### 1. Create the team

```
TeamCreate: name "fight-team"
```

### 2. Spawn both agents

Spawn two agents with `model: "sonnet"` and `team_name: "fight-team"`. Use the prompts in the Agent Prompts section below.

```
Agent:
  name: "challenger"
  model: sonnet
  team_name: fight-team
  prompt: [Challenger Round 1 prompt]

Agent:
  name: "defender"
  model: sonnet
  team_name: fight-team
  prompt: [Defender Round 1 prompt]
```

Both agents run in parallel for Round 1.

---

## Phase 2: Round 1, Independent Analysis

Both agents independently explore the workspace and form positions on each checklist topic.

Wait for both agents to complete Round 1 (they will return their initial positions).

Record each agent's positions for relay in Round 2.

---

## Phase 3: Round 2, Rebuttal

Send each agent the other's Round 1 positions via SendMessage:

```
SendMessage:
  to: "challenger"
  content: "Round 2: Here are the Defender's positions. Argue against them, citing specific files and lines. [Defender's Round 1 output]"

SendMessage:
  to: "defender"
  content: "Round 2: Here are the Challenger's positions. Argue against them, citing specific files and lines. [Challenger's Round 1 output]"
```

Wait for both agents to complete Round 2.

---

## Phase 4: Round 3, Convergence

Send each agent the other's Round 2 rebuttals and instruct them to find common ground:

```
SendMessage:
  to: "challenger"
  content: "Round 3: Here are the Defender's rebuttals. Find common ground where possible. For remaining disagreements, state your final position with evidence. [Defender's Round 2 output]"

SendMessage:
  to: "defender"
  content: "Round 3: Here are the Challenger's rebuttals. Find common ground where possible. For remaining disagreements, state your final position with evidence. [Challenger's Round 2 output]"
```

Wait for both agents to complete Round 3.

---

## Phase 5: Synthesis

Read both agents' Round 3 final positions. Produce a structured report:

### Report Format

```
=== Fight-Team Workspace Review ===

--- Agreed (both agents converged) ---

[Topic N]: [Finding title]
  Files: [specific file paths and line numbers]
  Recommendation: [what to do]
  Priority: high / medium / low

--- Resolved Disputes (coordinator decided) ---

[Topic N]: [Finding title]
  Challenger argued: [summary]
  Defender argued: [summary]
  Resolution: [coordinator's decision and reasoning]
  Files: [specific file paths]
  Recommendation: [what to do]
  Priority: high / medium / low

--- Unresolved (flagged for human review) ---

[Topic N]: [Finding title]
  Challenger: [final position]
  Defender: [final position]
  Why unresolved: [what makes this genuinely ambiguous]
```

Present the full report to the user.

---

## Phase 6: Issue Pipeline

Follow `.claude/skills/git/references/task-to-issue.md` for the task-to-issue workflow.

### 1. Create tasks

For each actionable finding (from Agreed and Resolved Disputes sections), create a task:

```
TaskCreate:
  subject: "[Topic N] [imperative description]"
  description: "Source: fight-team review. Files: [paths]. Recommendation: [action]. Priority: [level]."
```

Skip Unresolved items (these need human judgment first).

### 2. Present to user

Show the full task list. Ask the user which tasks to promote to GitHub Issues. The user may drop, edit, or confirm items.

### 3. Promote to issues

For each confirmed task:

```bash
gh issue create --title "<type>(<scope>): <subject>" \
  --label "<bug|enhancement|chore>" \
  --body "<finding details, file refs, recommendation>"
```

Labels:
- `bug`: broken things, failures, incorrect behavior
- `enhancement`: improvements, new capabilities
- `chore`: cleanup, documentation fixes, consistency

### 4. Report issue numbers

List created issues with their numbers. These flow into `/fix` automatically (fix reads GitHub Issues in its gather phase).

---

## Agent Prompts

### Challenger, Round 1

```
You are the Challenger in an adversarial workspace review. Your job is to find
problems, complexity, gaps, and risks. Be thorough and critical.

WORKSPACE CONTEXT:
- Read CLAUDE.md for project overview and conventions
- Read references/workspace-map.md for component architecture and data flow
- List references/ folder for available documentation
- Run gh issue list --state open to see current issues
- Run npm run health to see code health scores

YOUR CHECKLIST:
Read .claude/skills/fight-team/references/default-checklist.md for the 13 topics.

For each topic:
1. Read the files listed in "Look at"
2. Form a position: what is wrong, missing, overly complex, or risky?
3. Cite specific file paths and line numbers
4. Rate severity: high (broken/dangerous), medium (suboptimal), low (nitpick)

START by reading references/workspace-map.md and CLAUDE.md, then work through
each checklist topic systematically. Explore deeply: read actual files, grep for
patterns, check edge cases.

OUTPUT FORMAT:
For each of the 13 topics, provide:

## Topic N: [name]
Position: [your critical finding]
Evidence: [file paths, line numbers, specific observations]
Severity: high / medium / low

If a topic has no issues, say so briefly and move on. Do not pad findings.
```

### Defender, Round 1

```
You are the Defender in an adversarial workspace review. Your job is to justify
existing decisions, find strengths, and argue against unnecessary changes.
Be pragmatic and evidence-based.

WORKSPACE CONTEXT:
- Read CLAUDE.md for project overview and conventions
- Read references/workspace-map.md for component architecture and data flow
- List references/ folder for available documentation
- Run gh issue list --state open to see current issues
- Run npm run health to see code health scores

YOUR CHECKLIST:
Read .claude/skills/fight-team/references/default-checklist.md for the 13 topics.

For each topic:
1. Read the files listed in "Look at"
2. Form a position: what is working well? What design decisions are sound?
3. Where things look imperfect, argue why the current approach is pragmatic
4. Cite specific file paths and line numbers

START by reading references/workspace-map.md and CLAUDE.md, then work through
each checklist topic systematically. Explore deeply: read actual files, grep for
patterns, check how things actually work in practice.

OUTPUT FORMAT:
For each of the 13 topics, provide:

## Topic N: [name]
Position: [your defense or acknowledgment]
Evidence: [file paths, line numbers, specific observations]
Strength: strong (well-designed) / adequate (pragmatic tradeoff) / weak (valid concern)

If a topic has genuine problems you cannot defend, acknowledge them honestly.
Do not defend the indefensible.
```

---

## Rules

1. No emojis.
2. Debaters use read-only tools: Read, Glob, Grep, Bash (for `gh issue list`, `npm run health`). No edits.
3. Coordinator (this session) is the only one that creates tasks and issues.
4. Use sonnet model for both debaters.
5. All file paths in the report must be root-relative.
6. The fight-team skill does not write workspace files. Output is tasks and GitHub Issues only.
7. If either agent fails to spawn or crashes mid-round, report the failure and continue with the surviving agent's positions. Note the gap in the synthesis report.
8. Present the full report to the user before creating any tasks. User controls what becomes an issue.
