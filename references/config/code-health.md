---
tags:
  - type/reference
  - scope/maintenance
---

# Code Health Scores

Deterministic static analysis run by `scripts/code-health.ts`.
Invoke with `npm run health`. Use `npm run health -- --json` for machine
output and `npm run health -- --rebase-floors` to consciously lower per-bucket
floors (see Floors below).

## Layers

PR-C delivers Layers 1 and 2 of the four-layer scorer:

| Layer | Responsibility | Status |
|-------|----------------|--------|
| 1     | Scope discovery via `git ls-files` plus pure `classify(path)` | done (PR-C) |
| 2     | Per-bucket scoring, completeness, composite, invariants, floors | done (PR-C) |
| 3     | Bucket-specific metrics: frontmatter_valid, manifest_schema_valid, recently_used, ownership_consistent, freshness, inbound_link_count | PR-D |
| 4     | Aggregation, graph metrics, fight-team feedback loop | PR-D |

The legacy seven-metric scorer (modularity, encapsulation, size_balance,
dep_depth, complexity, test_sync, references_health) still runs in parallel
and prints alongside the new bucket report. It is preserved so downstream
consumers (`/fix`, web/test, future fight-team) keep working unchanged.

## Buckets

Every tracked file belongs to exactly one of these ten buckets, decided by
`scripts/lib/classify.ts`. Plans are explicitly excluded from scoring per
`feedback_no_plan_scoring`.

| Bucket | Match rules |
|--------|-------------|
| code | `web/lib/**`, `web/server.ts`, `web/public/**`, `scripts/**.{ts,js,py}` |
| test | `web/test/**`, `web/test-specs/**` |
| skill | `.claude/skills/**` |
| command | `.claude/commands/**` |
| hook | `.claude/hooks/**` |
| sim | `sims/**` |
| reference | `references/**` (excluding registries) |
| registry | `references/registries/**` |
| config | `*.json` and infra files at root, `.claude/settings*.json`, `.mcp.json`, `.claude/scheduled-jobs/**`, `.claude/state/**`, `scripts/*.json` |
| memory_link | `learning/**`, `docs/**`, `themes/**`, `CLAUDE.md`, `README.md` |

## Composite formula

The core anti-gaming invariant:

```
composite = min(weighted_avg(bucket_scores), completeness * 100)
```

where `completeness = (classified + excluded) / tracked`. Plans are excluded
(counted as accounted for so removing them does not penalize), but every
other tracked file MUST classify or `code-health.ts` throws loud.

This guarantees that no scope-narrowing trick can raise the composite:
shrinking the system reduces the numerator more than it shrinks the
denominator, and unclassified leftovers fail outright.

## Completeness

`scripts/lib/classify.ts` is a pure, I/O-free function. Every entry returned
by `git ls-files` must satisfy ONE of:

1. `classify(path)` returns a non-null bucket (the normal path)
2. `classify(path)` returns null because the path lives under the dot-claude
   plans directory (intentionally excluded as private scratch, gitignored)
3. The path appears in the `healthignore` array of `scripts/metrics.config.json`,
   together with a non-empty `reason`

If none of those hold, the scorer throws and the build fails. This is
"completeness invariant 1".

## Healthignore

Use sparingly. Each entry is `{ path, reason }`. The `reason` is REQUIRED
(invariant 2) and snapshot-tested in `web/test/code-health-config.test.ts`,
so silent additions are visible in code review. Plans must NEVER be added
here, they are excluded structurally by `classify()`.

## Floors

Per-bucket file count floors are stored in `scripts/metrics.config.json`
under `floors`. They auto-rise when a bucket's count exceeds the current
floor and NEVER auto-lower. Going below the floor subtracts 10 points from
that bucket's score (advisory penalty, capped at one per bucket per run)
and records a `bucket_floor` violation. The only way to lower a floor is
the explicit human flag `--rebase-floors`.

Floor history (and per-run bucket counts, code/test LOC, completeness) is
appended to `learning/logs/health-scores.jsonl`. The pre-commit hook
`pre-commit-issues.ts` refuses any commit whose Bash command contains
`git rm ... learning/logs/health-scores.jsonl`. (`learning/` is currently
gitignored; the guard is forward-looking.)

## Hard invariants

| # | Invariant | Guardrail |
|---|-----------|-----------|
| 1 | Every `git ls-files` entry classifies or healthignores | scorer throws |
| 2 | Every healthignore entry has a non-empty reason | scorer throws |
| 3 | `test_loc / code_loc` cannot drop without proportional code shrink | zeros test bucket |
| 4 | Per-bucket file-count floor is monotonic | zeros bucket on drop |
| 5 | Every skill dir has `ownership.json` | violation recorded |
| 6 | `learning/logs/health-scores.jsonl` is never deleted | pre-commit refuses |

## Anti-gaming scenario table

Each row has a dedicated test in `web/test/code-health.test.ts`.

| # | Attack | Guardrail |
|---|--------|-----------|
| A1 | Delete a low-scoring file to raise its bucket average | Per-bucket file-count floor in `metrics.config.json`. Going below zeros the bucket. Floor only rises except via `--rebase-floors`. |
| A2 | Delete tests to raise the test bucket | `test_density` invariant: empty test set scores 0; LOC-ratio history check zeros the bucket if ratio drops without code shrink. |
| A3 | Add a file to `healthignore` to silence a finding | `healthignore` entries require `reason`; snapshot test makes additions visible. |
| A4 | Delete a referenced doc to fix a dangling-ref finding | Legacy `references_health` still penalizes; PR-D adds an "orphan removal" inverse penalty so net is zero. |
| A5 | Mass-archive skills to silence "unused skill" findings | `recently_used` (PR-D) only forgives `archived: true` skills with no recent edits and no references. Layer 1+2 surfaces missing `ownership.json`. |
| A6 | Add trivial tests to inflate ratio | `test_density` is LOC-based, not file-count. Trivial tests don't move LOC. |
| A7 | Lower the bar in `metrics.config.json` | `code-health-config.test.ts` snapshots all weights and structural fields; any change is a visible diff. |
| A8 | Bypass the scorer by editing `code-health.ts` | The scorer file lives in the `code` bucket and is itself scored. Behavior is unit-tested for fixed inputs. |
| A9 | Delete `health-scores.jsonl` to wipe floors | Pre-commit hook refuses `git rm learning/logs/health-scores.jsonl`. |
| A10 | Add a tiny new bucket easy to max out | `BUCKETS` is fixed at 10 and snapshot-tested. Completeness still binds the composite. |
| A11 | Optimize one bucket to 100 while another rots | Equal bucket weights ensure the rotting bucket linearly drags the composite. |
| A12 | Narrow scope by deleting whole directories | `composite = min(weighted_avg, completeness * 100)`. Cannot win by shrinking. |

## Files

- `scripts/code-health.ts`: the scorer (Layer 1+2 + legacy 7 metrics)
- `scripts/lib/classify.ts`: pure path classifier
- `scripts/metrics.config.json`: bucketWeights, floors, healthignore, legacy weights
- `learning/logs/health-scores.jsonl`: monotonic floor history
- `web/test/classify.test.ts`: classifier unit tests
- `web/test/code-health.test.ts`: scorer + invariant + anti-gaming tests
- `web/test/code-health-config.test.ts`: config snapshot tests
- `web/test/health-floors.test.ts`: floor monotonicity tests
- `.claude/hooks/pre-commit-issues.ts`: invariant 6 deletion guard

## CLI

```
npm run health                       # default text report
npm run health -- --json             # machine-readable JSON
npm run health -- --rebase-floors    # explicitly snap floors to current counts
```
