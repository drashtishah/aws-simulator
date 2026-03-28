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

1. `npm test` runs unit tests (node:test, zero dependencies)
2. `npm run test:e2e` runs Playwright E2E tests (headless Chromium)
3. `npm run test:all` runs both
4. All tests must pass before any change is committed

## Adding New Content (Zero Code Changes)

- New sim: use `/create-sim`, auto-discovered from registry
- New narrative theme: add `themes/{id}.md` with YAML frontmatter (id, name, tagline)
- New UI color theme: add `web/public/ui-themes/{id}.css` defining all CSS variables from snowy-mountain.css

## Debugging

- All logs: `learning/logs/activity.jsonl` (tool calls, session events, warnings, errors)
- Use `/fix` to read and act on the log

## Project Locality

- All config is project-local (`.claude/settings.local.json`), not global (`~/.claude/`)
- Hooks, settings, and skills are in the repo, not in user home directory
- Players clone the repo and everything works
