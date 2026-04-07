---
tags:
  - type/reference
  - scope/maintenance
---

# Code Health Scores

Deterministic static analysis scores computed by `scripts/code-health.ts`.
Run with `npm run health`.

## When it runs

- `/fix` runs health checks automatically: baseline before changes, after each edit group, and a final comparison.
- Scores are logged to `learning/logs/health-scores.jsonl` with source tags (`fix`, `fix-final`).
- You can still run `npm run health` manually at any time for a quick check.

## Scores (0-100, higher is better)

| Score | What it measures | Key sub-metric |
|-------|-----------------|----------------|
| modularity | Coupling between modules | avg require() fan-out |
| encapsulation | Interface width | avg exports per module |
| size_balance | God-file detection | max/median LOC ratio |
| dep_depth | Cascade risk | longest require() chain |
| complexity | Branching complexity | avg cyclomatic complexity |
| test_sync | Test coverage gaps | % of modules with tests |
| references_health | Index hygiene for `references/` | unlisted files, missing targets, stale files |

### references_health

Starts at 100 and subtracts:

- 10 per file in `references/**` not mentioned in `references/registries/agent-index.md`
- 10 per backtick-quoted `references/...` path in the agent-index whose target does not exist on disk
- 5 per file in `references/**` whose mtime is older than 180 days

The score floors at 0. The metric ensures the agent-index keeps pace with the actual contents of `references/`, so navigating agents never hit dead links and authors never silently orphan a doc.

## Composite

Equal-weight average of all seven scores (each contributes 1/7). Weights are configurable in `scripts/metrics.config.json`.

## Interpreting changes

- A score drop after a refactor means the change introduced coupling, complexity, or imbalance.
- Focus on `modularity` and `encapsulation` for structural health.
- Focus on `complexity` for readability and maintainability.
- `test_sync` dropping means a new module was added without a corresponding test file.

## Files

- `scripts/code-health.ts`: the scorer (do not modify during refactors)
- `scripts/metrics.config.json`: weights and last_fix_analyzed timestamp
- `learning/logs/health-scores.jsonl`: historical scores (created by `/fix` after each edit group)
