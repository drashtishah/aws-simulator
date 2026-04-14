---
tags:
  - type/reference
  - scope/testing
---

# Testing System Architecture

Reference for the four-layer testing system. Agents interact only through the `test` CLI boundary.

## Overview

```
  Agent Side                    |  System Side (protected)
                                |
  test run ----------------->  unit tests
  test agent --------------->  web/test-specs/browser/*.yaml
  test evals --------------->  references/config/eval-scoring.yaml
  test validate ------------>  all layers in sequence
                                |
  stdout (text or JSON) <--------  web/test-results/
  exit code (0, 1, 2) <---------  pass / fail / infra error
```

Agents interact only via `test` commands and stdout. Everything on the system side (reference files, specs, generation scripts) is protected from direct editing.

## CLI Commands

All commands support `--json` for structured output.

### Test execution

```
test run                  # run unit tests
test run --json           # structured JSON output
test run --changed --json # run ONLY tests affected by staged/last-commit changes
```

**Cadence (per `references/architecture/core-workflow.md` §6):** plans run `test run --changed` after every commit (~1 second), `npm test` at group boundaries (every 3-6 commits), and the full pre-PR gate (`npm test + npm run health + npm run doctor`) once before opening the PR. Plans never run `npm test` per commit.

### Agent browser tests (Layer 2)

```
test agent                # run all browser specs
test agent --spec nav     # run a specific spec by name
test agent --dry-run      # print prompts without executing
```

### Evals (Layer 4)

```
test evals                        # score a random completed session
test evals --sim <id>             # score a specific session
test evals --llm                  # include LLM judgment checks
test evals --dry-run              # list all 60 checks by category
test evals --json                 # structured output
```

### Validate (all layers)

```
test validate             # run all layers in sequence
```

### Summary

```
test summary              # aggregate results into web/test-results/summary.json
```

### Exit codes

- 0: all checks passed
- 1: one or more checks failed
- 2: infrastructure error (missing deps, browser crash, MCP unavailable)

## Directory Layout

```
web/test-specs/                Protected: declarative test definitions
  browser/                 Layer 2: YAML browser test specs (8 files)

web/test-results/              Writable by test skill (gitignored)
  browser/                 Layer 2 results
  evals/                   Layer 4 eval results (JSON per eval)
  validate.json            Full validation run results
  summary.json             Aggregated by test summary

references/
  eval-scoring.yaml           Layer 4: 60-check eval scorecard
```

## File Format Schemas

### Schema contracts

JSON schemas for test CLI output live at `web/lib/schemas/`. Validation runs in `web/test/test-schemas.test.ts` and smoke self-tests live at `web/test/test-selftest.test.ts`. Full rationale and evolution rules in `references/architecture/test-schemas.md` (Issue #31).

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

### Transcript Format

Each line in `learning/sessions/{sim_id}/turns.jsonl` is a JSON object:

| Field | Type | Description |
|-------|------|-------------|
| ts | string | ISO 8601 timestamp |
| turn | number | 1-indexed turn number |
| player_message | string | Player's input text |
| assistant_message | string | Narrator's response text |
| usage | object | Token usage (optional): `{ input_tokens, output_tokens }` |

## Testing Layers

1. **Layer 1 (Deterministic):** `test run` executes unit tests. No browser needed.
2. **Layer 2 (Agent Browser):** `test agent` loads YAML specs and prints prompts. The agent uses Chrome DevTools MCP to interact with the browser.
3. **Layer 4 (Evals):** `test evals` runs a 60-check scorecard against completed play sessions. Checks are in `references/config/eval-scoring.yaml` across 11 categories: scoring integrity, console purity, leak prevention, coaching accuracy, hint delivery, question classification, session integrity, debrief quality, narrator behavior, progression, and narrator quality.
   - **Deterministic checks:** Run against session.json and turns.jsonl data. Instant, no LLM needed.
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
| Feature-complete | Automatic (end of /fix) | `test validate` |
| Model change | User-triggered | `test evals --llm` |

## Anti-Cheat Enforcement

### What agents can do

- Run deterministic tests: `test run`
- Execute browser specs: `test agent` (uses Chrome DevTools MCP)
- Read test results: read files in `web/test-results/`

### What agents cannot do

- Edit unit test files during skill execution: skill-active check blocks `web/test/`

## MCP Servers

- **Chrome DevTools MCP:** browser interaction for agent browser tests.

## Internals: How `npm test` Runs

Knowing the wiring matters when a single test fails inside the aggregate `unit: N/M passed` summary. Since Issue #92, `test run` also prints `FAIL <basename>: <N> failure(s)` to stderr per failing file plus a final `Failed test files (N):` summary block, so the failing file is named in the output and you no longer have to bisect by hand.

### Pipeline

`npm test` (defined in `package.json`) chains four steps:

```
python3 scripts/extract_paths.py        # regenerate references/registries/path-registry.csv
mypy --strict scripts/extract_paths.py  # typecheck the path extractor
npm run typecheck                       # tsc --noEmit on tsconfig.json + tsconfig.frontend.json
tsx scripts/test.ts run             # run unit tests via the test CLI boundary
```

### Per-file test spawn

`test run` does NOT call `node --test` on the whole `web/test/` directory. Instead, `scripts/test.ts:270-318` reads every `web/test/*.test.ts` file and spawns each one in its own `tsx` subprocess:

```
spawnSync('tsx', ['--test', '--test-force-exit', testFile], { cwd: ROOT, ... })
```

Why per-file:

- Most test files have been migrated from `require()` to `import` (Issue #162). A few files retain `require()` for modules that read env vars at load time (`paths.ts`); these are documented inline. Plain `node --test` still cannot resolve bare `.ts` module paths, so tsx remains the test runtime. Smoke test alternative: `npx tsx --test --test-force-exit web/test/logger.test.ts` confirms ESM-only imports work outside the sim-test runner.
- A single `tsx --test web/test/*.test.ts` invocation hangs when multiple files share one process (see inline comment at `scripts/test.ts:270`).
- `--test-force-exit` ensures each subprocess exits even if a test leaves an open handle.

The runner parses `ℹ pass N` and `ℹ fail N` from each subprocess and aggregates into the `unit: N/M passed` summary line. Pure parsing and aggregation helpers live in `scripts/test-runner.ts` so they can be unit-tested without spawning the CLI recursively (`web/test/test-run.test.ts`); `node:test` refuses to run itself recursively from inside `tsx --test`, so the integration assertion is the manual verification step in Issue #92.

In JSON mode, the per-run result also exposes `unit.failedFiles: string[]` listing every failed file basename. Agents and CI can branch on that array directly without parsing stderr.

### Debugging a single failing test

`npm run test:file -- web/test/path-registry.test.ts` runs a single test file under `tsx --test --test-force-exit` without the PATH boilerplate. Use this whenever you want to iterate on one suite at a time.

Since the runner now names failing files in its output, the manual sweep below is rarely needed; keep it for cases where you want raw per-file output rather than the aggregate.

```
npm run test:file -- web/test/path-registry.test.ts
```

Or sweep all files to find the one with `fail > 0`:

```
PATH="./node_modules/.bin:$PATH"
for f in web/test/*.test.ts; do
  result=$(tsx --test --test-force-exit "$f" 2>&1)
  if ! echo "$result" | grep -q "fail 0"; then
    echo "=== $f ==="
    echo "$result" | tail -15
  fi
done
```

`tsx` is in `node_modules/.bin/` after `npm install`, but is not on the global PATH, so prefixing `PATH="./node_modules/.bin:$PATH"` is required when invoking it directly from the shell.

### Auto-generated registry files

Two files in `references/` are produced by scripts and must never be edited by hand. They are committed because tests assert against them:

| File | Generator | What it tracks |
|---|---|---|
| `references/registries/path-registry.csv` | `python3 scripts/extract_paths.py` | Every file path mentioned across markdown, YAML, JSON, and source. The `path-registry.test.ts` suite asserts every concrete entry resolves to a real file. |
| `references/registries/permission-bypass-registry.md` | `tsx scripts/audit-permissions.ts` | Every occurrence of `bypassPermissions`, `dangerouslySkipPermissions`, or `dangerouslyDisableSandbox` in `web/`, `scripts/`, and `.claude/`. |

`extract_paths.py` runs automatically as the first step of `npm test`, so `path-registry.csv` is regenerated on every test run. `audit-permissions.ts` does NOT run from `npm test`; if you rename a file referenced in the permission registry, regenerate it manually:

```
PATH="./node_modules/.bin:$PATH" tsx scripts/audit-permissions.ts
```

A common failure mode after a file rename: `path-registry.test.ts` reports `references X which does not exist`. The fix is usually to update the source reference (a plan or doc that still mentions the old name), then regenerate both registries.

### Drift-prevention tests

`web/test/cross-file-consistency.test.ts` enforces invariants that span multiple files (CSS/HTML/TS). Notable sections:

- **CSS class coverage:** classes used in `web/public/app.ts` HTML strings must exist in `web/public/style.css`.
- **YAML browser spec selector drift:** every `selector:` and `target:` in `web/test-specs/browser/*.yaml` must resolve against `index.html`, `style.css`, or `app.ts` (with an allowlist for runtime-generated classes like `.chat-message`, `.sim-card`, `.custom-select-option`).
- **Dashboard/progression invariants:** the hexagon SVG viewBox, axis names, and theme files must stay in sync across `app.ts`, `progression.yaml`, and the `themes/` directory.

These tests catch the most common breakage class: a refactor on one side of the codebase that silently invalidates a selector, class name, or path on the other side.
