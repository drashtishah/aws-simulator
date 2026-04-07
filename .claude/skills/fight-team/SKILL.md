---
name: fight-team
description: >
  Adversarial workspace review using a 3-agent debate team.
  One coordinator orchestrates two debaters (Challenger and Defender)
  who argue through a checklist of workspace quality topics across 3 rounds.
  Produces actionable findings with consensus recommendations.
  Use when user says "fight", "fight-team", "adversarial review",
  "debate review", or "workspace review".
references_system_vault: true
---

# fight-team Skill

Three-agent adversarial review driven entirely by code-health findings.
A coordinator (this session) orchestrates two debaters who argue over the
top 10 findings from `learning/logs/health-scores.jsonl` across 4 rounds,
then synthesizes survivors into actionable GitHub Issues using the
canonical issue-template.md schema.

**Roles:**
- **Coordinator** (this session): manages rounds, synthesizes report, creates tasks and issues
- **Challenger**: finds problems, complexity, gaps, risks. Critical lens.
- **Defender**: justifies existing decisions, finds strengths, argues against unnecessary changes. Pragmatic lens.

**Structure:** 4 rounds (independent positions, cross-examination, steelman swap, convergence), then synthesis and issue pipeline. The 4-round structure is mandatory; no skipping rounds.

**Inputs:** before spawning debaters, the coordinator reads the latest entry of `learning/logs/health-scores.jsonl` and selects the top 10 findings by `expected_gain_if_fixed`. If the file is empty or older than 24h, run `npm run health` first to refresh. Each finding carries `bucket`, `metric`, `file`, `line`, `current_score`, `expected_gain_if_fixed`, `description`. The debate is over those findings, not over a hand-maintained checklist.

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

## Phase 2: Round 1, Independent positions

Both debaters read the top 10 findings from `learning/logs/health-scores.jsonl`
and every cited file. They write positions in isolation, knowing they will
be cross-examined in round 2 and asked to steelman the opposing position
in round 3.

Wait for both agents to complete Round 1.

Record each agent's positions for relay in Round 2.

---

## Phase 3: Round 2, Cross-examination

Each debater reads the other's r1 positions and produces a numbered
rebuttal for **every** finding. "I agree" is forbidden. Each rebuttal must
do one of:

1. Cite a counter-example with file:line.
2. Propose a stricter test the finding would fail.
3. Explicitly write `CONCEDED` and explain why the finding survived attack.

```
SendMessage:
  to: "challenger"
  content: "Round 2: Here are the Defender's r1 positions. Produce a numbered rebuttal for every finding. 'I agree' is forbidden. Each rebuttal must (a) cite a counter-example with file:line, (b) propose a stricter test, or (c) write CONCEDED with explanation. [Defender's r1 output]"

SendMessage:
  to: "defender"
  content: "Round 2: Here are the Challenger's r1 positions. Produce a numbered rebuttal for every finding. 'I agree' is forbidden. Each rebuttal must (a) cite a counter-example with file:line, (b) propose a stricter test, or (c) write CONCEDED with explanation. Use the Anti-gaming scenario table in references/findings-debate.md as your playbook. [Challenger's r1 output]"
```

Wait for both agents to complete Round 2.

---

## Phase 4: Round 3, Steelman swap

Each debater takes the other's strongest surviving position and writes
the best possible version of it. Findings that cannot be steelmanned are
demoted to `priority:investigate` in round 4.

```
SendMessage:
  to: "challenger"
  content: "Round 3: Take the Defender's strongest surviving r2 position and write the best possible version of it. If you cannot steelman a finding, mark it priority:investigate. [Defender's r2 output]"

SendMessage:
  to: "defender"
  content: "Round 3: Take the Challenger's strongest surviving r2 position and write the best possible version of it. If you cannot steelman a finding, mark it priority:investigate. [Challenger's r2 output]"
```

Wait for both agents to complete Round 3.

---

## Phase 4b: Round 4, Convergence

Coordinator resolves. A finding becomes an Issue only if it survived
rounds 2+3 with at least one file:line citation that both debaters
acknowledge exists. Findings that survived but could not be steelmanned
are filed with label `priority:investigate` instead of `priority:high`.

Read both debaters' r2 and r3 outputs. For each of the 10 starting
findings, decide: file as priority:high, file as priority:investigate,
or drop.

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

For each confirmed task, the coordinator first composes a candidate Issue
body that follows `.claude/skills/fight-team/references/issue-template.md`
exactly. Then it runs the body through the validator BEFORE calling
`gh issue create`:

```bash
npx tsx -e "
import fs from 'fs';
import { validateFightTeamIssue } from './scripts/lib/validate-fight-team-issue';
const body = fs.readFileSync('/tmp/fight-team-issue-body.md','utf8');
const r = validateFightTeamIssue(body);
if (!r.valid) { console.error(JSON.stringify(r.errors,null,2)); process.exit(1); }
"
```

Retry policy:
- If the validator returns errors, regenerate the body addressing the
  specific errors and re-run the validator. Up to 2 retries.
- On the third failure, surface the malformed body and the validator
  errors to the user. Do NOT call `gh issue create` with a malformed
  body.

Only when the validator returns `{valid: true}` does the coordinator run:

```bash
gh issue create --title "<one-sentence finding>" \
  --label "source:fight-team-weekly,priority:high,bucket:<bucket>,metric:<metric>" \
  --body-file /tmp/fight-team-issue-body.md
```

Labels (set in the body's `## Labels` section AND on the gh issue create call):
- `source:fight-team-weekly` always
- `priority:high` if both debaters agreed by r3, else `priority:investigate`
- `bucket:<bucket>` from the health-score finding
- `metric:<metric>` from the health-score finding

### 4. Report issue numbers

List created issues with their numbers. These flow into `/fix` automatically (fix reads GitHub Issues in its gather phase).

---

## Agent Prompts

### Challenger, Round 1

```
You are the Challenger in a fierce adversarial code-health review.

You are paid to find real problems. Polite is worthless. Every finding
must cite an exact file path and line number, name the failure mode,
and propose a regression test. Vague findings are forbidden. If you
cannot point to a line, do not raise the finding.

You will be cross-examined in round 2 and asked to steelman the opposing
position in round 3. Write round 1 knowing this.

INPUTS (provided by coordinator):
- The top 10 findings from learning/logs/health-scores.jsonl, each with
  bucket, metric, file, line, current_score, expected_gain_if_fixed,
  description.
- Read .claude/skills/fight-team/references/findings-debate.md for the
  4-round structure and worked example.
- Read .claude/skills/fight-team/references/issue-template.md so your
  round 1 positions are already shaped for the eventual Issue body.

For each of the 10 findings:
1. Read the cited file at the cited line.
2. Form a position: confirm the failure mode, name a stricter test it
   would fail, propose the smallest fix.
3. Cite an absolute file:line for every claim.

OUTPUT FORMAT (per finding):

## Finding <n>: <bucket>/<metric> at <file>:<line>
Failure mode: <one sentence>
Stricter test: <one sentence describing a test the finding would fail>
Proposed fix: <one numbered step naming a path>
Evidence: <absolute file:line, max 3 citations>
```

### Defender, Round 1

```
You are the Defender in a fierce adversarial code-health review.

Your job is to kill weak findings. For every Challenger finding, attempt
one of: counter-example, stricter test, or proof the finding is gameable.
"I agree" is forbidden in round 2. You are scored on weak findings killed
and strong findings honestly conceded.

You will be cross-examined in round 2 and asked to steelman the opposing
position in round 3. Write round 1 knowing this.

INPUTS (provided by coordinator):
- The same top 10 findings from learning/logs/health-scores.jsonl that
  Challenger received.
- Read .claude/skills/fight-team/references/findings-debate.md for the
  4-round structure, the worked example, and the Anti-gaming scenario
  table you must use as a playbook.
- Read .claude/skills/fight-team/references/issue-template.md.

For each of the 10 findings:
1. Read the cited file at the cited line.
2. Form a defense: is the current state a deliberate tradeoff? Is the
   finding gameable (fixing it the obvious way will lower real quality)?
   Is there a counter-example file showing the pattern is fine?
3. If the finding is gameable, flag it for priority:investigate, not
   action.
4. Cite an absolute file:line for every claim.

OUTPUT FORMAT (per finding):

## Finding <n>: <bucket>/<metric> at <file>:<line>
Defense or concession: <one sentence>
Counter-example or gameability flag: <absolute file:line if any>
Why current state is sound (or honestly conceded): <one sentence>
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
