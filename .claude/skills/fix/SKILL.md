---
name: fix
description: Apply accumulated feedback to improve the simulation skills. Analyzes three sources: player feedback notes, activity log patterns, and code health scores. Runs health checks after each change to track improvement. Use when user says "fix", "apply feedback", or "improve skills".
effort: medium
---

# fix Skill

Analyzes feedback, activity logs, and code health scores, then applies targeted improvements to simulation skills. Tracks health regressions per edit.

## Tool Reference

| Step | Action | Tool | Target |
|------|--------|------|--------|
| 0 | Load workspace map | Read | `references/architecture/workspace-map.md` |
| 1 | Load feedback | Read | `learning/feedback.md` |
| 2 | Load activity logs | Read | `learning/logs/activity.jsonl` |
| 2 | Load metrics config | Read | `scripts/metrics.config.json` |
| 3 | Load test results | Read | `web/test-results/summary.json` |
| 3b | List open issues | Bash | gh issue list |
| 4 | Run health check | Bash | tsx scripts/code-health.ts |
| 8a | Read target skill | Read | `.claude/skills/*/SKILL.md` |
| 8c | Search code | Grep | Source files |
| 8e | Apply edits | Edit | Target skill/reference files |
| 8f | Run health check | Bash | tsx scripts/code-health.ts |
| 8g | Log health scores | Write | `learning/logs/health-scores.jsonl` |
| 8h-verify | Verification | Agent | Separate subagent |
| 9 | Clear feedback | Write | `learning/feedback.md` |
| 9 | Update metrics config | Write | `scripts/metrics.config.json` |

---

## Phase 1: Gather

### 0. Set skill context

Before making changes, read `references/architecture/workspace-map.md` to understand component dependencies and impact.

### 1. Read feedback

Read `learning/feedback.md`. Note whether there are entries beyond the header (the header is lines 1-9, frontmatter + title + description).

### 2. Analyze activity logs

Read `learning/logs/activity.jsonl`. Check `last_fix_analyzed` in `scripts/metrics.config.json`. If not null, filter to entries with `ts` after that timestamp. If null, process all entries. Analyze for:

- **Session abandonment**: SessionStart events without a matching SessionEnd with `reason: "prompt_input_exit"` in the same session_id. Count abandoned sessions.
- **Context pressure**: PreCompact events with `trigger: "auto"`. Group by session_id. Flag sessions with 2+ auto-compactions.
- **Tool failures**: Group PostToolUseFailure events by tool name and error message. Flag patterns where the same Bash command fails 3+ times (player stuck).
- **System failures**: StopFailure events (rate_limit, billing, server_error, max_output_tokens). These are infrastructure issues, not sim bugs.
- **Player engagement**: Count UserPromptSubmit events per session. Report average.
- **Permission bypass audit**: Read `references/registries/permission-bypass-registry.md`. Verify all entries have guardrails noted. If the registry is stale (check file modification date vs last code change), run `npm run audit:permissions` to refresh.

### 2b. Analyze learning vault

Read `learning/vault/index.md` for stats. Read `learning/vault/patterns/question-quality.md` and `learning/vault/patterns/behavioral-profile.md`. Include in the unified report:

```
=== Learning Vault Insights ===
- Question quality trend: {improving/declining/stable} (last 5 sessions: {scores})
- Behavioral patterns: {notable observations}
- Growth area: {weakest quality dimension with suggestion}
- Concept coverage: {concepts encountered vs total available}
```

Also check `learning/vault/raw/` for orphaned raw notes. If found, compile them using the same logic as Step 19 in the play skill. Report: "Found and compiled {N} orphaned raw notes."

Run vault health checks:
- All `[[wikilinks]]` in session notes resolve to existing files
- Orphan concept notes (no session links to them)
- Stale concepts (not encountered in recent sessions)
- Pattern files have been updated recently
- Report vault health score alongside code health score

### 3. Check recent test results

If `web/test-results/summary.json` exists, read it for recent test failures. Note any browser spec failures or high-severity persona findings. These inform which skill areas need attention.

### 3b. Check open GitHub Issues

Run `gh issue list --state open --json number,title,labels,body --limit 50`. Group issues by label:
- `bug`: prioritize these
- `enhancement`: include if related to current feedback themes
- `chore`: include if low-effort

Note issue numbers for any that align with feedback or log findings. These will be referenced in Phase 3 commits.

### 4. Run code health baseline

Run `tsx scripts/code-health.ts` and capture the six scores + composite. Also read the last entry in `learning/logs/health-scores.jsonl` (if the file exists and has entries) to compute deltas. Flag any metric that dropped by 5+ points since the last recorded score.

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

### 6b. Create tasks and issues

For each group of actionable findings that will drive changes, follow `.claude/skills/git/references/task-to-issue.md`:

1. Create a task per finding group (Stage 1). Use the finding group name as subject.
2. Present the full task list to the user for confirmation.
3. Promote confirmed tasks to GitHub Issues (Stage 2). Use `bug` label for regressions and failures, `enhancement` for improvements.
4. Record the issue numbers for commit references in Phase 3.

---

## Phase 3: Plan and Apply

### 7. Group actionable items by target

- Sim content, narrative, artifacts, difficulty: target `create-sim` skill (`.claude/skills/create-sim/SKILL.md`) and `.claude/skills/create-sim/references/sim-template.md`
- Play flow, coaching, hints, console behavior: target `play` skill (`.claude/skills/play/SKILL.md`) and its references (`.claude/skills/play/references/agent-prompts.md`, `.claude/skills/play/references/coaching-patterns.md`)
- Code structure, modularity, complexity regressions: target the specific files flagged by health scores
- Web UI layout, visual design, navigation changes: edit `web/public/` files directly. After edits, use chrome-devtools MCP to take a screenshot and present it to the user for approval. The web app has live reload enabled in dev mode (`npm run dev`), so the browser updates automatically.
- Player behavior patterns (approach, quality trends, engagement): update `learning/vault/patterns/` notes
- Code bugs, infra errors, test failures: create GitHub Issues
- Agent behavior expectations: update `references/config/eval-scoring.yaml`
- Ambiguous items: present to user for classification

### 8. Apply changes with per-edit health tracking

For each group of related changes:

Before starting each group, mark its task in_progress.

a. Read the target skill's SKILL.md and relevant reference files.
b. Use the skill-creator skill for guidance on skill editing best practices.
c. Enter plan mode to design the changes.
d. Present the plan to the user for approval.
e. After approval, apply edits to the target files.
f. **Immediately run `tsx scripts/code-health.ts` after applying the edits.** Compare against the baseline from step 3. Report:
   - Which scores improved, stayed stable, or regressed
   - If any score regressed by 5+ points, flag it and ask whether to proceed or revert
g. Log the post-edit scores to `learning/logs/health-scores.jsonl`:
   ```json
   {"ts":"2026-03-31T...","source":"fix","group":"{group name}","modularity":0,"encapsulation":0,"size_balance":0,"dep_depth":0,"complexity":0,"test_sync":0,"composite":0}
   ```
h. **Commit after each small, self-contained feature change.** Each visual change, behavioral change, or config change gets its own commit. Never batch multiple features into one commit. Each commit must be independently revertable via `git revert` without breaking other changes. Follow the procedure in `.claude/skills/git/references/commit-procedure.md`. Reference the GitHub Issue (`Closes #N` for last commit, `Ref #N` otherwise). Include `intent` and `decision` action lines.
h-verify. **Verification must be done by a separate subagent.** The agent that wrote code or text for this group must NOT be the same agent that verifies it. Spawn a new subagent to run the verification (health check, tests, visual regression). This applies to all verification steps: health checks (8f), test runs, and visual regression.
i. Mark this group's task completed.
j. Repeat for each remaining group.

---

## Phase 4: Finalize

### 9. Clear processed state

After all changes applied:
- Clear processed entries from `learning/feedback.md` (keep lines 1-9: frontmatter header intact)
- Update `last_fix_analyzed` in `scripts/metrics.config.json` to current ISO timestamp
- Rotate both log files:
  1. Read all lines from `learning/logs/activity.jsonl`
  2. Filter out entries where `session_id === "test-threshold"` (synthetic test data)
  3. Write filtered entries to `learning/logs/archive/activity-{YYYY-MM-DD}.jsonl`
  4. Truncate `activity.jsonl` to empty
  5. Repeat for `learning/logs/system.jsonl` -> `learning/logs/archive/system-{YYYY-MM-DD}.jsonl`
  Note: archive files are gitignored and persist for manual review

### 10. Final health comparison

Run `tsx scripts/code-health.ts` one final time. Report overall before/after comparison (baseline from step 3 vs final). Log to `learning/logs/health-scores.jsonl` with `"source": "fix-final"`.

### 11. Verify all test layers

Run `sim-test validate` to verify all layers pass after changes.

After validate completes, check for completed play sessions:

Ask: "Want to run eval scorecard? (scores completed play sessions, instant for deterministic checks)"
- Yes: run `sim-test evals`, report the scorecard
- If scorecard has pending LLM checks, ask: "Run LLM judgment checks too? (~2-3 min, token cost)"
  - Yes: run `sim-test evals --llm`, report results
  - No: skip
- No: skip

Then ask: "Want to run agent browser tests? (starts web server, runs specs via Chrome DevTools)"
- Yes:
  1. Start the web server: `npm start &`
  2. Wait for it to be ready (check `curl -s http://localhost:3200`)
  3. Run `sim-test agent` to get specs, then execute each spec's steps via Chrome DevTools MCP tools (navigate, click, take_snapshot, evaluate_script)
  4. Record findings: which steps passed, which had selector mismatches or unexpected state
  5. Stop the web server when done
  6. Report findings. If selectors are stale, note them for the next fix cycle.
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
6. Verification separation: any step that verifies work (health checks, test runs, visual regression) must be performed by a different subagent than the one that wrote the code or text being verified.
7. Every feature change gets its own commit. If a group contains multiple independent changes (e.g., remove a button AND fix a border color), commit each separately. Structure changes so reverting one commit does not break others.
