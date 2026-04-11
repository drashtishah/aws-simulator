# Findings-driven 4-round debate

This document defines the 4-round debate structure used by the
fight-team skill, plus a fully worked example tracing one health-score
finding through r1, r2, r3, r4, and into the final Issue body.

## Inputs

The coordinator pre-loads:

- The latest entry of `learning/logs/health-scores.jsonl`, top 10
  findings ranked by `expected_gain_if_fixed`. Each finding carries
  `bucket`, `metric`, `file`, `line`, `current_score`,
  `expected_gain_if_fixed`, `description`.
- The Anti-gaming scenario table in `references/config/code-health.md`
  (section "Anti-gaming scenario table"). This is the Defender's
  primary playbook for arguing that a finding is gameable.
- The canonical Issue body schema in
  `.claude/skills/fight-team/references/issue-template.md`.

If `learning/logs/health-scores.jsonl` is empty or older than 24h, the
coordinator runs `npm run health` to refresh before spawning debaters.

## Round 1, Independent positions

Both debaters read the top 10 findings and every cited file in
isolation. They write their positions without seeing the other side.
Each debater knows in advance that round 2 forbids "I agree" and that
round 3 demands a steelman of the opposing position, so round 1
positions must be defensible.

## Round 2, Cross-examination

Each debater receives the other's r1 positions and produces a numbered
rebuttal for every finding. "I agree" is forbidden. Every rebuttal
must be one of:

1. A counter-example with file:line.
2. A stricter test the finding would fail.
3. The literal token CONCEDED followed by an explanation of why the
   finding survived attack.

Defender uses the Anti-gaming scenario table from
`references/config/code-health.md` as a written checklist of attacks
to consider. If any finding matches an entry in that table, Defender
flags it as priority:investigate, not action: this finding is
gameable, fixing it the obvious way will lower real quality.

## Round 3, Steelman swap

Each debater takes the other's strongest surviving position and writes
the best possible version of it. Findings that cannot be steelmanned
are demoted to priority:investigate in round 4.

## Round 4, Convergence

Coordinator resolves. A finding becomes an Issue only if it survived
rounds 2+3 with at least one absolute file:line citation that both
debaters acknowledge exists. Findings that survived but could not be
steelmanned are filed with label priority:investigate instead of
priority:high.

## Worked example

### Health-score input (synthetic)

```json
{
  "bucket": "skill",
  "metric": "ownership_integrity",
  "file": ".claude/skills/play/ownership.json",
  "line": 1,
  "current_score": 88,
  "expected_gain_if_fixed": 12,
  "description": "overlap with setup ownership.json on a shared file"
}
```

### Round 1, Challenger position

Finding 1: skill/ownership_integrity at .claude/skills/play/ownership.json:1.
Failure mode: two skills both claim the same owned file, dragging the
skill bucket composite down by twelve points. Stricter test:
web/test/code-health.test.ts should assert that no two ownership.json
files declare the same file path. Proposed fix: edit
.claude/skills/play/ownership.json line 1 to drop the duplicate entry.
Evidence cites both ownership.json files at line 1 with absolute paths.

### Round 1, Defender position

Finding 1: skill/ownership_integrity at .claude/skills/play/ownership.json:1.
Defense: overlap is intentional because both skills emit session notes
that append to the same target. Counter-example cite of play SKILL.md:42
which documents the append-only contract. Why current state is sound:
removing the entry would break the per-skill ownership manifest used by
audit-permissions.

### Round 2, Challenger rebuttal

Defender claim has no file:line backing in code. Grep across
.claude/skills/play/ shows zero writes to the disputed target. The
SKILL.md line cited by Defender describes a planned contract, not an
implemented one. Stricter test: a unit test asserting that any path in
a skill's ownership.json must be referenced by at least one Write or
Edit call inside that skill's directory. Defender finding survives
rebuttal only if a real write site is produced.

### Round 2, Defender rebuttal

CONCEDED on overlap. Challenger is right that play/ never writes to the
disputed target in code. However, the proposed fix is gameable: per the
Anti-gaming scenario table in references/config/code-health.md, dropping
the entry without first migrating the documented append contract would
silently lose the contract. Stricter test: the fix commit must also
delete the contract reference in play SKILL.md.

### Round 3, Steelman swap

Challenger steelmans Defender: the strongest version of Defender's
position is that the fix must be paired with a SKILL.md update so we do
not lose the documented intent. The cleanest patch is therefore a
two-line edit, not one.

Defender steelmans Challenger: the strongest version of Challenger's
position is that overlap pairs are a structural defect in the ownership
graph and a per-pair regression test in code-health.test.ts is the right
gate, regardless of intent.

### Round 4, Convergence

Both debaters acknowledge the finding survives with a file:line citation.
The fix is paired (ownership.json edit + SKILL.md update + new
regression test). Filed as priority:high.

### Final Issue body

See `web/test/fixtures/fight-team-issue-good.md` for the validator-passing
copy of the resulting Issue body. That fixture is the canonical example
of what a survived finding looks like in the GitHub Issue stream.
