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
  "bucket": "memory_link",
  "metric": "freshness",
  "file": "learning/logs/raw.jsonl",
  "line": 1,
  "current_score": 88,
  "expected_gain_if_fixed": 12,
  "description": "last activity entry is 62 days old, threshold is 30 days"
}
```

### Challenger lens

Finding 1: memory_link/freshness at learning/logs/raw.jsonl:1.
The learning log has not been updated in 62 days; the freshness threshold is
30 days. The scorer emits a freshness finding and subtracts twelve points from
the memory_link bucket. Proposed fix: run /play to generate a new session and
update raw.jsonl. Evidence cites raw.jsonl at line 1 with an absolute path.

### Defender lens

Finding 1: memory_link/freshness at learning/logs/raw.jsonl:1.
Inactivity was claimed to be intentional during a planned hiatus. Counter:
the scorer has no exemption for planned pauses; the threshold applies
unconditionally. Gameability check against Anti-gaming table: marking a file
as archived does not apply to log files. Conceded on freshness.
Priority: high (no exemption path available without a code change).

### Steelman pass

For the top high finding: attempt to steelman "this finding is gameable or
redundant". Steelman: the fix is gameable if the player runs /play with
trivial input just to reset the timestamp. Counter-steelman: the scorer is
LOC-based for test density and freshness is time-based, so trivial sessions
do advance the timestamp legitimately. Steelman is not plausible as a gaming
vector. Keep as priority:high.

### Final Issue body

See `web/test/fixtures/doc-issue-good.md` for the validator-passing copy of
the resulting Issue body. That fixture is the canonical example of what a
survived finding looks like in the GitHub Issue stream.
