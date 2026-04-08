#!/usr/bin/env bash
#
# scripts/run-plans.sh: headless parallel execution of sibling plans.
#
# Given a parent-slug argument, this script finds every sibling plan at
# .claude/plans/<parent-slug>-part-*.md, creates one git worktree per
# sibling under .claude/worktrees/, and spawns one non-interactive
# `claude -p` session per worktree in parallel. Each session streams
# its JSON output to learning/logs/run-<slug>.jsonl. The script waits
# for every background job before exiting.
#
# Usage:
#   scripts/run-plans.sh <parent-slug>
#
# Example:
#   scripts/run-plans.sh addressing-all-open-issues-2026-04-08
#
# Trade-offs (read before running):
#
#   - Token spend is real and parallel. N sibling plans at moderate
#     size can be a meaningful bill. Use --max-turns if available.
#   - acceptEdits mode skips the interactive permission prompt so the
#     headless run can make progress. Worktree isolation contains the
#     blast radius to the feature branch only; master is never touched.
#   - There is no human in the loop, so the verifier-subagent rule
#     (see references/architecture/core-workflow.md section 7) is the
#     only quality gate. If a plan skips the verifier you find out
#     from the JSON log after the fact.
#   - Failure handling is "read the JSON log." Wrap in a status
#     reporter that greps for a PASS verdict if you want alerting.
#
# Pairs with Issue #104 (multi-plan splitting heuristic) and Issue
# #103 (cleanup section in plan-preamble).

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: scripts/run-plans.sh <parent-slug>" >&2
  echo "example: scripts/run-plans.sh addressing-all-open-issues-2026-04-08" >&2
  exit 2
fi

PARENT_SLUG="$1"
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

shopt -s nullglob
PLANS=( .claude/plans/${PARENT_SLUG}-part-*.md )
shopt -u nullglob

if [[ ${#PLANS[@]} -eq 0 ]]; then
  echo "no sibling plans found matching .claude/plans/${PARENT_SLUG}-part-*.md" >&2
  exit 1
fi

mkdir -p learning/logs

for plan in "${PLANS[@]}"; do
  slug="$(basename "$plan" .md)"
  worktree=".claude/worktrees/${slug}"
  branch="feature/${slug}"
  log="learning/logs/run-${slug}.jsonl"

  echo "spawning ${slug} -> ${log}"
  git worktree add "$worktree" -b "$branch"

  (
    cd "$worktree"
    claude -p "Execute the plan at .claude/plans/${slug}.md using the superpowers:executing-plans skill. Open a PR when done." \
      --permission-mode acceptEdits \
      --output-format stream-json \
      > "${REPO_ROOT}/${log}" 2>&1
  ) &
done

wait
echo "all plans finished, check learning/logs/run-*.jsonl"
