---
name: fix
description: Apply accumulated feedback to improve the simulation skills. Analyzes three sources: player feedback notes, activity log patterns, and code health scores. Runs health checks after each change to track improvement. Use when user says "fix", "apply feedback", or "improve skills".
effort: medium
paths:
  - learning/**
  - .claude/skills/**
hooks:
  PreToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "node .claude/hooks/guard-write.js --ownership .claude/skills/fix/ownership.json"
---

# fix Skill

Analyzes feedback, activity logs, and code health scores, then applies targeted improvements to simulation skills. Tracks health regressions per edit.

---

## Phase 1: Gather

### 0. Set skill context

Before making changes, read `references/workspace-map.md` to understand component dependencies and impact.

### 1. Read feedback

Read `learning/feedback.md`. Note whether there are entries beyond the header (the header is lines 1-9, frontmatter + title + description).

### 2. Analyze activity logs

Read `learning/logs/activity.jsonl`. Check `last_fix_analyzed` in `scripts/metrics.config.json`. If not null, filter to entries with `ts` after that timestamp. If null, process all entries. Analyze for:

- **Session abandonment**: SessionStart events without a matching SessionEnd with `reason: "prompt_input_exit"` in the same session_id. Count abandoned sessions.
- **Context pressure**: PreCompact events with `trigger: "auto"`. Group by session_id. Flag sessions with 2+ auto-compactions.
- **Tool failures**: Group PostToolUseFailure events by tool name and error message. Flag patterns where the same Bash command fails 3+ times (player stuck).
- **System failures**: StopFailure events (rate_limit, billing, server_error, max_output_tokens). These are infrastructure issues, not sim bugs.
- **Player engagement**: Count UserPromptSubmit events per session. Report average.
- **Permission bypass audit**: Read `references/permission-bypass-registry.md`. Verify all entries have guardrails noted. If the registry is stale (check file modification date vs last code change), run `npm run audit:permissions` to refresh.

### 3. Check recent test results

If `test-results/summary.json` exists, read it for recent test failures. Note any browser spec failures or high-severity persona findings. These inform which skill areas need attention.

### 4. Run code health baseline

Run `node scripts/code-health.js` and capture the six scores + composite. Also read the last entry in `learning/logs/health-scores.jsonl` (if the file exists and has entries) to compute deltas. Flag any metric that dropped by 5+ points since the last recorded score.

---

## Phase 2: Report

### 5. Present unified report

Present a unified report to the user with three sections:

```
=== Feedback Notes ===
{entries from feedback.md grouped by date, or "None."}

=== Activity Log Insights ===
{anomalies from step 2 grouped by category, or "Logs look healthy, no issues detected."}
{include counts: N sessions analyzed, M abandoned, K failures, etc.}

=== Code Health ===
Current composite: {score}
{per-metric scores with deltas vs last recorded, flagging regressions of 5+}
{or "No previous scores to compare against." if health-scores.jsonl doesn't exist}
```

Ask the user which findings should drive skill improvements.

### 6. Check for actionable work

If no feedback entries AND no actionable log insights AND no health regressions, say "Nothing to process." and stop.

### 6b. Create GitHub Issues

For each group of actionable findings that will drive changes, create a GitHub Issue per `.claude/skills/git/references/issue-workflow.md`. Use the `bug` label for regressions and failures, `enhancement` for improvements. Record the issue numbers for commit references in Phase 3.

---

## Phase 3: Plan and Apply

### 7. Group actionable items by target

- Sim content, narrative, artifacts, difficulty: target `create-sim` skill (`.claude/skills/create-sim/SKILL.md`) and `.claude/skills/create-sim/references/sim-template.md`
- Play flow, coaching, hints, console behavior: target `play` skill (`.claude/skills/play/SKILL.md`) and its references (`.claude/skills/play/references/agent-prompts.md`, `.claude/skills/play/references/coaching-patterns.md`)
- Code structure, modularity, complexity regressions: target the specific files flagged by health scores
- Behavioral expectations, scoring/coaching bugs, edge case failures, log-pattern anomalies (SESSION_AUTOSAVE_FAILED, TOOL_LOOP, CONTEXT_HIGH), persona findings about play-skill behavior: append to `learning/eval-proposals.md` using the proposal format below. Do NOT route here for simple code fixes, sim content quality, web UI issues, or one-off infra errors.
- Ambiguous items: present to user for classification

**Eval proposal format** (append to `learning/eval-proposals.md`):

```markdown
### {date}: {one-line description}
- **Source**: feedback / activity-log / test-result
- **Track**: deterministic / judgment
- **Category**: scoring / coaching / console / enablement / edge-case
- **Sim**: {sim_id or "any"}
- **What to test**: {expected behavior}
- **What went wrong**: {observed behavior}
```

After appending proposals, inform the user: "Eval proposals written. Run `sim-test eval --proposals` to generate draft YAML."

### 8. Apply changes with per-edit health tracking

For each group of related changes:

a. Read the target skill's SKILL.md and relevant reference files.
b. Use the skill-creator skill for guidance on skill editing best practices.
c. Enter plan mode to design the changes.
d. Present the plan to the user for approval.
e. After approval, apply edits to the target files.
f. **Immediately run `node scripts/code-health.js` after applying the edits.** Compare against the baseline from step 3. Report:
   - Which scores improved, stayed stable, or regressed
   - If any score regressed by 5+ points, flag it and ask whether to proceed or revert
g. Log the post-edit scores to `learning/logs/health-scores.jsonl`:
   ```json
   {"ts":"2026-03-31T...","source":"fix","group":"{group name}","modularity":0,"encapsulation":0,"size_balance":0,"dep_depth":0,"complexity":0,"test_sync":0,"composite":0}
   ```
h. **Commit this change.** Follow the procedure in `.claude/skills/git/references/commit-procedure.md`. The commit should reference the GitHub Issue for this group (use `Closes #N` if this is the last commit for that issue, `Ref #N` otherwise). Include `intent` and `decision` action lines describing why this specific change was made.
i. Repeat for each remaining group.

---

## Phase 4: Finalize

### 9. Clear processed state

After all changes applied:
- Clear processed entries from `learning/feedback.md` (keep lines 1-9: frontmatter header intact)
- Update `last_fix_analyzed` in `scripts/metrics.config.json` to current ISO timestamp

### 10. Final health comparison

Run `node scripts/code-health.js` one final time. Report overall before/after comparison (baseline from step 3 vs final). Log to `learning/logs/health-scores.jsonl` with `"source": "fix-final"`.

### 11. Verify all test layers

Run `sim-test validate` to verify all layers pass after changes.

After validate completes, check for completed play sessions:

Ask: "Want to run eval scorecard? (scores completed play sessions, instant for deterministic checks)"
- Yes: run `sim-test evals`, report the scorecard
- If scorecard has pending LLM checks, ask: "Run LLM judgment checks too? (~2-3 min, token cost)"
  - Yes: run `sim-test evals --llm`, report results
  - No: skip
- No: skip

### 12. Clean up

All changes were already committed per-change in step 8h. Verify with `git log --oneline -10` that each change has its own contextual commit referencing an issue.

---

## Rules

1. No emojis.
2. Always run health checks after each edit group. Never skip the comparison.
3. Never edit `learning/logs/activity.jsonl` directly. It is append-only by hooks.
4. The fix skill reads logs and feedback but only writes to skill files, `learning/feedback.md`, `learning/logs/health-scores.jsonl`, and `scripts/metrics.config.json`.
5. Do not push automatically. Let the user decide.
