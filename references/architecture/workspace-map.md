---
tags:
  - type/reference
  - scope/architecture
---

# Workspace Component Map

C4-style component diagram for impact analysis. Read this before making cross-cutting changes.

## Component Diagram

```
+------------------+       +-------------------+       +------------------+
|    /setup        |       |    /create-sim    |       |     /play        |
|  (command)       |       |  (skill)          |       |   (skill)        |
|                  |       |                   |       |                  |
| Reads:           |       | Reads:            |       | Reads:           |
|  catalog.csv     |       |  catalog.csv      |       |  catalog.csv     |
|  sims/registry   |       |  sims/registry    |       |  sims/registry   |
|  .mcp.json       |       |  exam-topics.md   |       |  sims/{id}/*     |
|                  |       |  sim-template.md  |       |  profile.json    |
| Writes:          |       |  story-struct.md  |       |  sessions/*.json |
|  profile.json    |       |  themes/_base.md  |       |  agent-prompts   |
|  catalog.csv     |       |  game-design.md   |       |  coaching-patt.  |
|  journal.md      |       |  manifest-schema  |       |  themes/*.md     |
|  feedback.md     |       |  catalog.csv      |       |                  |
|  sessions/ (dir) |       |                   |       |                  |
+------------------+       | Writes:           |       | Writes:          |
                           |  sims/{id}/*      |       |  sessions/*.json |
+------------------+       |  sims/registry    |       |  profile.json    |
|   /feedback      |       |  sims/index.md    |       |  catalog.csv     |
|  (command)       |       |  catalog.csv      |       |  journal.md      |
|                  |       +-------------------+       +------------------+
| Reads:           |
|  sessions/*.json |       +-------------------+       +------------------+
|                  |       |   web/ app        |       |     /fix         |
| Writes:          |       |  (Express + UI)   |       |  (skill)         |
|  feedback.md     |       |                   |       |                  |
|  sessions/*.json |       | Reads:            |       | Reads:           |
+------------------+       |  catalog.csv      |       |  feedback.md     |
                           |  sims/registry    |       |  raw.jsonl       |
                           |  sims/{id}/*      |       |  health scores   |
                           |  profile.json     |       |  skill files     |
                           |  sessions/*.json  |       |  workspace-map   |
                           |  journal.md       |       |  metrics.config  |
                           |  agent-prompts    |       |                  |
                           |  themes/*.md      |       | Writes:          |
                           |  coaching-patt.   |       |  skill files     |
                           |                   |       |  feedback.md     |
                           | Writes:           |       |  health-scores   |
                           |  (via Claude      |       |                  |
                           |   subprocess)     |       +------------------+
                           |  sessions/*.json  |
                           |  profile.json     |
                           |  catalog.csv      |
                           |  journal.md       |
                           +-------------------+

+------------------+
|  /fight-team     |
|  (skill)         |
|                  |
| Reads:           |
|  everything      |
|  (workspace-wide |
|   review)        |
|                  |
| Writes:          |
|  GitHub Issues   |
+------------------+

+----------------------+
|   system-vault       |
|  (long-term agent    |
|   memory, per user,  |
|   gitignored)        |
|                      |
| Compiled by:         |
|  daily cron from     |
|  raw.jsonl           |
|                      |
| Subdirs:             |
|  findings/           |
|  decisions/          |
|  workarounds/        |
|  components/         |
|  sessions/           |
|  health/             |
|  dreams/             |
|                      |
| Read by:             |
|  system-vault-query  |
|  /fight-team         |
|  /fix                |
+----------------------+
```

## Data Flow

```
/setup --> catalog.csv, profile.json, journal.md, feedback.md, sessions/
                |
                v
/create-sim --> reads catalog.csv (gap analysis)
            --> writes sims/{id}/* (new sim packages)
            --> writes sims/registry.json, sims/index.md
            --> writes catalog.csv (adds new services discovered during research)
                |
                v
/play --------> reads sims/{id}/* + catalog.csv + profile.json
            --> writes sessions/{id}.json (auto-save every interaction)
            --> on resolution: writes profile.json, catalog.csv, journal.md
            --> deletes sessions/{id}.json
                |
                v
/feedback ----> writes feedback.md + sessions/{id}.json (during play)
                |
                v
/fix ---------> reads feedback.md + learning/logs/raw.jsonl + health scores
            --> reads web/test-results/summary.json (if exists) for recent test failures
            --> runs tsx scripts/code-health.ts (before, after each edit, final)
            --> reads + writes skill files (.claude/skills/**)
            --> writes learning/logs/health-scores.jsonl (per-edit + final scores)
            --> clears feedback.md
            --> updates scripts/metrics.config.json (last_fix_analyzed timestamp)

/fight-team --> reads everything (workspace-wide adversarial review)
            --> writes GitHub Issues (actionable findings from debate)
            --> /fix picks up issues in its gather phase (step 3b)

test ----> run: executes node --test (unit tests)
           --> agent: reads web/test-specs/browser/*.yaml, prints prompts for Chrome DevTools MCP
           --> summary: aggregates web/test-results/ into web/test-results/summary.json
```

## Transient Files

| File | Created by | Purpose | Lifetime |
|------|-----------|---------|----------|
| `/tmp/aws-sim-prompt-{sessionId}.txt` | `web/lib/claude-process.ts` | System prompt passed to Claude subprocess via `--append-system-prompt-file` | Duration of Claude subprocess |

## Shared Data Files

| File | Written by | Read by | Format |
|------|-----------|---------|--------|
| `learning/catalog.csv` | setup, create-sim, play | create-sim, play | CSV: service, full_name, category, cert_relevance, knowledge_score, sims_completed, last_practiced, notes |
| `learning/profile.json` | setup, play | play | JSON: level, completed sims, patterns, strengths, weaknesses |
| `learning/player-vault/sessions/` | setup, play | (reference) | Markdown: per-sim vault session entries |
| `learning/feedback.md` | setup, feedback | fix | Markdown: timestamped feedback entries |
| `learning/sessions/*.json` | play, feedback | play, feedback | JSON: in-progress sim state |
| `learning/logs/raw.jsonl` | hooks, web logger | fix, system-vault-compile | JSONL: unified event stream (session lifecycle, tool calls, warnings, errors). Legacy `activity.jsonl` and `system.jsonl` aliases via `web/lib/paths.ts`. |
| `learning/logs/health-scores.jsonl` | fix | fix | JSONL: per-edit and final code health scores with source tags |
| `learning/system-vault/` | setup (seed), system-vault-compile, system-vault-dream, system-vault-prune | system-vault-query, fight-team | Per-user, gitignored long-term system memory: findings, decisions, workarounds, components, sessions, health, dreams. Compiled daily from `learning/logs/raw.jsonl`. Index capped at 200 lines, topic files capped at 4KB. |
| `scripts/metrics.config.json` | fix | `scripts/code-health.ts`, fix | JSON: health score weights and last_fix_analyzed timestamp |
| `sims/registry.json` | create-sim | setup, play, create-sim | JSON: array of sim metadata |
| `web/test-results/summary.json` | `test summary` | fix | JSON: aggregated test results across all layers |

### Model split

The Sonnet/Opus split is hardcoded via two named constants in `web/lib/claude-process.ts`: `PLAY_SESSION_MODEL` (claude-sonnet-4-6) drives interactive play, and `POST_SESSION_MODEL` (claude-opus-4-6) drives post-session scoring. Sonnet is fast and cheap enough for narrator plus investigation reasoning; Opus runs cross-file analysis (session.json, manifest, coaching-patterns, progression) where deeper reasoning matters. Do not flip these without an A/B test on quality. See Issue #107.

## Scheduled Jobs and Hooks

Tracked manifests under `.claude/scheduled-jobs/` define RemoteTrigger crons with explicit `allowed_tools` so unattended runs never prompt. Hook entries in `.claude/settings.json` follow the same no-wildcard rule. Both are enforced by `web/test/scheduled-jobs-boundary.test.ts` and `web/test/hook-permissions.test.ts`.

| Automation | Type | Trigger | Purpose | Source file |
|---|---|---|---|---|
| weekly-dream | cron | Sunday 03:30 local | Run system-vault-dream skill to consolidate `learning/system-vault/`. Empty-vault guard: skip if vault has fewer than 5 topic files. | `.claude/scheduled-jobs/weekly-dream.json` |
| system-vault-compile chain | hook (PostCommit) | after every commit | Re-run `system-vault-compile` and append to `learning/logs/health-scores.jsonl` | `.claude/settings.json` |
| pre-commit-ui-tests | hook (pre-commit) | before every commit touching `web/public/**`, `web/server.ts`, `web/test-specs/browser/**` | Enforce `test agent` browser test pass | `.claude/settings.json` |
| pre-commit-issues | hook (pre-commit) | before every commit | Require Closes/Ref/Fixes/Part of issue reference; block deletion of `learning/logs/health-scores.jsonl` (PR-C invariant 6) | `.claude/hooks/pre-commit-issues.ts` |

State file backing these automations: `.claude/state/vault-circuit.json` (compile/dream failure circuit breaker). Tracked and seeded by PR-Pre.

GitHub secret-scanning exclusions live in `.github/secret_scanning.yml`. `sims/**` is path-ignored so fictional incident fixtures (fake CloudTrail snapshots, resolution writeups, fake config JSON) never trip the scanner. See Issue #126.

## Tests

All tests run through the `test` CLI (`scripts/test.ts`). See `references/architecture/testing-system.md` for full architecture.

### Layer 1: Deterministic (`test run`)

| Type | Location | What it covers |
|------|----------|----------------|
| Unit | `web/test/server.test.ts` | All API endpoints, SSE game routes, 503/400 responses |
| Unit | `web/test/logger.test.ts` | logEvent, generateFixManifest, checkThresholds (context, latency, tool loop) |
| Unit | `web/test/claude-process.test.ts` | parseStreamJson, verifyAutosave, sendMessage SESSION_LOST, endSession cleanup |
| Unit | `web/test/prompt-builder.test.ts` | buildPrompt, all themes, all sims, error messages, marker injection |
| Unit | `web/test/log-hook.test.ts` | buildRecord event enrichment, all 9 event types |
| Unit | `web/test/guard-write.test.ts` | checkAccess for protected files, dirs, safe paths, skill locks |
| Unit | `web/test/guard-coverage.test.ts` | Verifies guard-write covers web/test-specs/, CLI scripts |
| Unit | `web/test/code-health.test.ts` | AST parsing, scoring functions, determinism, composite calculation |
| Unit | `web/test/audit-permissions.test.ts` | Cross-checks for permission bypass patterns |
| Unit | `web/test/cross-file-consistency.test.ts` | Validates data consistency across files |
| Unit | `web/test/eval-runner.test.ts` | Tests Layer 4 eval YAML generation |
| Unit | `web/test/git-commit-format.test.ts` | Validates commit message format (action lines) |
| Unit | `web/test/markdown.test.ts` | Markdown parsing and format validation |
| Unit | `web/test/path-registry.test.ts` | Path-registry.csv consistency checks |
| Unit | `web/test/progress.test.ts` | Player progress tracking |
| Unit | `web/test/progression.test.ts` | Rank progression and polygon calculations |
| Unit | `web/test/setup-consistency.test.ts` | Validates /setup command integrity |
| Unit | `web/test/transcript.test.ts` | Session transcript format |

### Layer 2: Agent Browser (`test agent`)

| Spec | Location | What it covers |
|------|----------|----------------|
| navigation | `web/test-specs/browser/navigation.yaml` | Tab switching, aria-selected, settings modal open/close |
| dashboard | `web/test-specs/browser/dashboard.yaml` | Rank title, hexagon SVG, services section |
| sim-picker | `web/test-specs/browser/sim-picker.yaml` | Card rendering, keyboard nav, empty state, category borders |
| chat | `web/test-specs/browser/chat.yaml` | Chat flow, message types, send/quit, session complete |
| settings | `web/test-specs/browser/settings.yaml` | Dropdowns, theme switching, keyboard navigation |
| layout | `web/test-specs/browser/layout.yaml` | CSS layout assertions, responsive breakpoints, alignment |
| accessibility | `web/test-specs/browser/accessibility.yaml` | ARIA roles, attributes, focus order, keyboard nav |


Results written to `web/test-results/` (gitignored). Use `test summary` to aggregate.

## Impact Analysis Guide

When changing a component, check what else reads/writes the same data:

| If you change... | Also check... |
|---|---|
| `catalog.csv` format | setup (creates it), create-sim (reads + writes), play (reads + writes), web/ server.ts (reads for dashboard) |
| `profile.json` format | setup (creates it), play (reads + writes), web/ server.ts (reads for dashboard), web/ app.js (renders stats) |
| `manifest.json` schema | create-sim (generates), play (consumes), manifest-schema.json (validates), web/ prompt-builder.js (populates template from manifest) |
| `agent-prompts.md` template | play (populates it from manifest data), web/ prompt-builder.js (must match all placeholders) |
| `coaching-patterns.md` | play (uses for post-game analysis + scoring) |
| `sim-template.md` | create-sim (gold-standard example for generation) |
| `sims/registry.json` format | setup (validates), create-sim (writes), play (reads for filtering), web/ server.ts + app.js (reads for sim picker) |
| `sessions/*.json` format | play (reads + writes), feedback (writes), web/ server.ts (reads for resume detection) |
| Theme files (themes/) | play (theme selection + injection + rendering), agent-prompts.md (voice placeholder), web/ prompt-builder.js (reads for prompt), web/ settings (lists for dropdown) |
| Resolution sections | create-sim (generates), play (delivers in Phase 4), sim-template.md (example) |
| `journal.md` format | play (writes entries), web/ server.ts `/api/journal-summary` parser |
| UI theme CSS variable contract | web/ style.css (references all variables), all ui-themes/*.css files must define them |
| `references/architecture/core-workflow.md` | every skill (commit and merge discipline lives here now that /git has been removed) |
| GitHub Issues | /fix (sole creator, step 5b), /fight-team (creates from debate findings), /create-sim and /upgrade (create per core-workflow.md §1) |
