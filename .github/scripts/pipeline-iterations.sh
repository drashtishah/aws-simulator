#!/usr/bin/env bash
# Pipeline iteration counting. Sourced by critic.yml and verifier.yml.
# Changing MAX_ITERATIONS here changes both critic and verifier caps.

MAX_ITERATIONS=5

# count_pipeline_comments <issue_number> <repo> <prefix>
# Echoes the number of issue comments whose body starts with <prefix>.
count_pipeline_comments() {
  local issue="$1" repo="$2" prefix="$3"
  gh issue view "$issue" --repo "$repo" \
    --json comments \
    --jq "[.comments[].body | select(startswith(\"$prefix\"))] | length"
}

count_plans() { count_pipeline_comments "$1" "$2" "Planner starting"; }
count_impls() { count_pipeline_comments "$1" "$2" "Implementer starting"; }
