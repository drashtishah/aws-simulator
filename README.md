# AWS Incident Simulator

[![ci](https://github.com/drashtishah/aws-simulator/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/drashtishah/aws-simulator/actions/workflows/ci.yml)

A game about learning to ask good questions.

## How to play

Clone the repo. Run `/setup` in Claude Code once. Then run `/play`.

## What it scores

The simulator grades the path, not the answer. Every question you ask is classified into one of six dimensions. Your rank is the shape of the hexagon they form, not a single score.

```mermaid
flowchart LR
  Q[Your question] --> Gather
  Q --> Diagnose
  Q --> Correlate
  Q --> Impact
  Q --> Trace
  Q --> Fix
  Gather --> H[Hexagon shape]
  Diagnose --> H
  Correlate --> H
  Impact --> H
  Trace --> H
  Fix --> H
  H --> R[Rank]
```

## How it fits together

```mermaid
flowchart TB
  Player([Player])
  Issues[(GitHub Issues)]

  subgraph Skills[Claude Code skills]
    Setup["/setup"]
    Play["/play"]
    Fix["/fix"]
    CreateSim["/create-sim"]
  end

  subgraph Memory[Per-user memory]
    PlayerVault[(player vault)]
    SystemVault[(system vault)]
  end

  subgraph Web[Web app]
    Express[Express server]
    Claude[Claude Agent SDK]
  end

  subgraph Pipeline[GitHub Actions pipeline]
    Planner[Planner]
    Critic[Critic]
    Implementer[Implementer]
    Verifier[Verifier]
  end

  Player --> Play
  Player --> Setup
  Play --> Express
  Express --> Claude
  Play --> PlayerVault
  Setup --> PlayerVault
  Fix --> Issues
  Issues --> Planner
  Planner --> Critic
  Critic --> Implementer
  Implementer --> Verifier
  Verifier -->|auto-merge| Issues
```

## The pieces

**Player vault.** Your personal knowledge graph. Session journals, concept notes, service pages, behavioral patterns. One per player, grows with you.

**System vault.** Long-term agent memory. What the system has learned about itself: findings, decisions, workarounds.

**Web app.** The play interface. Built with the Anthropic Agent SDK. Sonnet handles interactive narration. Opus handles post-session learning analysis.

**Pipeline.** Every improvement flows through four GitHub Actions stages: a planner drafts the change, a critic challenges it, an implementer writes the code, and a verifier checks the work and merges automatically. You trigger it by labeling an issue `needs-plan`.

**Health score.** A composite across ten buckets that measures code quality. Floors only ever rise, so regressions are caught automatically.

**Sim authoring.** The `/create-sim` skill generates new simulation packages. It can target gaps in your learning profile, so the scenarios you practice are personalized to what you need most.

**MCP integration.** The simulator queries the AWS Knowledge MCP server for real AWS facts, so the best practices it teaches stay current. Browser tests run against a real Chromium instance via Chrome DevTools MCP.

**Evals.** Sixty graded checks across eleven categories: scoring integrity, coaching accuracy, hint delivery, question classification, narrator quality, and more. Run them with `test evals`.

**Types everywhere.** TypeScript on the web side, Python with strict type hints on the data side. Both enforced by their respective type checkers in CI.
