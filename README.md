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

  style Q fill:#e8edf5,stroke:#7b8ba3,color:#2d3748
  style H fill:#dce5f0,stroke:#7b8ba3,color:#2d3748
  style R fill:#c5d5e8,stroke:#6b7d94,color:#2d3748
  style Gather fill:#e0eaed,stroke:#8fa4af,color:#2d3748
  style Diagnose fill:#e0eaed,stroke:#8fa4af,color:#2d3748
  style Correlate fill:#e0eaed,stroke:#8fa4af,color:#2d3748
  style Impact fill:#e0eaed,stroke:#8fa4af,color:#2d3748
  style Trace fill:#e0eaed,stroke:#8fa4af,color:#2d3748
  style Fix fill:#e0eaed,stroke:#8fa4af,color:#2d3748
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
    Doc["/doc"]
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
    Reflector[Reflector]
  end

  Player --> Play
  Player --> Setup
  Play --> Express
  Express --> Claude
  Play --> PlayerVault
  Setup --> PlayerVault
  PlayerVault --> CreateSim
  Fix --> Issues
  Doc --> Issues
  CreateSim --> Issues
  Issues --> Planner
  Planner --> Critic
  Critic --> Implementer
  Implementer --> Verifier
  Verifier -->|auto-merge| Issues
  Verifier --> Reflector
  Reflector --> SystemVault

  style Player fill:#e8edf5,stroke:#7b8ba3,color:#2d3748
  style Issues fill:#d4dde8,stroke:#8494a7,color:#2d3748
  style Skills fill:#e0eaed,stroke:#8fa4af,color:#2d3748
  style Memory fill:#dce0e8,stroke:#8b95a5,color:#2d3748
  style Web fill:#d8e2e8,stroke:#849aaa,color:#2d3748
  style Pipeline fill:#cdd8e4,stroke:#7b8da0,color:#2d3748
  style Setup fill:#e0eaed,stroke:#8fa4af,color:#2d3748
  style Play fill:#e0eaed,stroke:#8fa4af,color:#2d3748
  style Fix fill:#e0eaed,stroke:#8fa4af,color:#2d3748
  style Doc fill:#e0eaed,stroke:#8fa4af,color:#2d3748
  style CreateSim fill:#e0eaed,stroke:#8fa4af,color:#2d3748
  style PlayerVault fill:#dce0e8,stroke:#8b95a5,color:#2d3748
  style SystemVault fill:#dce0e8,stroke:#8b95a5,color:#2d3748
  style Express fill:#d8e2e8,stroke:#849aaa,color:#2d3748
  style Claude fill:#d8e2e8,stroke:#849aaa,color:#2d3748
  style Planner fill:#cdd8e4,stroke:#7b8da0,color:#2d3748
  style Critic fill:#c5d0de,stroke:#7385a0,color:#2d3748
  style Implementer fill:#bdc9d8,stroke:#6b7d94,color:#2d3748
  style Verifier fill:#b5c2d2,stroke:#63758a,color:#2d3748
  style Reflector fill:#adb9d0,stroke:#5b6d80,color:#2d3748
```

## The pieces

**Player vault.** Your personal knowledge graph. Session journals, concept notes, service pages, behavioral patterns. One per player, grows with you.

**System vault.** Long-term agent memory. What the system has learned about itself: findings, decisions, workarounds.

**Web app.** The play interface. Built with the Anthropic Agent SDK. Sonnet handles interactive narration. Opus handles post-session learning analysis.

**Pipeline.** The pipeline uses different Claude models per stage, with Opus reserved for reasoning-heavy work. Label an issue `needs-plan` and the pipeline takes over. A planner posts a structured plan, then the issue flips to `needs-critique`. An Opus critic challenges it adversarially and either approves (`needs-impl`) or bounces it back (`needs-plan`). An implementer writes the code with TDD, pushes a branch, and flips to `needs-verify`. A verifier checks the diff against the plan, runs every test suite, opens a PR, auto-merges, and flips to `needs-reflection`. An Opus pass on `needs-reflection` reads the full issue chain and writes learnings into the shared system vault. The whole cycle runs without human intervention.

**Testing.** Deterministic unit tests run on every PR in CI. Agent-in-the-loop browser tests drive a real Chromium instance through Chrome DevTools MCP, so UI assertions land against the actual DOM. Sixty eval checks grade scoring integrity, coaching accuracy, hint delivery, and narrator quality.

**Health score.** A composite across ten buckets that measures code quality. Floors only ever rise, so regressions are caught automatically.

**Sim authoring.** The `/create-sim` skill reads your player vault to find confusion patterns and weak dimensions, then generates scenarios targeting your specific gaps. Personalized learning, not random coverage.

**MCP integration.** The simulator queries the AWS Knowledge MCP server for real AWS facts, so the best practices it teaches stay current.

**Types everywhere.** TypeScript on the web side, Python with strict type hints on the data side. Both enforced by their respective type checkers in CI.
