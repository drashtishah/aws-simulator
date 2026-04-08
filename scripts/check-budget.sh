#!/usr/bin/env bash
#
# scripts/check-budget.sh: pre-flight rate-limit budget check.
#
# Scans learning/logs/run-*.jsonl (or BUDGET_LOG_DIR if set) for any
# `rate_limit_event` entry with a `resetsAt` timestamp in the future.
# If any file has a pending reset, exits non-zero with a clear human
# message naming the reset time. Otherwise exits 0.
#
# Used by scripts/spawn-sibling.sh as a pre-flight gate so we do not
# dispatch a new headless session into a near-exhausted 5-hour rolling
# token budget. Issue #148.
#
# Usage:
#   scripts/check-budget.sh            # default dir: learning/logs/
#   BUDGET_LOG_DIR=/tmp/x scripts/check-budget.sh   # override dir (tests)
#
# Exit codes:
#   0 = safe to dispatch
#   1 = budget exhausted, reset is in the future
#   2 = usage or filesystem error

set -euo pipefail

LOG_DIR="${BUDGET_LOG_DIR:-learning/logs}"

if [[ ! -d "$LOG_DIR" ]]; then
  # Empty or non-existent dir means no prior runs to worry about.
  exit 0
fi

shopt -s nullglob
LOGS=( "$LOG_DIR"/run-*.jsonl )
shopt -u nullglob

if [[ ${#LOGS[@]} -eq 0 ]]; then
  exit 0
fi

NOW_EPOCH=$(date +%s)
MAX_RESET=0

for log in "${LOGS[@]}"; do
  # Only block on rate_limit_event records with status=rejected.
  # allowed_warning events (e.g. 7-day utilization warnings) do NOT
  # prevent dispatch; they just surface usage stats. The resetsAt on
  # an allowed_warning can be days in the future (weekly window) and
  # is not a hard gate.
  while IFS= read -r line; do
    if [[ -z "$line" ]]; then continue; fi
    if ! echo "$line" | grep -q '"rate_limit_event"'; then continue; fi
    if ! echo "$line" | grep -q '"status":"rejected"'; then continue; fi
    reset=$(echo "$line" | sed -n 's/.*"resetsAt":\([0-9]*\).*/\1/p')
    if [[ -z "$reset" ]]; then continue; fi
    if (( reset > MAX_RESET )); then
      MAX_RESET=$reset
    fi
  done < "$log"
done

if (( MAX_RESET > NOW_EPOCH )); then
  reset_human=$(date -r "$MAX_RESET" '+%Y-%m-%d %H:%M:%S %Z')
  remaining=$(( MAX_RESET - NOW_EPOCH ))
  echo "check-budget: rate limit resets at epoch $MAX_RESET ($reset_human), ${remaining}s from now" >&2
  echo "check-budget: refusing to dispatch; wait for reset" >&2

  # Record a decision note so the refusal is discoverable in
  # learning/logs/notes.jsonl and surfaces via the Stop hook. Issue #131.
  # Best-effort only: note.ts failure must not mask the original refusal,
  # and the note is redundant to stderr anyway. NOTES_LOG_DIR override is
  # honored for tests.
  note_body="check-budget refused dispatch; rate limit resets at epoch ${MAX_RESET} (${reset_human}), ${remaining}s from now"
  npx tsx "$(dirname "$0")/note.ts" \
    --kind decision \
    --topic ratelimit-refusal \
    --body "$note_body" >/dev/null 2>&1 || true

  exit 1
fi

exit 0
