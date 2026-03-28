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
|  sessions/*.json |       +-------------------+       |  (command)       |
|                  |       |   web/ app        |       |                  |
| Writes:          |       |  (Express + UI)   |       | Reads:           |
|  feedback.md     |       |                   |       |  feedback.md     |
|  sessions/*.json |       | Reads:            |       |  skill files     |
+------------------+       |  catalog.csv      |       |  workspace-map   |
                           |  sims/registry    |       |  learning/logs/  |
                           |  sims/{id}/*      |       |                  |
                           |  profile.json     |       |                  |
                           |  sessions/*.json  |       | Writes:          |
                           |  journal.md       |       |  skill files     |
                           |  agent-prompts    |       |  feedback.md     |
                           |  themes/*.md      |       +------------------+
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
/fix ---------> reads feedback.md + learning/logs/activity.jsonl
            --> reads + writes skill files (.claude/skills/**)
            --> clears feedback.md
```

## Shared Data Files

| File | Written by | Read by | Format |
|------|-----------|---------|--------|
| `learning/catalog.csv` | setup, create-sim, play | create-sim, play | CSV: service, full_name, category, cert_relevance, knowledge_score, sims_completed, last_practiced, notes |
| `learning/profile.json` | setup, play | play | JSON: level, completed sims, patterns, strengths, weaknesses |
| `learning/journal.md` | setup, play | (reference) | Markdown: per-sim learning entries |
| `learning/feedback.md` | setup, feedback | fix | Markdown: timestamped feedback entries |
| `learning/sessions/*.json` | play, feedback | play, feedback | JSON: in-progress sim state |
| `learning/logs/activity.jsonl` | hooks, web logger | fix | JSONL: tool calls, session events, warnings, fix manifests |
| `sims/registry.json` | create-sim | setup, play, create-sim | JSON: array of sim metadata |

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
