---
tags:
  - type/reference
  - scope/testing
---

# Testing System Architecture

Reference for the four-layer testing system. Agents interact only through the `sim-test` CLI boundary.

## Overview

```
  Agent Side                    |  System Side (protected)
                                |
  sim-test run ----------------->  unit tests
  sim-test agent --------------->  test-specs/browser/*.yaml
  sim-test personas ------------>  test-specs/personas/*.json
  sim-test evals --------------->  references/eval-scoring.yaml
  sim-test validate ------------>  all layers in sequence
                                |
  stdout (text or JSON) <--------  test-results/
  exit code (0, 1, 2) <---------  pass / fail / infra error
```

Agents interact only via `sim-test` commands and stdout. Everything on the system side (reference files, specs, generation scripts) is protected from direct editing.

## CLI Commands

All commands support `--json` for structured output.

### Test execution

```
sim-test run                  # run unit tests
sim-test run --json           # structured JSON output
```

### Agent browser tests (Layer 2)

```
sim-test agent                # run all browser specs
sim-test agent --spec nav     # run a specific spec by name
sim-test agent --dry-run      # print prompts without executing
```

### Persona tests (Layer 3)

```
sim-test personas             # run all persona profiles
sim-test personas --id hostile   # run a specific persona
sim-test personas --feedback     # push findings to learning/feedback.md
```

### Evals (Layer 4)

```
sim-test evals                        # score a random completed session
sim-test evals --sim <id>             # score a specific session
sim-test evals --llm                  # include LLM judgment checks
sim-test evals --dry-run              # list all 60 checks by category
sim-test evals --json                 # structured output
```

### Validate (all layers)

```
sim-test validate             # run all 4 layers in sequence
sim-test validate --quick     # skip persona tests
```

### Summary

```
sim-test summary              # aggregate results into test-results/summary.json
```

### Exit codes

- 0: all checks passed
- 1: one or more checks failed
- 2: infrastructure error (missing deps, browser crash, MCP unavailable)

## Directory Layout

```
test-specs/                Protected: declarative test definitions
  browser/                 Layer 2: YAML browser test specs (8 files)
  personas/                Layer 3: persona profiles (5 files)

test-results/              Writable by test skill (gitignored)
  browser/                 Layer 2 results
  personas/                Layer 3 findings
  evals/                   Layer 4 eval results (JSON per eval)
  validate.json            Full validation run results
  summary.json             Aggregated by sim-test summary

references/
  eval-scoring.yaml           Layer 4: 60-check eval scorecard
```

## File Format Schemas

### YAML Browser Spec

```yaml
name: string
description: string
setup:
  navigate: string (URL path)
steps:
  - id: string
    action: click|type|keyboard|emulate|wait (optional)
    target: string (CSS selector, for click/type)
    text: string (for type action)
    key: string (for keyboard action)
    viewport: string (for emulate, e.g. "375x667")
    ms: number (for wait action)
    check:
      - selector: string
        has_class: string
        not_has_class: string
        attribute: object
        text_contains: string
        visible: boolean
        css_property: object
        min_count: number
        screenshot_compare:
          compare_to: string (path to reference image)
```

### Persona Profile (JSON)

Required fields: `id`, `name`, `role`, `description`, `behaviors` (array), `focus_areas` (array), `evaluation_questions` (array), `session_minutes` (number).

### Transcript Format

Each line in `learning/sessions/{sim_id}/transcript.jsonl` is a JSON object:

| Field | Type | Description |
|-------|------|-------------|
| turn | number | 1-indexed turn number |
| role | string | "player" or "narrator" |
| text | string | Message content |
| ts | string | ISO 8601 timestamp |
| console | object | Parsed console block (if present) |
| coaching | string | Coaching feedback (if present) |
| usage | object | Token usage: { input_tokens, output_tokens } |

### Persona Result Format

Each persona run writes findings to `test-results/personas/{persona-id}-{timestamp}.json`:

| Field | Type | Description |
|-------|------|-------------|
| persona_id | string | Matches profile id |
| timestamp | string | ISO 8601 |
| findings | array | Array of { severity, description, selector, screenshot } |
| evaluation | object | Answers to evaluation_questions from profile |
| duration_seconds | number | Actual session length |

## Four Testing Layers

1. **Layer 1 (Deterministic):** `sim-test run` executes unit tests. No browser needed.
2. **Layer 2 (Agent Browser):** `sim-test agent` loads YAML specs and prints prompts. The agent uses Chrome DevTools MCP to interact with the browser.
3. **Layer 3 (Persona):** `sim-test personas` loads profiles and prints prompts. The agent explores freely via Chrome DevTools MCP.
4. **Layer 4 (Evals):** `sim-test evals` runs a 60-check scorecard against completed play sessions. Checks are in `references/eval-scoring.yaml` across 11 categories: scoring integrity, console purity, leak prevention, coaching accuracy, hint delivery, question classification, session integrity, debrief quality, narrator behavior, progression, and narrator quality.
   - **Deterministic checks:** Run against session.json and transcript.jsonl data. Instant, no LLM needed.
   - **LLM judgment checks:** Optional, evaluate narrator quality with an LLM judge. Triggered with `--llm` flag.

### Eval Scenario Schema

```yaml
name: string
id: string
track: deterministic | judgment
sim_id: string
category: scoring | coaching | console | progression | edge-case | enablement
fixture:                          # Track A
  session_state: object
  profile: object
  manifest_services: array
assertions:
  - type: equals | range | contains | not_contains | matches_rule
    target: string                # dot-path into computed data
    expected: any
transcript:                       # Track B
  - role: player | narrator
    message: string
rubric:
  dimensions:
    - name: string
      weight: number
      criteria: string
      fail_below: number
  passing_score: number
```

### Execution Model

| Level | Trigger | What runs |
|---|---|---|
| Per-commit | Automatic | `npm test` |
| Feature-complete | Automatic (end of /fix) | `sim-test validate` |
| Model change | User-triggered | `sim-test evals --llm` |

## Anti-Cheat Enforcement

### What agents can do

- Run deterministic tests: `sim-test run`
- Execute browser specs: `sim-test agent` (uses Chrome DevTools MCP)
- Run persona tests: `sim-test personas` (uses Chrome DevTools MCP)
- Read test results: read files in `test-results/`
- Push persona findings to feedback: `sim-test personas --feedback`

### What agents cannot do

- Edit unit test files during skill execution: skill-active check blocks `web/test/`

## Findings to Feedback Pipeline

1. Agent runs `sim-test personas` and writes findings to `test-results/personas/{id}-{timestamp}.json`.
2. `sim-test personas --feedback` reads findings and appends to `learning/feedback.md`.
3. The `/fix` skill reads `learning/feedback.md` and applies improvements.

## MCP Servers

- **Chrome DevTools MCP:** browser interaction for agent and persona tests.
