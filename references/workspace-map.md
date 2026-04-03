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
|  feedback.md     |       |  catalog.csv      |       |  .current-model  |
|  sessions/ (dir) |       |                   |       |  prompt-overlay* |
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
                           |  sims/registry    |       |  activity.jsonl  |
                           |  sims/{id}/*      |       |  health scores   |
                           |  profile.json     |       |  skill files     |
                           |  sessions/*.json  |       |  workspace-map   |
                           |  journal.md       |       |  metrics.config  |
                           |  agent-prompts    |       |                  |
                           |  themes/*.md      |       | Writes:          |
                           |  coaching-patt.   |       |  skill files     |
                           |                   |       |  feedback.md     |
                           | Writes:           |       |  eval-proposals  |
                           |  (via Claude      |       |  health-scores   |
                           |   subprocess)     |       |  metrics.config  |
                           |  sessions/*.json  |       +------------------+
                           |  profile.json     |
                           |  catalog.csv      |
                           |  journal.md       |
                           +-------------------+

+------------------+       +------------------+
|     /git         |       |  /fight-team     |
|  (skill)         |       |  (skill)         |
|                  |       |                  |
| Reads:           |       | Reads:           |
|  git history     |       |  everything      |
|  GitHub Issues   |       |  (workspace-wide |
|                  |       |   review)        |
| Writes:          |       |                  |
|  git commits     |       | Writes:          |
|  GitHub Issues   |       |  GitHub Issues   |
+------------------+       +------------------+
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
            --> reads learning/.current-model (tier selection: opus/sonnet/haiku)
            --> reads prompt-overlay-{size}.md (tier-specific prompt adjustments)
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
            --> writes learning/eval-proposals.md (staged proposals for eval YAML)
            --> writes learning/logs/health-scores.jsonl (per-edit + final scores)
            --> clears feedback.md
            --> updates scripts/metrics.config.json (last_fix_analyzed timestamp)

/git ---------> reads git history (git log --grep for action lines)
            --> reads GitHub Issues (gh issue list)
            --> writes git commits (contextual commit messages with action lines)
            --> writes GitHub Issues (gh issue create, auto-close via Closes #N)
            --> referenced by: /fix, /create-sim, /upgrade, /sim-test (commit procedure)

/fight-team --> reads everything (workspace-wide adversarial review)
            --> writes GitHub Issues (actionable findings from debate)
            --> /fix picks up issues in its gather phase (step 3b)

sim-test ----> run: executes node --test (unit tests)
           --> agent: reads test-specs/browser/*.yaml, prints prompts for Chrome DevTools MCP
           --> personas: reads test-specs/personas/*.json, prints prompts for exploration
           --> personas --feedback: reads test-results/personas/, appends to feedback.md
           --> summary: aggregates test-results/ into test-results/summary.json
```

## Transient Files

| File | Created by | Purpose | Lifetime |
|------|-----------|---------|----------|
| `/tmp/aws-sim-prompt-{sessionId}.txt` | `web/lib/claude-process.js` | System prompt passed to Claude subprocess via `--append-system-prompt-file` | Duration of Claude subprocess |

## Shared Data Files

| File | Written by | Read by | Format |
|------|-----------|---------|--------|
| `learning/catalog.csv` | setup, create-sim, play | create-sim, play | CSV: service, full_name, category, cert_relevance, knowledge_score, sims_completed, last_practiced, notes |
| `learning/profile.json` | setup, play | play | JSON: level, completed sims, patterns, strengths, weaknesses |
| `learning/journal.md` | setup, play | (reference) | Markdown: per-sim learning entries |
| `learning/feedback.md` | setup, feedback | fix | Markdown: timestamped feedback entries |
| `learning/eval-proposals.md` | fix | sim-test eval | Markdown: staged proposals for Layer 4 eval YAML conversion |
| `learning/.current-model` | log-hook | play | Plain text: model ID for tier selection (opus/sonnet/haiku) |
| `learning/sessions/*.json` | play, feedback | play, feedback | JSON: in-progress sim state |
| `learning/logs/activity.jsonl` | hooks, web logger | fix | JSONL: tool calls, session events, prompts, failures, compaction |
| `learning/logs/health-scores.jsonl` | fix | fix | JSONL: per-edit and final code health scores with source tags |
| `scripts/metrics.config.json` | fix | `scripts/code-health.js`, fix | JSON: health score weights and last_fix_analyzed timestamp |
| `sims/registry.json` | create-sim | setup, play, create-sim | JSON: array of sim metadata |
| `test-results/summary.json` | `sim-test summary` | fix | JSON: aggregated test results across all layers |

## Play Component: Prompt Overlays

The tier system uses `learning/.current-model` to select prompt overlays:

| Model tier | Overlay file | Effect |
|-----------|-------------|--------|
| large (opus) | (none, full prompt) | All capabilities enabled |
| medium (sonnet) | `.claude/skills/play/references/prompt-overlay-medium.md` | Reduced prompt complexity |
| small (haiku) | `.claude/skills/play/references/prompt-overlay-small.md` | Minimal prompt for constrained models |

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
| Unit | `web/test/guard-coverage.test.js` | Verifies guard-write covers test-specs/, CLI scripts |
| Unit | `web/test/code-health.test.js` | AST parsing, scoring functions, determinism, composite calculation |
| Unit | `web/test/audit-permissions.test.js` | Cross-checks for permission bypass patterns |
| Unit | `web/test/cross-file-consistency.test.js` | Validates data consistency across files |
| Unit | `web/test/eval-runner.test.js` | Tests Layer 4 eval YAML generation |
| Unit | `web/test/git-commit-format.test.js` | Validates commit message format (action lines) |
| Unit | `web/test/markdown.test.js` | Markdown parsing and format validation |
| Unit | `web/test/path-registry.test.js` | Path-registry.csv consistency checks |
| Unit | `web/test/progress.test.js` | Player progress tracking |
| Unit | `web/test/progression.test.js` | Rank progression and polygon calculations |
| Unit | `web/test/setup-consistency.test.js` | Validates /setup command integrity |
| Unit | `web/test/transcript.test.js` | Session transcript format |

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
| `.claude/skills/git/references/*` | /fix (commits per change), /create-sim (commit phase), /upgrade (git discipline section), /sim-test (commit phase), CLAUDE.md (git discipline section) |
| GitHub Issues | /git (creates), /fix (reads in step 3b, creates in step 6b), /fight-team (creates from debate findings) |
| `learning/.current-model` | log-hook (writes on SessionStart), play (reads for tier selection) |
| `learning/eval-proposals.md` | fix (writes proposals), sim-test eval (reads for YAML conversion) |
| Prompt overlays | play (reads based on tier), prompt-overlay-medium.md and prompt-overlay-small.md in play/references/ |
