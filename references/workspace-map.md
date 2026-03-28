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
|  sessions/*.json |                                   |  (command)       |
|                  |                                   |                  |
| Writes:          |                                   | Reads:           |
|  feedback.md     |                                   |  feedback.md     |
|  sessions/*.json |                                   |  skill files     |
+------------------+                                   |  workspace-map   |
                                                       |                  |
                                                       | Writes:          |
                                                       |  skill files     |
                                                       |  feedback.md     |
                                                       +------------------+
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
/fix ---------> reads feedback.md
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
| `sims/registry.json` | create-sim | setup, play, create-sim | JSON: array of sim metadata |

## Impact Analysis Guide

When changing a component, check what else reads/writes the same data:

| If you change... | Also check... |
|---|---|
| `catalog.csv` format | setup (creates it), create-sim (reads + writes), play (reads + writes) |
| `profile.json` format | setup (creates it), play (reads + writes) |
| `manifest.json` schema | create-sim (generates), play (consumes), manifest-schema.json (validates) |
| `agent-prompts.md` template | play (populates it from manifest data) |
| `coaching-patterns.md` | play (uses for post-game analysis + scoring) |
| `sim-template.md` | create-sim (gold-standard example for generation) |
| `sims/registry.json` format | setup (validates), create-sim (writes), play (reads for filtering) |
| `sessions/*.json` format | play (reads + writes + deletes), feedback (writes) |
| Theme files (themes/) | play (theme selection + injection + rendering), agent-prompts.md (voice placeholder) |
| Resolution sections | create-sim (generates), play (delivers in Phase 4), sim-template.md (example) |
