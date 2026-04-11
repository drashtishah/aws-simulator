---
name: doc
description: >
  System health doctor. Reviews the whole workspace through code-health
  metrics, identifies high-value problems, and files GitHub Issues tagged
  needs-human for human triage before the GHA pipeline picks them up.
  Use when user says "doc", "system check", "health check",
  "workspace review", or "diagnose".
references_system_vault: true
---

# doc Skill

Single-Opus system health review driven entirely by code-health findings.
A coordinator (this session) loads health findings, spawns one Opus reviewer,
runs one steelman pass, synthesizes the results, and files GitHub Issues
tagged `needs-human` for human triage before the GHA pipeline picks them up.

**Inputs:** before spawning the reviewer, the coordinator reads the latest
entry of `learning/logs/health-scores.jsonl` and selects the top 10 findings
by `expected_gain_if_fixed`. If the file is empty or older than 24h, run
`npm run health` first to refresh. Each finding carries `bucket`, `metric`,
`file`, `line`, `current_score`, `expected_gain_if_fixed`, `description`.

The review covers the whole workspace. Buckets include code, test, skill,
command, hook, sim, reference, registry, config, memory_link. Treat all
buckets equally.

---

## Phase 1: Load inputs

Read the latest entry of `learning/logs/health-scores.jsonl`. Select the
top 10 findings by `expected_gain_if_fixed`. If the file is empty or older
than 24h, run `npm run health` first. Read every cited file at its cited
line before spawning the reviewer.

---

## Phase 2: Opus review

Spawn a single `Agent` call with `model: opus`. No `team_name`. No
`TeamCreate`. Pass the Reviewer prompt below. Read-only tools only.

```
Agent:
  model: opus
  prompt: [Reviewer prompt below]
```

Wait for the agent to complete.

---

## Phase 3: Steelman pass

Send one `SendMessage` to the same Opus agent:

> "For each of the 3 findings with the highest `expected_gain_if_fixed` score
> among `priority:high` findings: attempt to steelman the claim 'this finding
> is gameable or redundant'. If the steelman is plausible, demote to
> `priority:investigate` and explain why in one sentence. For each of the 3
> findings with the highest `expected_gain_if_fixed` score among
> `priority:investigate` findings: attempt to steelman the claim 'this is a
> real problem worth fixing'. If the steelman is not plausible, drop the
> finding. Output a revised finding list with any changes noted."

Wait for the agent to complete.

---

## Phase 4: Synthesis

Coordinator reads the reviewer's output and the steelman pass output. Produce
a structured report:

```
=== Doc Workspace Review ===

--- Agreed (survived steelman) ---

[Finding N]: [title]
  Files: [specific file paths and line numbers]
  Recommendation: [what to do]
  Priority: high / investigate

--- Resolved Disputes (demoted or dropped by steelman) ---

[Finding N]: [title]
  Original priority: high / investigate
  Steelman result: [one sentence]
  Resolution: [demoted to investigate | dropped]

--- Unresolved (flagged for human review) ---

[Finding N]: [title]
  Reviewer position: [summary]
  Why unresolved: [what makes this genuinely ambiguous]
```

Print the full report to the user.

---

## Phase 5: Auto-file Issues

For each finding in Agreed and Resolved Disputes:

1. Compose Issue body matching `.claude/skills/doc/references/issue-template.md`.
2. Run body through `scripts/lib/validate-doc-issue.ts`:

```bash
npx tsx -e "
import fs from 'fs';
import { validateDocIssue } from './scripts/lib/validate-doc-issue';
const body = fs.readFileSync('/tmp/doc-issue-body.md','utf8');
const r = validateDocIssue(body);
if (!r.valid) { console.error(JSON.stringify(r.errors,null,2)); process.exit(1); }
"
```

Retry policy: up to 2 retries on failure. On the third failure, surface the
malformed body and validator errors to the user. Do not call `gh issue create`.

3. Dedup: `gh issue list --search "<keywords>" --state open`. If a match
   exists, `gh issue comment` instead of creating a duplicate.

4. Otherwise:

```bash
gh issue create --title "<one-sentence finding>" \
  --label "source:doc,priority:<high|investigate>,bucket:<b>,metric:<m>,<type-label>,needs-human" \
  --body-file /tmp/doc-issue-body.md
```

Labels (also set in the body's `## Labels` section):
- `source:doc` always
- `priority:high` or `priority:investigate` per reviewer output
- `bucket:<bucket>` from the health-score finding
- `metric:<metric>` from the health-score finding
- Type label from `references/pipeline/labels.md`
- `needs-human` always (human strips this to release into GHA pipeline)

5. Unresolved findings stay in the report only; not filed.

---

## Phase 6: Report issue numbers

List filed Issues with their numbers. Note they are tagged `needs-human`; a
human must strip the label to release them into the GHA pipeline.

---

## Reviewer Prompt (Opus, single agent)

```
You are the system health doctor. Review the whole workspace through the top
10 health findings. The workspace is not just code. Buckets include code,
test, skill, command, hook, sim, reference, registry, config, memory_link.
Treat all buckets equally.

INPUTS (provided by coordinator):
- Top 10 findings from learning/logs/health-scores.jsonl, each with bucket,
  metric, file, line, current_score, expected_gain_if_fixed, description.
- The Anti-gaming scenario table in references/config/code-health.md
  (section "Anti-gaming scenario table"). Use it as your gameability playbook.
- The Issue body schema in .claude/skills/doc/references/issue-template.md.

For each of the 10 findings:
1. Read the cited file at the cited line.
2. Produce the block below.

OUTPUT FORMAT (per finding):

## Finding <n>: <bucket>/<metric> at <absolute file>:<line>
Challenger lens: <failure mode, stricter test, proposed fix, evidence file:line>
Defender lens: <counter-example or concession, gameability check against Anti-gaming
table in references/config/code-health.md, evidence file:line. "I agree" is forbidden.
Concede explicitly with one-line reasoning or cite a counter-example.>
Priority: high or investigate. Demotion trigger: gameable (Defender check). Any
other demotion must be explained in the Defender lens.
```

---

## Rules

1. No emojis.
2. Reviewer uses read-only tools: Read, Glob, Grep, Bash (for `gh issue list`,
   `npm run health`). No repo edits.
3. Coordinator (this session) is the only one that files Issues.
4. Use opus model for the reviewer, single agent, no team, no `TeamCreate`.
5. All file paths in the report must be root-relative.
6. The doc skill does not write workspace files. Output is GitHub Issues only.
7. If the Opus agent fails to spawn or crashes, report the failure and surface
   raw findings to the user. Note the gap in the synthesis report.
8. Single Opus review plus one steelman pass is mandatory. No additional
   SendMessage calls beyond the one steelman pass.
9. Every Issue body filed by doc must pass `scripts/lib/validate-doc-issue.ts`
   before `gh issue create`. Up to 2 retries on failure; on the third failure,
   surface the malformed body and validator errors to the user instead of filing.
10. Evidence sections require at least one absolute file:line citation. Relative
    paths in Evidence are rejected by the validator.
11. Never edit Issue bodies after `gh issue create`. If a follow-up correction
    is needed, file a new Issue that links back to the original.
