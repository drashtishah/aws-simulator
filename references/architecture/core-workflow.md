# Core Workflow

Single canonical workflow for all code changes in this repo. Every skill, hook, and agent cites this file. No duplicates. When a rule conflicts with anything else, this doc wins.

## 1. Issue first

Every change starts with a GitHub Issue, created before any code is touched. Never retroactively. Capture intent, scope, and the plan file path if one exists.

```bash
gh issue create --title "PR-X: ..." --body "Source plan: .claude/plans/<slug>.md"
```

The issue number is referenced in every commit body (`Ref #N`) and the final commit closes it (`Closes #N`).

## 2. Worktree

Non-trivial work happens in an isolated git worktree under the `.claude/` directory so the main checkout stays clean and parallel agents cannot collide.

```bash
git worktree add .claude/worktrees/{slug} -b feature/{slug}
```

Cleanup rules are in section 9.

## 3. Plan if non-trivial

If the change touches more than one file or more than one skill, write a plan first in `.claude/plans/<slug>.md` with exhaustive file lists, exact line references, and a commit sequence. Implementation happens in a separate session reading the plan file. Plans are private scratch space and are never scored by health metrics.

## 4. TDD red-green

Tests come first, always. Write the failing test, run it, confirm it fails for the expected reason, then implement. Never write implementation code before a failing test exists. Verification of failure is part of the workflow, not optional.

## 5. Small revertable commits and merge strategy

Every feature is split into the smallest logical commits possible so history reads as a diffable, inspectable sequence. The safety guarantee lives at the **PR boundary**, not at every intermediate commit: each PR lands as a `--no-ff` **merge commit** on master, and reverting that merge commit cleanly rolls back the whole PR as one atomic unit. That merge commit is the unit that is **independently revertable** via `git revert <sha>`. Stack commits inside a PR so that reverting the whole PR is clean; individual mid-stack commits may touch the same files as later commits in the same stack and are not guaranteed to revert in isolation.

Merge strategy, non-negotiable:

- PRs land via `--no-ff` **merge commit**, never squash. **No squash** merges on any branch, ever.
- Each commit on master preserves its original SHA and message so history stays diffable and `git revert <merge-sha>` targets exactly the PR that introduced a regression.
- If a PR has ten commits, master gets ten commits plus one merge commit. Squashing collapses the revertable PR unit and is forbidden.

Commit message format: short imperative subject, body with `intent:` and `decision:` action lines, and `Ref #N` or `Closes #N` trailer.

## 6. Per-commit targeted tests, full suite at end

After every commit, run the targeted subset of tests affected by the change via `sim-test --changed` (delivered by PR-I). This runs in 1 to 3 seconds so it stays frictionless per commit. At the end of the PR, run the full suite with `npm test` once before opening the PR. If targeted tests fail mid-sequence, stop and fix forward, do not pile more commits on top of red.

After every commit, also pause to consider the code-health impact: did this change touch any file that has an open finding in the latest `learning/logs/health-scores.jsonl`? Could the same diff have resolved or improved a bucket score in passing? Prefer changes that hold or improve the score over changes that ship test-green but quietly degrade a bucket (dangling refs, complexity, dead code). This is a habit, not a hard gate; the gate runs at PR-time via `npm run health` in §9.

## 6b. Notes after every commit

After every commit, write one entry to `learning/logs/notes.jsonl` via `scripts/note.ts`. This is the semantic stream the daily compile cron rolls into the system vault, and it is the project's only durable agent-to-agent memory. Writing one note per commit gives the vault a guaranteed cadence so it grows in lockstep with the work.

```bash
tsx scripts/note.ts --kind <finding|negative_result|workaround|decision|none> --topic <slug> --body "<one or two sentences>"
```

Allowed kinds:

- `finding`: a non-obvious thing the commit revealed (a constraint, a gotcha, a measurement, an architectural insight).
- `negative_result`: a path that did not work, with the reason it failed, so the next agent does not retry it.
- `workaround`: a temporary fix or known-bad pattern that should be revisited later, with the symptom it papers over.
- `decision`: a deliberate choice the commit embodies, with the reason why this option won.
- `none`: explicit "nothing worth recording" escape hatch, requires `--reason` so the gap is auditable.

The Stop hook (`.claude/hooks/stop-journal-check.ts`) enforces at least one note per session before exit. The cadence rule above is stricter: one note per commit, not just one per session, so each individual change carries its own context forward rather than being collapsed into a session-level summary. Future agents querying the system vault see the same unit of detail the original author committed.

## 7. Verifier subagent separation

Verification of a change must be performed by a **different subagent** than the one that wrote the code. The author subagent cannot grade its own work. Spawn a fresh verifier with a clean context and have it run the verification commands listed in the plan, then report pass or fail. This is enforced by convention in `/fix` and by plan structure.

## 8. Revert, not history rewrite

When a commit on a shared branch turns out to be wrong, the remediation is `git revert <sha>`, which creates a new commit that undoes the old one. Forbidden operations on any shared branch:

- `git rebase -i` to drop, reorder, or squash commits.
- `git push --force` or `git push --force-with-lease` on `master` or any branch that has been pushed.
- `git commit --amend` on a commit that has been pushed.
- `git reset --hard` on a branch that has been pushed.

History is append-only once pushed. Mistakes get reverted, not erased. Combined with section 5's no-squash rule, this guarantees every change on master is recoverable by SHA forever.

## 9. Cleanup: worktree, branch, Issues, ephemeral artifacts, doctor

After a PR merges, five things must be cleaned up: the worktree, the feature branch, any referenced Issues that did not auto-close, any ephemeral build/test artifacts that may have leaked into the repo root, and a final `npm run doctor` confirmation that the workspace is healthy.

Worktree and branch:

```bash
git worktree remove {worktree path}
git branch -D feature/{slug}
git worktree prune
```

Never leave stale worktrees. Stale worktrees confuse agent navigation, inflate health scores, and pollute `git ls-files` across the monorepo.

Issue closure verification:

```bash
gh issue list --state open --search "<space-separated issue numbers referenced by the merged PR>"
```

The `Closes #N` trailer in a commit body is supposed to auto-close the Issue when the PR merges, but auto-close can fail silently: a typo (`Close #N` instead of `Closes #N`), a trailer attached only to a `Ref #N` commit and not the final commit, GitHub branch-protection settings, or a rebase that re-authored the commit body. Verify after every merge. If any referenced Issue is still open:

```bash
gh issue close <N> --comment "Closed by PR #<pr-number>, see <merge-sha>"
```

Verifying Issue closure is part of cleanup, not a follow-up task. An Issue that stays open after its PR merges silently re-enters the next /fix input bundle and triggers duplicate work.

Ephemeral artifact sweep:

```bash
rm -rf .mypy_cache .pytest_cache .ruff_cache .tmp
git status --porcelain
```

`.mypy_cache` (Issue #76), `.pytest_cache`, `.ruff_cache`, and ad-hoc `.tmp/` directories sometimes regenerate from test runs even though they are gitignored. Sweep them after every PR merge. Prevention via per-tool cache-dir env vars (Issue #76's `MYPY_CACHE_DIR` redirect) is the primary line of defense; this sweep is a backstop. If `git status --porcelain` shows untracked entries you do not recognize, investigate before deleting.

Doctor confirmation:

```bash
npm run doctor
```

Must return exit 0 with zero FAIL lines. `npm run doctor` is the live workspace smoke test (read-only, scripts/doctor.ts) that confirms hooks are installed, the system vault is seeded, scheduled-jobs manifests parse, the path registry is fresh, and the integration checks (Issue #105) all pass. If any check fails, fix it before declaring the merge complete. `npm run doctor` adds value over `npm test` because it checks LIVE workspace state (installed git hooks, .mcp.json, learning/system-vault/index.md) that unit tests in tmpdirs cannot reach. See Issue #110 for the doctor coverage and sync guarantees.

## 10. Testing system pointer

For how the test runner, agent browser tests, and `sim-test --changed` actually work, see `references/architecture/testing-system.md`. That doc is the source of truth for the testing infrastructure; this doc only prescribes when to run tests, not how they are implemented.
