---
id: solution-worktree-symlink-node-modules
kind: solution
title: Symlink the main checkout's node_modules into a fresh worktree instead of running npm install
tags: [kind/solution, scope/testing, tool/git, tool/npm]
created: 2026-04-11
updated: 2026-04-11
source_issues: []
confidence: observed
summary: ln -s ../../node_modules learning/.../<worktree>/node_modules avoids a 30 to 60 second npm install per worktree and keeps path-registry tests happy
applies_to: []
preconditions: the worktree shares the same package.json as the main checkout (no version drift)
cost: trivial
---

## Steps
1. Create the worktree as usual:
   ```bash
   git worktree add .worktrees/<name> -b feature/<name>
   ```
2. Symlink node_modules from the main checkout:
   ```bash
   ln -s "$(git rev-parse --show-toplevel)/node_modules" .worktrees/<name>/node_modules
   ```
   The path-registry test asserts node_modules/ exists; the symlink
   resolves and the assertion passes without an actual npm install.
3. Run tests in the worktree.

## Why this works
node_modules is a pure-data dir; nothing in it is path-aware to
the worktree root. A symlink shares the same dependencies between
the main checkout and the worktree at zero disk cost.

## When NOT to use
If the worktree branch bumps a dependency in package.json, the
symlink will return the wrong version. In that case, run npm
install in the worktree (one-time cost). Better long-term: extend
the path-registry test to skip node_modules dir checks, removing
the symlink need entirely.
