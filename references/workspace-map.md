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
|  feedback.md     |       |  catalog.csv      |       | Writes:          |
|  sessions/ (dir) |       |                   |       |  sessions/*.json |
+------------------+       | Writes:           |       |  profile.json    |
                           |  sims/{id}/*      |       |  catalog.csv     |
+------------------+       |  sims/registry    |       |  journal.md      |
|   /feedback      |       |  sims/index.md    |       +------------------+
|  (command)       |       |  catalog.csv      |
|                  |       +-------------------+       +------------------+
| Reads:           |                                   |     /fix         |
|  sessions/*.json |       +-------------------+       |  (skill)         |
|                  |       |   web/ app        |       |                  |
| Writes:          |       |  (Express + UI)   |       | Reads:           |
|  feedback.md     |       |                   |       |  feedback.md     |
|  sessions/*.json |       | Reads:            |       |  activity.jsonl  |
+------------------+       |  catalog.csv      |       |  health scores   |
                           |  sims/registry    |       |  skill files     |
                           |  sims/{id}/*      |       |  workspace-map   |
                           |  profile.json     |       |  metrics.config  |
                           |  sessions/*.json  |       |                  |
                           |  journal.md       |       | Writes:          |
                           |  agent-prompts    |       |  skill files     |
                           |  themes/*.md      |       |  feedback.md     |
                           |  coaching-patt.   |       |  health-scores   |
                           |                   |       |  metrics.config  |
                           | Writes:           |       +------------------+
                           |  coaching-patt.   |
                           |                   |
                           | Writes:           |
                           |  (via Claude      |
                           |   subprocess)     |
                           |  sessions/*.json  |
                           |  profile.json     |
                           |  catalog.csv      |
                           |  journal.md       |
                           +-------------------+
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
/fix ---------> reads feedback.md + learning/logs/activity.jsonl + health scores
            --> reads test-results/summary.json (if exists) for recent test failures
            --> runs node scripts/code-health.js (before, after each edit, final)
            --> reads + writes skill files (.claude/skills/**)
            --> writes learning/logs/health-scores.jsonl (per-edit + final scores)
            --> clears feedback.md
            --> updates scripts/metrics.config.json (last_fix_analyzed timestamp)

sim-test ----> run: executes node --test + design contract checks
           --> agent: reads test-specs/browser/*.yaml, prints prompts for Chrome DevTools MCP
           --> personas: reads test-specs/personas/*.json, prints prompts for exploration
           --> personas --feedback: reads test-results/personas/, appends to feedback.md
           --> design generate: captures screenshots + a11y, updates design/manifest.json
           --> design extract: parses Stitch HTML into design/contracts/*.json
           --> summary: aggregates test-results/ into test-results/summary.json
```

## Shared Data Files

| File | Written by | Read by | Format |
|------|-----------|---------|--------|
| `learning/catalog.csv` | setup, create-sim, play | create-sim, play | CSV: service, full_name, category, cert_relevance, knowledge_score, sims_completed, last_practiced, notes |
| `learning/profile.json` | setup, play | play | JSON: level, completed sims, patterns, strengths, weaknesses |
| `learning/journal.md` | setup, play | (reference) | Markdown: per-sim learning entries |
| `learning/feedback.md` | setup, feedback | fix | Markdown: timestamped feedback entries |
| `learning/sessions/*.json` | play, feedback | play, feedback | JSON: in-progress sim state |
| `learning/logs/activity.jsonl` | hooks, web logger | fix | JSONL: tool calls, session events, prompts, failures, compaction |
| `learning/logs/health-scores.jsonl` | fix | fix | JSONL: per-edit and final code health scores with source tags |
| `scripts/metrics.config.json` | fix | `scripts/code-health.js`, fix | JSON: health score weights and last_fix_analyzed timestamp |
| `sims/registry.json` | create-sim | setup, play, create-sim | JSON: array of sim metadata |
| `design/manifest.json` | `scripts/generate-design-refs.js` | `web/test/design-integrity.test.js` | JSON: SHA256 checksums of design files |
| `design/thresholds.json` | (manual) | `sim-test design check` | JSON: pass/fail thresholds for design contracts |
| `test-results/summary.json` | `sim-test summary` | fix | JSON: aggregated test results across all layers |

## Tests

All tests run through the `sim-test` CLI (`scripts/sim-test.js`). See `references/testing-system.md` for full architecture.

### Layer 1: Deterministic (`sim-test run`)

| Type | Location | What it covers |
|------|----------|----------------|
| Unit | `web/test/server.test.js` | All API endpoints, SSE game routes, 503/400 responses |
| Unit | `web/test/logger.test.js` | logEvent, generateFixManifest, checkThresholds (context, latency, tool loop) |
| Unit | `web/test/claude-process.test.js` | parseStreamJson, verifyAutosave, sendMessage SESSION_LOST, endSession cleanup |
| Unit | `web/test/prompt-builder.test.js` | buildPrompt, all themes, all sims, error messages, marker injection |
| Unit | `web/test/log-hook.test.js` | buildRecord event enrichment, all 9 event types |
| Unit | `web/test/guard-write.test.js` | checkAccess for protected files, dirs, safe paths, skill locks |
| Unit | `web/test/design-integrity.test.js` | SHA256 checksums for design files, manifest validation |
| Unit | `web/test/guard-coverage.test.js` | Verifies guard-write covers design/, test-specs/, CLI scripts |
| Unit | `web/test/code-health.test.js` | AST parsing, scoring functions, determinism, composite calculation |
| Design | `design/contracts/*.json` | Structural contract validation against `design/thresholds.json` |

### Layer 2: Agent Browser (`sim-test agent`)

| Spec | Location | What it covers |
|------|----------|----------------|
| navigation | `test-specs/browser/navigation.yaml` | Tab switching, aria-selected, settings modal open/close |
| dashboard | `test-specs/browser/dashboard.yaml` | Rank title, hexagon SVG, services section |
| sim-picker | `test-specs/browser/sim-picker.yaml` | Card rendering, keyboard nav, empty state, category borders |
| chat | `test-specs/browser/chat.yaml` | Chat flow, message types, send/quit, session complete |
| settings | `test-specs/browser/settings.yaml` | Dropdowns, theme switching, keyboard navigation |
| layout | `test-specs/browser/layout.yaml` | CSS layout assertions, responsive breakpoints, alignment |
| accessibility | `test-specs/browser/accessibility.yaml` | ARIA roles, attributes, focus order, keyboard nav |
| design-match | `test-specs/browser/design-match.yaml` | Screenshots vs Stitch design references |

### Layer 3: Agent Persona (`sim-test personas`)

| Persona | Location | Focus areas |
|---------|----------|-------------|
| impatient-beginner | `test-specs/personas/impatient-beginner.json` | Error handling, loading states, race conditions |
| hostile-user | `test-specs/personas/hostile-user.json` | XSS, input validation, API error handling |
| screen-reader-user | `test-specs/personas/screen-reader-user.json` | ARIA roles, live regions, focus management |
| power-user | `test-specs/personas/power-user.json` | State consistency, performance, concurrent operations |
| mobile-first-user | `test-specs/personas/mobile-first-user.json` | Responsive layout, touch targets, viewport overflow |

Results written to `test-results/` (gitignored). Use `sim-test summary` to aggregate.

## Impact Analysis Guide

When changing a component, check what else reads/writes the same data:

| If you change... | Also check... |
|---|---|
| `catalog.csv` format | setup (creates it), create-sim (reads + writes), play (reads + writes), web/ server.js (reads for dashboard) |
| `profile.json` format | setup (creates it), play (reads + writes), web/ server.js (reads for dashboard), web/ app.js (renders stats) |
| `manifest.json` schema | create-sim (generates), play (consumes), manifest-schema.json (validates), web/ prompt-builder.js (populates template from manifest) |
| `agent-prompts.md` template | play (populates it from manifest data), web/ prompt-builder.js (must match all placeholders) |
| `coaching-patterns.md` | play (uses for post-game analysis + scoring) |
| `sim-template.md` | create-sim (gold-standard example for generation) |
| `sims/registry.json` format | setup (validates), create-sim (writes), play (reads for filtering), web/ server.js + app.js (reads for sim picker) |
| `sessions/*.json` format | play (reads + writes + deletes), feedback (writes), web/ server.js (reads for resume detection) |
| Theme files (themes/) | play (theme selection + injection + rendering), agent-prompts.md (voice placeholder), web/ prompt-builder.js (reads for prompt), web/ settings (lists for dropdown) |
| Resolution sections | create-sim (generates), play (delivers in Phase 4), sim-template.md (example) |
| `journal.md` format | play (writes entries), web/ server.js `/api/journal-summary` parser |
| UI theme CSS variable contract | web/ style.css (references all variables), all ui-themes/*.css files must define them |
