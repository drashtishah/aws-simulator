---
tags: [kind/index, scope/vault]
updated: 2026-04-11
note_count: 15
---
# system-vault index

Agent query protocol: read this file first. Grep summaries for keywords; open
at most 3 matching notes; follow wiki-links one hop. See `references/pipeline/`
for the per-stage version of this protocol.

## problems
- [[problem-floor-snap-deletion-race]] scope/code signal/regression: deleting tracked file then running health snaps the wrong floor and trips a bucket_floor advisory in the same commit
- [[problem-shell-bsd-gnu-drift]] scope/ci signal/regression: shell scripts using BSD-only flags pass on macOS, fail every Linux CI run
- [[problem-sibling-issue-collision]] scope/skills signal/loop: ad-hoc commit duplicates work a live sibling worktree already owns, requires revert and burns trust
- [[problem-tsx-test-recursion]] scope/testing tool/tsx: tsx --test refuses to run itself recursively; outer integration test silently passes while inner suite skips

## solutions
- [[solution-baseline-via-worktree]] cost/trivial: git worktree add master to compare pre-existing test failures without leaving the main clone dirty
- [[solution-doctor-skip-integration-on-ci]] cost/trivial: DOCTOR_SKIP_INTEGRATION=1 in ci.yml so the 12s web-server boot check does not flake on cold runners
- [[solution-extract-cli-helpers-then-unit-test]] cost/moderate: pull per-file logic out of the CLI into a pure helper and unit-test the helper
- [[solution-revert-floor-config-pre-commit]] cost/trivial: revert metrics.config.json floors to post-deletion actuals before committing
- [[solution-revert-to-let-sibling-win]] cost/trivial: git revert your direct commit so the richer sibling PR can land cleanly
- [[solution-search-issues-before-create]] cost/trivial: gh issue list --state all --search before gh issue create, every time
- [[solution-shell-portable-python-bridge]] cost/trivial: replace BSD-only date/sed/readlink with python3 one-liners
- [[solution-worktree-symlink-node-modules]] cost/trivial: symlink the main checkout's node_modules into a fresh worktree instead of running npm install

## playbooks

## patterns
- [[pattern-question-the-tier-not-the-addition]] when a proposed addition's killer use case is already covered, question the whole tier
- [[pattern-rules-in-duplicate-places-get-ignored]] a rule duplicated in two places gets ignored even by the agent that just read both copies
- [[pattern-vault-read-write-asymmetry]] vault READ and vault WRITE are independently scoped permissions, never bundle them

## prune queue
