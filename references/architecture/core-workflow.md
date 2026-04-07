# Core Workflow

Single canonical workflow for all code changes in this repo. Every skill, hook, and agent cites this file. No duplicates. When a rule conflicts with anything else, this doc wins.

## 1. Issue first

Every change starts with a GitHub Issue, created before any code is touched. Never retroactively. Capture intent, scope, and the plan file path if one exists.

```bash
gh issue create --title "PR-X: ..." --body "Source plan: .claude/plans/<slug>.md"
```

The issue number is referenced in every commit body (`Ref #N`) and the final commit closes it (`Closes #N`).

## 2. Worktree

Non-trivial work happens in an isolated git worktree under `.claude/worktrees/` so the main checkout stays clean and parallel agents cannot collide.

```bash
git worktree add .claude/worktrees/<slug> -b feature/<slug>
```

Cleanup rules are in section 9.

## 3. Plan if non-trivial

If the change touches more than one file or more than one skill, write a plan first in `.claude/plans/<slug>.md` with exhaustive file lists, exact line references, and a commit sequence. Implementation happens in a separate session reading the plan file. Plans are private scratch space and are never scored by health metrics.

## 4. TDD red-green

Tests come first, always. Write the failing test, run it, confirm it fails for the expected reason, then implement. Never write implementation code before a failing test exists. Verification of failure is part of the workflow, not optional.

## 5. Small revertable commits and merge strategy

Every feature is split into the smallest logical commits possible. Each commit on `master` must be **independently revertable** via `git revert <sha>` without breaking the build or cascading into other commits. This is a hard rule, not a suggestion: the user treats git as a memory and safety layer, and losing per-change granularity destroys that.

Merge strategy, non-negotiable:

- PRs land via **merge commit** or **rebase**, never squash. **No squash** merges on any branch, ever.
- Each commit on master preserves its original SHA and message so `git revert <sha>` targets exactly the change that introduced a regression.
- If a PR has ten commits, master gets ten commits. Squashing collapses ten revertable units into one and is forbidden.

Commit message format: short imperative subject, body with `intent:` and `decision:` action lines, and `Ref #N` or `Closes #N` trailer.

## 6. Per-commit targeted tests, full suite at end

After every commit, run the targeted subset of tests affected by the change via `sim-test --changed` (delivered by PR-I). This runs in 1 to 3 seconds so it stays frictionless per commit. At the end of the PR, run the full suite with `npm test` once before opening the PR. If targeted tests fail mid-sequence, stop and fix forward, do not pile more commits on top of red.

## 7. Verifier subagent separation

Verification of a change must be performed by a **different subagent** than the one that wrote the code. The author subagent cannot grade its own work. Spawn a fresh verifier with a clean context and have it run the verification commands listed in the plan, then report pass or fail. This is enforced by convention in `/fix` and by plan structure.

## 8. Revert, not history rewrite

When a commit on a shared branch turns out to be wrong, the remediation is `git revert <sha>`, which creates a new commit that undoes the old one. Forbidden operations on any shared branch:

- `git rebase -i` to drop, reorder, or squash commits.
- `git push --force` or `git push --force-with-lease` on `master` or any branch that has been pushed.
- `git commit --amend` on a commit that has been pushed.
- `git reset --hard` on a branch that has been pushed.

History is append-only once pushed. Mistakes get reverted, not erased. Combined with section 5's no-squash rule, this guarantees every change on master is recoverable by SHA forever.

## 9. Worktree cleanup

After a PR merges, delete the worktree and its branch:

```bash
git worktree remove .claude/worktrees/<slug>
git branch -D feature/<slug>
git worktree prune
```

Never leave stale worktrees. Stale worktrees confuse agent navigation, inflate health scores, and pollute `git ls-files` across the monorepo.

## 10. Testing system pointer

For how the test runner, agent browser tests, and `sim-test --changed` actually work, see `references/architecture/testing-system.md`. That doc is the source of truth for the testing infrastructure; this doc only prescribes when to run tests, not how they are implemented.
