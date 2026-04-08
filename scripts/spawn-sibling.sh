#!/usr/bin/env bash
#
# scripts/spawn-sibling.sh: per-sibling headless dispatcher.
#
# Runs exactly ONE sibling plan to completion, synchronously. No fork,
# no wait, no backgrounded subshells. The orchestrating Claude Code
# session is responsible for running this script 1..N times (one per
# sibling) via Bash(run_in_background=true) calls, one harness task
# per sibling. Replaces the old scripts/run-plans.sh fork-and-wait
# model whose one-task-blob notification shape prevented per-sibling
# intervention. Issue #148.
#
# Pairs with:
#   - scripts/check-budget.sh  (pre-flight rate-limit check)
#   - scripts/sibling-status.sh  (mid-flight and at-checkpoint status)
#
# Usage:
#   scripts/spawn-sibling.sh <parent-slug> <part-slug>
#
# Example:
#   scripts/spawn-sibling.sh open-issues-sweep-2026-04-08 part-1
#
# Idempotent on resume: if the worktree and branch already exist, they
# are reused (matches the resume-safe goal of Issue #128). The headless
# agent's first actions MUST be to cat the per-worktree progress.txt
# and `git log master..HEAD` to pick up from any prior state.
#
# Exit codes:
#   0 = claude -p returned cleanly
#   1 = claude -p returned non-zero
#   2 = usage error
#   3 = budget pre-flight refused dispatch

set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: scripts/spawn-sibling.sh <parent-slug> <part-slug>" >&2
  echo "example: scripts/spawn-sibling.sh open-issues-sweep-2026-04-08 part-1" >&2
  exit 2
fi

PARENT="$1"
PART="$2"
SLUG="${PARENT}-${PART}"

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

PLAN=".claude/plans/${SLUG}.md"
WORKTREE=".claude/worktrees/${SLUG}"
BRANCH="feature/${SLUG}"
LOG="learning/logs/run-${SLUG}.jsonl"

if [[ ! -f "$PLAN" ]]; then
  echo "spawn-sibling: plan file not found: $PLAN" >&2
  exit 2
fi

# Pre-flight budget check. Refuses to dispatch if any recent run log
# contains a rate_limit_event with resetsAt in the future.
if ! scripts/check-budget.sh; then
  echo "spawn-sibling: budget pre-flight failed for ${SLUG}; not dispatching" >&2
  exit 3
fi

# Resume-safe worktree + branch creation (Issue #128). Reuse if present.
if [[ ! -d "$WORKTREE" ]]; then
  if git show-ref --verify --quiet "refs/heads/${BRANCH}"; then
    git worktree add "$WORKTREE" "$BRANCH"
  else
    git worktree add "$WORKTREE" -b "$BRANCH"
  fi
else
  echo "spawn-sibling: reusing existing worktree at $WORKTREE" >&2
fi

# Seed the plan file into the worktree. .claude/plans/ is gitignored, so
# a fresh `git worktree add` checkout has no plan file. Issue #141.
mkdir -p "${WORKTREE}/.claude/plans"
cp "$PLAN" "${WORKTREE}/.claude/plans/$(basename "$PLAN")"

# Per-worktree initializer (Issue #138). Idempotent: only seeds missing
# artifacts. Runs after worktree creation/reuse, before cd and exec.
# Mirrors the two-phase initializer/coder pattern from Anthropic's
# "Effective harnesses for long-running agents": a fresh sibling must
# start with the same environment state that `npm run doctor` expects.
initialize_worktree() {
  local worktree="$1"

  # 1. Per-worktree progress log. Not tracked by git (see .gitignore).
  #    Guarded so a resume dispatch does NOT overwrite prior lines.
  if [[ ! -f "${worktree}/progress.txt" ]]; then
    echo "$(date -u +%FT%TZ) | init | worktree initialized by scripts/spawn-sibling.sh" \
      > "${worktree}/progress.txt"
  fi

  # 2. learning/system-vault/ stub so doctor's strict check starts
  #    green on a fresh worktree. Inline write is simpler than shelling
  #    out to install-git-hooks (which also installs post-commit hooks
  #    that we do not need per sibling dispatch).
  if [[ ! -f "${worktree}/learning/system-vault/index.md" ]]; then
    mkdir -p "${worktree}/learning/system-vault"
    printf '# System Vault\n\nSeeded by scripts/spawn-sibling.sh initialize_worktree (Issue #138).\n' \
      > "${worktree}/learning/system-vault/index.md"
  fi
}

initialize_worktree "$WORKTREE"

mkdir -p learning/logs

PROMPT="Execute the plan at ${PLAN} using the superpowers:executing-plans skill. "
PROMPT+="Your first two actions: (1) cat progress.txt if it exists (it lives at the worktree root, "
PROMPT+="which is your cwd), (2) run git log master..HEAD to confirm landed state. Then continue "
PROMPT+="from wherever the plan left off. After every commit, append a line to progress.txt "
PROMPT+="summarizing the work. Open a PR when the full plan is complete."

cd "$WORKTREE"
exec claude -p "$PROMPT" \
  --permission-mode acceptEdits \
  --output-format stream-json \
  --verbose \
  > "${REPO_ROOT}/${LOG}" 2>&1
