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
  content: "Round 2: Here are the Defender's r1 positions. Produce a numbered rebuttal for every finding. 'I agree' is forbidden. Each rebuttal must (a) cite a counter-example with file:line, (b) propose a stricter test, or (c) write CONCEDED with explanation. Also: during this round, if any Defender position surprises you, changes your mind on a finding you were certain about, or reveals evidence you had missed, write a note IN THE MOMENT via `tsx scripts/note.ts --kind finding --topic fight-team-r2-<slug> --body \"...\"`. Bodies are uncapped. Per rule 13. [Defender's r1 output]"

SendMessage:
  to: "defender"
  content: "Round 2: Here are the Challenger's r1 positions. Produce a numbered rebuttal for every finding. 'I agree' is forbidden. Each rebuttal must (a) cite a counter-example with file:line, (b) propose a stricter test, or (c) write CONCEDED with explanation. Use the Anti-gaming scenario table in references/findings-debate.md as your playbook. Also: during this round, if any Challenger position surprises you, changes your mind on a finding you were certain about, or reveals evidence you had missed, write a note IN THE MOMENT via `tsx scripts/note.ts --kind finding --topic fight-team-r2-<slug> --body \"...\"`. Bodies are uncapped. Per rule 13. [Challenger's r1 output]"
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
  content: "Round 3: Take the Defender's strongest surviving r2 position and write the best possible version of it. If you cannot steelman a finding, mark it priority:investigate. Also: if steelmanning reveals the opposing position is stronger than you expected, or if your own r2 rebuttal now looks weaker, write a note via `tsx scripts/note.ts --kind decision --topic fight-team-steelman-<slug> --body \"...\"`. Steelman shifts are exactly the cross-session memory future fight-team runs benefit from. Per rule 13. [Defender's r2 output]"

SendMessage:
  to: "defender"
  content: "Round 3: Take the Challenger's strongest surviving r2 position and write the best possible version of it. If you cannot steelman a finding, mark it priority:investigate. Also: if steelmanning reveals the opposing position is stronger than you expected, or if your own r2 rebuttal now looks weaker, write a note via `tsx scripts/note.ts --kind decision --topic fight-team-steelman-<slug> --body \"...\"`. Steelman shifts are exactly the cross-session memory future fight-team runs benefit from. Per rule 13. [Challenger's r2 output]"
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

### Coordinator salience notes

After synthesis, before proceeding to Phase 6 (Issue Pipeline), the Coordinator writes salience notes for:

- Every convergence decision that flipped mid-synthesis (started as priority:high, ended priority:investigate or dropped, or vice versa): one `decision` note explaining the flip trigger. `tsx scripts/note.ts --kind decision --topic fight-team-convergence-<slug> --body "..."`
- Any finding whose ranking was significantly different from its `expected_gain_if_fixed` score (the score suggested one thing, the debate revealed another): one `finding` note.
- Any cross-finding pattern the debaters surfaced that is not captured by any single finding (e.g., "three of the top 10 findings all trace back to the same missing test layer"): one `finding` note.

These notes compile into the system vault via the daily-compile-and-rotate cron and become input for future /fix and fight-team runs. Bodies are uncapped (Issue #119). Skip with `--kind none --reason "..."` only if the synthesis produced zero shifts, which is unusual in a real debate. Per rule 13.

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
2. Debaters use read-only tools: Read, Glob, Grep, Bash (for `gh issue list`, `npm run health`, and `scripts/note.ts`). No repo edits. `scripts/note.ts` appends to the per-user gitignored `learning/logs/notes.jsonl` and is the only "write" allowed, because salience-triggered notes during rounds are the whole point of rule 13 below.
3. Coordinator (this session) is the only one that creates tasks and issues.
4. Use sonnet model for both debaters.
5. All file paths in the report must be root-relative.
6. The fight-team skill does not write workspace files. Output is tasks and GitHub Issues only.
7. If either agent fails to spawn or crashes mid-round, report the failure and continue with the surviving agent's positions. Note the gap in the synthesis report.
8. Present the full report to the user before creating any tasks. User controls what becomes an issue.
9. The 4-round structure (independent positions, cross-examination, steelman swap, convergence) is mandatory. No skipping rounds.
10. Every Issue body filed by fight-team must pass `scripts/lib/validate-fight-team-issue.ts` before `gh issue create`. Up to 2 retries on failure; on the third failure, surface the malformed body and validator errors to the user instead of filing.
11. Evidence sections require at least one absolute file:line citation. Relative paths in Evidence are rejected by the validator.
12. Never edit Issue bodies after `gh issue create`. If a follow-up correction is needed, file a new Issue that links back to the original.
13. Debaters and coordinator write salience-triggered notes via `scripts/note.ts` during each round. Any moment that feels surprising, interesting, frustrating, or like a self-correction gets a note IN THE MOMENT, not at the end of the debate. Concrete triggers for fight-team specifically: a CONCEDED rebuttal where the concession surprised the conceding debater, a steelman that turned out stronger than the original attack, a convergence decision where the Coordinator changed their mind mid-synthesis, or a finding whose file:line evidence turned out to be weaker or stronger than the health-score description implied. Bodies are uncapped (Issue #119), so write the full thought. Any emotion, positive or negative, is a valid signal. Rule: memory `feedback_note_on_salience.md`.
