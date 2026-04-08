#!/usr/bin/env bash
#
# scripts/sibling-status.sh: one-line-per-sibling status snapshot.
#
# Given a parent slug, prints one line per existing sibling worktree
# showing: commit count on the feature branch, HEAD short SHA, JSON
# log file size, alive/dead state (via pgrep), and the most recent
# rate_limit_event's resetsAt if any. Read-only, cheap, safe to run
# at any time. Issue #148.
#
# The orchestrating Claude Code session runs this at each sibling
# completion checkpoint to decide whether to dispatch the next sibling
# or intervene. It is NOT used for polling mid-flight; the /fix skill
# explicitly prohibits polling, so status is a spot-check tool.
#
# Usage:
#   scripts/sibling-status.sh <parent-slug>
#
# Example:
#   scripts/sibling-status.sh open-issues-sweep-2026-04-08
#
# Output format (one line per sibling worktree found):
#   <slug>: <N> commits, HEAD=<short-sha>, log=<size>, <alive|dead> [reset=<ts>]

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: scripts/sibling-status.sh <parent-slug>" >&2
  echo "example: scripts/sibling-status.sh open-issues-sweep-2026-04-08" >&2
  exit 2
fi

PARENT="$1"

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

shopt -s nullglob
WORKTREES=( .claude/worktrees/"${PARENT}"-part-* )
shopt -u nullglob

if [[ ${#WORKTREES[@]} -eq 0 ]]; then
  echo "no siblings for parent slug '${PARENT}'"
  exit 0
fi

for wt in "${WORKTREES[@]}"; do
  slug="$(basename "$wt")"
  branch="feature/${slug}"
  log="learning/logs/run-${slug}.jsonl"

  # Commit count and HEAD
  if git -C "$wt" rev-parse --verify HEAD >/dev/null 2>&1; then
    commit_count=$(git -C "$wt" rev-list --count master..HEAD 2>/dev/null || echo "?")
    head_short=$(git -C "$wt" rev-parse --short HEAD 2>/dev/null || echo "?")
  else
    commit_count="?"
    head_short="?"
  fi

  # Log file size
  if [[ -f "$log" ]]; then
    log_size=$(wc -c < "$log" | tr -d ' ')
    # Humanize: bytes, KB, MB
    if (( log_size >= 1048576 )); then
      log_size_h="$(( log_size / 1048576 ))MB"
    elif (( log_size >= 1024 )); then
      log_size_h="$(( log_size / 1024 ))KB"
    else
      log_size_h="${log_size}B"
    fi
  else
    log_size_h="(no log)"
  fi

  # Alive check: any claude -p process mentioning this worktree path
  if pgrep -f "claude -p.*${slug}" >/dev/null 2>&1 || pgrep -fl "claude -p" 2>/dev/null | grep -q "$slug"; then
    state="alive"
  else
    # Broader check: any claude -p at all, and the worktree matches
    state="dead"
  fi

  # Reset time from most recent rejected rate_limit_event in the log.
  # Only status:rejected blocks dispatch; allowed_warning and allowed
  # just surface utilization and a future window boundary and do NOT
  # mean the sibling is blocked. Same bug the check-budget.sh script
  # had before the fix in commit eaa44db.
  reset_info=""
  if [[ -f "$log" ]]; then
    last_reset=$( { grep '"rate_limit_event"' "$log" 2>/dev/null || true; } | { grep '"status":"rejected"' || true; } | tail -1 | sed -n 's/.*"resetsAt":\([0-9]*\).*/\1/p')
    if [[ -n "$last_reset" ]]; then
      now_epoch=$(date +%s)
      if (( last_reset > now_epoch )); then
        reset_h=$(date -r "$last_reset" '+%H:%M:%S' 2>/dev/null || echo "$last_reset")
        reset_info=" [rate-limited until ${reset_h}]"
      fi
    fi
  fi

  # Dirty state in worktree (uncommitted changes)
  dirty=""
  if git -C "$wt" status --porcelain 2>/dev/null | head -1 | grep -q .; then
    dirty=" dirty"
  fi

  echo "${slug}: ${commit_count} commits, HEAD=${head_short}, log=${log_size_h}, ${state}${dirty}${reset_info}"
done
