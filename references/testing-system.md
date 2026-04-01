---
tags:
  - type/reference
  - scope/testing
---

# Testing System Architecture

Reference for the three-layer testing system. Agents interact only through the `sim-test` CLI boundary.

## Overview

```
  Agent Side                    |  System Side (protected)
                                |
  sim-test run ----------------->  unit tests, design contracts
  sim-test design generate ----->  scripts/generate-design-refs.js
  sim-test design extract ------>  scripts/extract-design-contracts.js
  sim-test design check -------->  design/contracts/*.json
  sim-test agent --------------->  test-specs/browser/*.yaml
  sim-test personas ------------>  test-specs/personas/*.json
                                |
  stdout (text or JSON) <--------  test-results/
  exit code (0, 1, 2) <---------  pass / fail / infra error
```

Agents interact only via `sim-test` commands and stdout. Everything on the system side (reference files, specs, generation scripts) is protected from direct editing.

## CLI Commands

All commands support `--json` for structured output.

### Test execution

```
sim-test run                  # run unit + design tests
sim-test run --unit           # unit tests only
sim-test run --design         # design contract checks only
sim-test run --json           # structured JSON output
```

### Design management

```
sim-test design generate      # generate design references from Stitch
sim-test design extract       # extract structural contracts from references
sim-test design check         # validate live app against contracts
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
design/                    Protected: CLI writes here via scripts
  manifest.json            SHA256 checksums (tamper detection)
  thresholds.json          Pass/fail score thresholds
  stitch-screens/          Stitch design references (PNG + HTML)
  contracts/               Structural contracts (JSON)
  screenshots/             Live app captures
  a11y/                    Accessibility trees

test-specs/                Protected: declarative test definitions
  browser/                 Layer 2: YAML browser test specs (8 files)
  personas/                Layer 3: persona profiles (5 files)

test-results/              Writable by test skill (gitignored)
  browser/                 Layer 2 results
  personas/                Layer 3 findings
  summary.json             Aggregated by sim-test summary
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

### Design Contract (JSON)

Required sections: `name`, `elements` (array of `{selector, required, tag, min_count, non_empty}`), `aria` (array of `{selector, role, aria attributes}`).

### Thresholds (JSON)

Sections: `lighthouse` (`performance`, `accessibility`, `best_practices`, `seo`), `similarity` (`structural`, `visual`), `a11y` (`violations_max`, `contrast_ratio_min`).

## Three Testing Layers

1. **Layer 1 (Deterministic):** `sim-test run` executes unit tests and design contract checks. No browser needed.
2. **Layer 2 (Agent Browser):** `sim-test agent` loads YAML specs and prints prompts. The agent uses Chrome DevTools MCP to interact with the browser.
3. **Layer 3 (Persona):** `sim-test personas` loads profiles and prints prompts. The agent explores freely via Chrome DevTools MCP.

## Anti-Cheat Enforcement

### What agents can do

- Run deterministic tests: `sim-test run`
- Generate design references: `sim-test design generate`
- Extract contracts: `sim-test design extract`
- Check contracts: `sim-test design check`
- Execute browser specs: `sim-test agent` (uses Chrome DevTools MCP)
- Run persona tests: `sim-test personas` (uses Chrome DevTools MCP)
- Read test results: read files in `test-results/`
- Push persona findings to feedback: `sim-test personas --feedback`

### What agents cannot do

- Edit design reference files: `NEVER_WRITABLE_DIRS` includes `design/`
- Edit test specifications: `NEVER_WRITABLE_DIRS` includes `test-specs/`
- Edit unit test files during skill execution: skill-active check blocks `web/test/`
- Edit the CLI itself: `NEVER_WRITABLE` includes `scripts/sim-test.js`
- Edit generation scripts: `NEVER_WRITABLE` includes `scripts/generate-design-refs.js`, `scripts/extract-design-contracts.js`

## Findings to Feedback Pipeline

1. Agent runs `sim-test personas` and writes findings to `test-results/personas/{id}-{timestamp}.json`.
2. `sim-test personas --feedback` reads findings and appends to `learning/feedback.md`.
3. The `/fix` skill reads `learning/feedback.md` and applies improvements.

## MCP Servers

- **Chrome DevTools MCP:** browser interaction for agent and persona tests.
- **Stitch MCP:** design source of truth, pull references.
- **shadcn-ui MCP:** component registry browsing (CLI is default for installs).
