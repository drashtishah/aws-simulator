---
name: sim-test
description: Extend the sim-test CLI with new browser specs, persona profiles, or CLI commands. Use when user says "add test", "new spec", "new persona", or "extend sim-test".
effort: medium
paths:
  - web/test-specs/**
  - scripts/**
hooks:
  PreToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "npx tsx .claude/hooks/guard-write.ts --ownership .claude/skills/sim-test/ownership.json"
---

# sim-test Skill

Extend the testing CLI with new browser specs, persona profiles, or commands.

---

## Phase 1: Understand what needs extending

- Read `references/architecture/testing-system.md` for architecture overview
- Run `sim-test --help` to see current commands
- List `web/test-specs/browser/` and `web/test-specs/personas/` for current coverage

## Phase 2: Expand

Choose one of these options depending on what is needed.

### Option A: Add a browser spec

1. Create YAML file in `web/test-specs/browser/{name}.yaml`
2. Follow schema: name, description, setup, steps (id, action, target, check)
3. Check types: has_class, not_has_class, attribute, text_contains, visible, css_property, min_count, screenshot_compare
4. Action types: click, type, keyboard, emulate, wait
5. Validate: `sim-test agent --spec {name} --dry-run`

### Option B: Add a persona profile

1. Create JSON file in `web/test-specs/personas/{id}.json`
2. Required fields: id, name, role, description, behaviors, focus_areas, evaluation_questions, session_minutes
3. Validate: `sim-test personas --id {id} --dry-run`

### Option C: Add a CLI command

1. Only possible in dev mode (no active skill), since `scripts/sim-test.ts` is NEVER_WRITABLE during skill execution
2. Register with commander: `.command('name').description('...').option('--json').action(async (opts) => { ... })`
3. Must support --json flag, exit codes (0/1/2), --help
4. Add corresponding npm script alias in `package.json`

### Option D: Run content validation

1. Pick a sim ID from `sims/registry.json`
2. Run: `sim-test content <simId>`
3. Review the 7-dimension findings (summary, title, difficulty, services, tags, category, learning_objectives)
4. If any dimension fails, fix the sim content and re-run
5. For structured output: `sim-test content <simId> --json`
6. Results are written to `web/test-results/content/`

This command uses Sonnet to validate that sim metadata accurately describes the sim content. It reads manifest.json, story.md, resolution.md, and all artifacts, then asks the agent to check each dimension.

## Phase 3: Verify

- Run `sim-test --help` to confirm command appears (if adding a command)
- Run the new spec/persona/command with --dry-run if available
- Run `npm test` to verify unit tests still pass

## Phase 4: Commit

Follow `references/architecture/core-workflow.md`. If a GitHub Issue exists for this work, reference it in the commit message.

---

## Rules

1. No emojis.
2. Never edit `scripts/sim-test.ts` during skill execution. It is NEVER_WRITABLE.
3. Never edit files in `web/test-specs/` via Edit/Write tools. Use Bash or the CLI scripts.
4. Always validate new specs with --dry-run before committing.
5. The test skill owns `web/test-results/` directory only.
