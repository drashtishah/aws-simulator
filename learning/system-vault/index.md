---
tags: [kind/index, scope/vault]
updated: 2026-04-13
note_count: 23
---
# system-vault index

Agent query protocol: read this file first. Grep summaries for keywords; open
at most 3 matching notes; follow wiki-links one hop. See `references/pipeline/`
for the per-stage version of this protocol.

## problems
- [[problem-floor-snap-deletion-race]] scope/code signal/regression: deleting tracked file then running health snaps the wrong floor and trips a bucket_floor advisory in the same commit
- [[problem-patch-plan-assumes-template-structure]] scope/pipeline stage/planner signal/loop: patch-plan fails on free-form issues or when embedded headings create false section anchors
- [[problem-plan-old-string-master-drift]] scope/pipeline stage/planner signal/loop: copy-pasted old_string in a revised plan goes stale when a sibling PR merges mid-revision; match fails or silently reverts sibling work
- [[problem-shell-bsd-gnu-drift]] scope/ci signal/regression: shell scripts using BSD-only flags pass on macOS, fail every Linux CI run
- [[problem-sibling-issue-collision]] scope/skills signal/loop: ad-hoc commit duplicates work a live sibling worktree already owns, requires revert and burns trust
- [[problem-misapplied-label-persists-through-pipeline]] scope/pipeline signal/waste: wrong label persists through all stages because no stage can remove or correct labels
- [[problem-tsx-test-recursion]] scope/testing tool/tsx: tsx --test refuses to run itself recursively; outer integration test silently passes while inner suite skips
- [[problem-plan-scope-change-stale-residue]] scope/pipeline stage/planner signal/loop: scope narrowing in revision leaves stale sections that burn critic rounds
## solutions
- [[solution-baseline-via-worktree]] cost/trivial: git worktree add master to compare pre-existing test failures without leaving the main clone dirty
- [[solution-doctor-skip-integration-on-ci]] cost/trivial: DOCTOR_SKIP_INTEGRATION=1 in ci.yml so the 12s web-server boot check does not flake on cold runners
- [[solution-escape-headings-in-plan-fences]] cost/trivial: use four-backtick fences or escape ### when plan edits contain markdown headings to prevent patch-plan false anchors
- [[solution-fence-aware-patch-body]] cost/trivial: fence-aware line tokenizer in patchBody prevents false section anchors from headings inside code fences
- [[solution-extract-cli-helpers-then-unit-test]] cost/moderate: pull per-file logic out of the CLI into a pure helper and unit-test the helper
- [[solution-reread-master-before-plan-revision]] cost/trivial: re-read each edited file from master HEAD on every plan revision and regenerate old/new blocks from scratch
- [[solution-revert-floor-config-pre-commit]] cost/trivial: revert metrics.config.json floors to post-deletion actuals before committing
- [[solution-revert-to-let-sibling-win]] cost/trivial: git revert your direct commit so the richer sibling PR can land cleanly
- [[solution-search-issues-before-create]] cost/trivial: gh issue list --state all --search before gh issue create, every time
- [[solution-shell-portable-python-bridge]] cost/trivial: replace BSD-only date/sed/readlink with python3 one-liners
- [[solution-worktree-symlink-node-modules]] cost/trivial: symlink the main checkout's node_modules into a fresh worktree instead of running npm install

## playbooks

## patterns
- [[pattern-pin-third-party-before-planning]] scope/pipeline stage/planner: plans installing third-party tools must pin exact commit SHA before writing the plan
- [[pattern-question-the-tier-not-the-addition]] when a proposed addition's killer use case is already covered, question the whole tier
- [[pattern-rules-in-duplicate-places-get-ignored]] a rule duplicated in two places gets ignored even by the agent that just read both copies
- [[pattern-vault-read-write-asymmetry]] vault READ and vault WRITE are independently scoped permissions, never bundle them

## prune queue
