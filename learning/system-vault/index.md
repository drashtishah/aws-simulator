---
tags: [kind/index, scope/vault]
updated: 2026-04-23
note_count: 35
---
# system-vault index

Agent query protocol: read this file first. Grep summaries for keywords; open
at most 3 matching notes; follow wiki-links one hop. See `references/pipeline/`
for the per-stage version of this protocol.

## problems
- [[problem-baseline-checkout-contaminates-clone]] scope/testing stage/verifier signal/loop: checking out master files on the main clone leaves feature-branch reads returning master content
- [[problem-floor-snap-deletion-race]] scope/code signal/regression: deleting tracked file then running health snaps the wrong floor and trips a bucket_floor advisory in the same commit
- [[problem-patch-plan-assumes-template-structure]] scope/pipeline stage/planner signal/loop: patch-plan fails on free-form issues or when embedded headings create false section anchors
- [[problem-plan-old-string-master-drift]] scope/pipeline stage/planner signal/loop: copy-pasted old_string in a revised plan goes stale when a sibling PR merges mid-revision; match fails or silently reverts sibling work
- [[problem-shell-bsd-gnu-drift]] scope/ci signal/regression: shell scripts using BSD-only flags pass on macOS, fail every Linux CI run
- [[problem-sibling-issue-collision]] scope/skills signal/loop: ad-hoc commit duplicates work a live sibling worktree already owns, requires revert and burns trust
- [[problem-misapplied-label-persists-through-pipeline]] scope/pipeline signal/waste signal/loop: wrong label persists because dispatcher re-applies after critic removal
- [[problem-tsx-test-recursion]] scope/testing tool/tsx: tsx --test refuses to run itself recursively; outer integration test silently passes while inner suite skips
- [[problem-plan-scope-change-stale-residue]] scope/pipeline stage/planner signal/loop: scope narrowing in revision leaves stale sections that burn critic rounds
- [[problem-orphaned-rule-targets-absent-field]] scope/pipeline stage/implementer signal/regression tool/eval-runner: removing fieldMap entry without grepping eval-scoring.yaml leaves orphan rules that silently pass
- [[problem-plan-ignores-source-invariant-tests]] scope/pipeline stage/planner signal/self-correction: plan edits collide with pre-existing tests that assert on source content, flipping green tests red post-impl
- [[problem-plan-targets-gitignored-path]] scope/pipeline stage/planner signal/loop: plan targets a gitignored path, implementer produces zero committable diff
- [[problem-unenforced-schema-drifts-from-plan]] scope/pipeline stage/implementer signal/insight: schema with additionalProperties false is not loaded by any test, so plans demand out-of-schema fields and impl ships them silently
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
- [[solution-resummarize-before-ui-commit]] cost/trivial: run agent-browser-summarize right before git commit so committed_at_head matches HEAD and the pre-commit-ui-tests hook passes
- [[solution-absence-selector-allowlist-or-evaluate]] cost/trivial: add removed selector to absenceSelectors in cross-file-consistency.test.ts or use evaluate_script when asserting DOM absence
- [[solution-grep-source-invariants-before-edit]] cost/trivial: grep test tree for readFileSync/execSync references to each edited file before finalizing plan
- [[solution-critic-check-gitignore-for-plan-paths]] cost/trivial: run git check-ignore on every Files-to-change path before reviewing plan content

## playbooks
- [[playbook-sim-verifier-cross-checks-artifact-timestamps]] scope/sim-content stage/verifier signal/insight: cross-reference timestamps across every artifact (cloudwatch CSV, rds-events, api-gateway-logs) before PASS on sim content

## patterns
- [[pattern-pin-third-party-before-planning]] scope/pipeline stage/planner: plans installing third-party tools must pin exact commit SHA before writing the plan
- [[pattern-question-the-tier-not-the-addition]] when a proposed addition's killer use case is already covered, question the whole tier
- [[pattern-rules-in-duplicate-places-get-ignored]] a rule duplicated in two places gets ignored even by the agent that just read both copies
- [[pattern-vault-read-write-asymmetry]] vault READ and vault WRITE are independently scoped permissions, never bundle them
- [[pattern-negative-prompt-assertion-leaks-excluded-name]] scope/testing tool/claude-sdk: "Do NOT read X" in a prompt leaks literal X; assert(!prompt.includes('X')) flips true
