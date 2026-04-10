---
name: test
description: Run agent-driven test layers (browser specs, evals) and extend them with new specs. Use when user says "run tests", "add test", "new spec", or "extend test".
effort: medium
paths:
  - web/test-specs/**
  - scripts/**
hooks:
  PreToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "npx tsx .claude/hooks/guard-write.ts --ownership .claude/skills/test/ownership.json"
references_system_vault: true
---

# test Skill

Run agent-driven test layers (browser specs, evals) and extend them with new specs.

Deterministic tests (Layer 1) run via `npm test` in CI. This skill covers the layers that need an agent or LLM judge.

---

## Subcommands

### agent (Layer 2: browser specs)

Run browser specs against the running web app via Chrome DevTools MCP.

```
tsx scripts/test.ts agent                    # run all browser specs
tsx scripts/test.ts agent --spec <name>      # run one spec
tsx scripts/test.ts agent --dry-run          # validate specs without running
```

### evals (Layer 4: evaluation)

Run sim evaluations. Track A is deterministic scoring. Track B uses an LLM judge.

```
tsx scripts/test.ts evals                    # Track A only
tsx scripts/test.ts evals --llm              # Track A + Track B (LLM judge)
```

### validate

Orchestrate agent + evals in sequence.

```
tsx scripts/test.ts validate                 # run agent then evals
```

### summary

Aggregate and display test results.

```
tsx scripts/test.ts summary                  # show results summary
tsx scripts/test.ts summary --json           # structured output
```

### content

Validate sim content against metadata using Sonnet.

```
tsx scripts/test.ts content <simId>          # validate one sim
tsx scripts/test.ts content <simId> --json   # structured output
```

Results are written to `web/test-results/content/`.

---

## Extending: Add a browser spec

1. Create YAML file in `web/test-specs/browser/{name}.yaml`
2. Follow schema: name, description, setup, steps (id, action, target, check)
3. Check types: has_class, not_has_class, attribute, text_contains, visible, css_property, min_count, screenshot_compare
4. Action types: click, type, keyboard, emulate, wait
5. Validate: `tsx scripts/test.ts agent --spec {name} --dry-run`

---

## Rules

1. No emojis.
2. Never edit `scripts/test.ts` during skill execution. It is NEVER_WRITABLE.
3. Never edit files in `web/test-specs/` via Edit/Write tools. Use Bash or the CLI scripts.
4. Always validate new specs with --dry-run before committing.
5. The test skill owns `web/test-results/` directory only.
