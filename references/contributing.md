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
3. If changing `agent-prompts.md` placeholders, also update `web/lib/prompt-builder.js`
4. If changing `manifest.json` schema, also update `web/lib/prompt-builder.js`
5. If changing `profile.json`, `journal.md`, or `sessions/*.json` schemas, also update `web/server.js` API routes and `web/public/app.js`

## Testing

### Running Tests

- `npm test`: unit tests (node:test, 78 tests, zero test-framework dependencies)
- `npm run test:e2e`: Playwright E2E tests (70 tests, headless Chromium)
- `npm run test:all`: runs both sequentially
- All tests must pass before any change is committed

### Playwright CLI

- `npx playwright test --headed`: see the browser during tests
- `npx playwright test --debug`: step through with the Inspector
- `npx playwright test -u`: update visual regression screenshot baselines
- `npx playwright show-trace <trace.zip>`: open trace viewer for a failed test
- `npx playwright codegen http://localhost:3200`: record browser actions to generate test code

### TDD for New Features

- Write a failing test first, verify it fails for the right reason
- Write minimal code to make the test pass
- Refactor only after tests are green
- Every new endpoint, behavior, or UI feature needs a test

### Test Architecture

- Unit tests: `web/test/*.test.js` (node:test + assert/strict)
- E2E tests: `web/test/e2e/*.spec.js` (Playwright)
- E2E fixtures: `web/test/e2e/fixtures.js` (mock SSE routes, page objects)
- Config: `playwright.config.js` (webServer auto-starts, screenshots on failure, traces on failure)
- Visual baselines: `web/test/e2e/visual.spec.js-snapshots/`

### After CSS Changes

Update visual regression baselines: `npx playwright test visual.spec.js -u`

## Adding New Content (Zero Code Changes)

- New sim: use `/create-sim`, auto-discovered from registry
- New narrative theme: add `themes/{id}.md` with YAML frontmatter (id, name, tagline)
- New UI color theme: add `web/public/ui-themes/{id}.css` defining all CSS variables from dracula.css

## Updating Paths

**Code files (JS):**
All project paths are centralized in `web/lib/paths.js`. To rename or move a directory, update the constant or helper there. Consumers (`web/server.js`, `web/lib/prompt-builder.js`, `web/lib/claude-process.js`, `web/lib/logger.js`) import from this file. Test files define their own ROOT and are self-contained.

**Text files (markdown, JSON):**
Paths in backticks (`.md`) and string values (`.json`) are tracked by `scripts/extract_paths.py`, which writes `references/path-registry.csv`. Run `npm test` to regenerate the CSV and validate all paths resolve on disk. The test (`web/test/path-registry.test.js`) checks: concrete paths exist, template paths have valid directory prefixes, source files exist.

## Debugging

- All logs: `learning/logs/activity.jsonl` (tool calls, session events, warnings, errors)
- Use `/fix` to read and act on the log

## Project Locality

- All config is project-local (`.claude/settings.local.json`), not global (`~/.claude/`)
- Hooks, settings, and skills are in the repo, not in user home directory
- Players clone the repo and everything works
