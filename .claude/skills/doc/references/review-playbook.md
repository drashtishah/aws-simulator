# Doc review playbook

This document defines the single-pass review flow used by the doc skill,
plus a fully worked example tracing one health-score finding through the
Challenger lens, Defender lens, Steelman pass, and into the final Issue body.

## Inputs

The coordinator pre-loads:

- The latest entry of `learning/logs/health-scores.jsonl`, top 10
  findings ranked by `expected_gain_if_fixed`. Each finding carries
  `bucket`, `metric`, `file`, `line`, `current_score`,
  `expected_gain_if_fixed`, `description`.
- The Anti-gaming scenario table in `references/config/code-health.md`
  (section "Anti-gaming scenario table"). This is the Reviewer's
  primary playbook for arguing that a finding is gameable.
- The canonical Issue body schema in
  `.claude/skills/doc/references/issue-template.md`.

If `learning/logs/health-scores.jsonl` is empty or older than 24h, the
coordinator runs `npm run health` to refresh before spawning the reviewer.

## Single-pass review flow

The Opus reviewer reads all 10 findings and every cited file, then produces
one structured block per finding. The Challenger lens names the failure mode
and proposed fix. The Defender lens tests gameability and provides a counter-
example or honest concession. Priority is set to high or investigate; the
only automatic demotion trigger is gameability confirmed by the Defender lens.

After the review, the coordinator sends one steelman pass to the same agent
asking it to steelman the 3 highest-scoring high findings (to check for
redundancy or gameability) and the 3 highest-scoring investigate findings
(to check if they are real problems worth fixing). The revised finding list
drives synthesis.

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

### Challenger lens

Finding 1: skill/ownership_integrity at .claude/skills/play/ownership.json:1.
Two ownership.json files claim the same dir; the scorer counts this twice and
the bucket composite drops twelve points. Stricter test: assert that no two
ownership.json files declare the same file path. Proposed fix: edit
.claude/skills/play/ownership.json line 1 to drop the duplicate entry.
Evidence cites both ownership.json files at line 1 with absolute paths.

### Defender lens

Finding 1: skill/ownership_integrity at .claude/skills/play/ownership.json:1.
Overlap was claimed to be intentional because both skills write session notes.
Counter-example: grep across .claude/skills/play/ shows zero writes to the
disputed target; the SKILL.md line cited by Defender describes a planned
contract, not an implemented one. Gameability check against Anti-gaming table:
dropping the entry without migrating the documented append contract would
silently lose the contract, so the fix must be paired. Conceded on overlap.
Priority: high (gameability check passed once fix is paired).

### Steelman pass

For the top high finding: attempt to steelman "this finding is gameable or
redundant". Steelman: the fix is gameable if the SKILL.md contract is not
updated simultaneously. Counter-steelman: the paired fix (ownership.json edit
+ SKILL.md update) is not gameable. Steelman is not plausible for the paired
approach. Keep as priority:high.

### Final Issue body

See `web/test/fixtures/doc-issue-good.md` for the validator-passing copy of
the resulting Issue body. That fixture is the canonical example of what a
survived finding looks like in the GitHub Issue stream.
