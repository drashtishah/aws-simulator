---
tags:
  - type/reference
  - scope/web-app
---

# Contributing Guide

## Conventions

- No emojis in any output, code, or UI
- No `--` as punctuation (use commas, periods, colons)
- AWS vocabulary throughout (official service names, API action names)
- All colors via CSS custom properties, zero color literals in style.css
- 8px spacing grid, 12px card radius, 44px minimum touch targets
- WCAG AA contrast on all text (4.5:1 minimum)

## Before Making Any Change

1. Read `references/web-app-checklist.md` and check every relevant item
2. Read `references/workspace-map.md` to understand data flow and impact
3. If changing `agent-prompts.md` placeholders, also update `web/lib/prompt-builder.ts`
4. If changing `manifest.json` schema, also update `web/lib/prompt-builder.ts`
5. If changing `profile.json`, `journal.md`, or `sessions/*.json` schemas, also update `web/server.ts` API routes and `web/public/app.ts`

## Testing

### Running Tests

- `npm test`: runs `sim-test run` (unit tests)
- `npm run test:agent`: runs `sim-test agent` (YAML browser specs via Chrome DevTools MCP)
- `npm run test:personas`: runs `sim-test personas` (persona exploration sessions)
- All deterministic tests must pass before any change is committed

### sim-test CLI

- `sim-test run`: all deterministic tests (unit)
- `sim-test agent`: execute YAML browser specs via Chrome DevTools MCP
- `sim-test agent --spec nav`: run a single spec by name prefix
- `sim-test agent --dry-run`: parse and validate specs without executing
- `sim-test personas`: run all persona exploration sessions
- `sim-test personas --id hostile`: run a single persona by ID
- `sim-test personas --feedback`: append persona findings to `learning/feedback.md`
- `sim-test summary`: aggregate all results into `web/test-results/summary.json`
- All commands support `--json` for structured output

### TDD for New Features

- Write a failing test first, verify it fails for the right reason
- Write minimal code to make the test pass
- Refactor only after tests are green
- Every new endpoint, behavior, or UI feature needs a test

### Test Architecture

- Unit tests: `web/test/*.test.js` (node:test + assert/strict)
- Browser specs: `web/test-specs/browser/*.yaml` (agent-driven via Chrome DevTools MCP)
- Persona profiles: `web/test-specs/personas/*.json` (exploratory testing)
- Results: `web/test-results/` (gitignored, written by sim-test commands)
- Architecture reference: `references/testing-system.md`

## Adding New Content (Zero Code Changes)

- New sim: use `/create-sim`, auto-discovered from registry
- New narrative theme: add `themes/{id}.md` with YAML frontmatter (id, name, tagline)
- New UI color theme: add `web/public/ui-themes/{id}.css` defining all CSS variables from dracula.css

## Updating Paths

**Code files (JS):**
All project paths are centralized in `web/lib/paths.ts`. To rename or move a directory, update the constant or helper there. Consumers (`web/server.ts`, `web/lib/prompt-builder.ts`, `web/lib/claude-process.ts`, `web/lib/logger.ts`) import from this file. Test files define their own ROOT and are self-contained.

**Text files (markdown, JSON):**
Paths in backticks (`.md`) and string values (`.json`) are tracked by `scripts/extract_paths.py`, which writes `references/path-registry.csv`. Run `npm test` to regenerate the CSV and validate all paths resolve on disk. The test (`web/test/path-registry.test.ts`) checks: concrete paths exist, template paths have valid directory prefixes, source files exist.

## Debugging

- All logs: `learning/logs/activity.jsonl` (tool calls, session events, warnings, errors)
- Use `/fix` to read and act on the log

## Project Locality

- All config is project-local (`.claude/settings.local.json`), not global (`~/.claude/`)
- Hooks, settings, and skills are in the repo, not in user home directory
- Players clone the repo and everything works
