---
tags: [kind/feedback, scope/pipeline]
updated: 2026-04-23
---
# Feedback log

- print failing file names: `scripts/test.ts` printed only a count on failure; individual file names were not surfaced, making triage require a second manual run.
  Resolved: 3dd0937 2026-04-07, 42124d8 2026-04-07

- per-file tsx subprocess overhead: `scripts/test.ts` spawns one `tsx` process per test file; startup cost dominates on large suites and makes incremental re-runs slow.

- require to import migration: several source files used CommonJS `require()` inside an ESM project; `scripts/test.ts` failed with dynamic-require errors until the calls were migrated to `import`.
  Resolved: 07b9a54 2026-04-06

- auto-generated registries drift: `references/registries/path-registry.csv` and `permission-bypass-registry.md` fell out of sync with source when contributors skipped `npm test`; stale registry caused false-negative path checks.
  Resolved: 13dcf5a 2026-04-08, 68ad46d 2026-04-10

- extract_paths.py mutates working tree: running `extract_paths.py` directly rewrites `references/registries/path-registry.csv` in-place; a mid-test invocation dirtied the working tree and caused `git diff --exit-code` checks to fail spuriously.

- CLI shortcut for single test file: no flag existed to run one test file in isolation via `scripts/test.ts`; contributors ran full suites to verify a single change.
  Resolved: 58db7e9 2026-04-07
