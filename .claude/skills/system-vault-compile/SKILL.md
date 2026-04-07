---
name: system-vault-compile
description: >
  Compile the most recent raw.jsonl segment into the system vault as
  topic notes (findings, decisions, components, sessions). Run by the
  daily-compile-and-rotate cron at 03:00 local. Use when user says
  "compile vault", "system vault compile", or "rebuild vault index".
effort: low
references_system_vault: true
paths:
  - learning/system-vault/**
  - learning/logs/raw.jsonl
  - .claude/state/vault-circuit.json
---

# system-vault-compile Skill

Compile the last 24 hours of `learning/logs/raw.jsonl` into structured
topic notes under `learning/system-vault/`. Update `index.md`. Respect
the size budgets defined in `web/lib/system-vault.ts`:

- `index.md` must be at most 200 lines.
- Every topic markdown file must be at most 4KB.

## Tool Reference

| Step | Action | Tool | Target |
|------|--------|------|--------|
| 1 | Read circuit state | Read | `.claude/state/vault-circuit.json` |
| 2 | Read raw log | Read | `learning/logs/raw.jsonl` |
| 3 | Load compile prompt | Read | `.claude/skills/system-vault-compile/references/compile-prompt.md` |
| 4 | Load rotation policy | Read | `.claude/skills/system-vault-compile/references/rotation-policy.md` |
| 5 | Write topic files | Write | `learning/system-vault/<subdir>/<slug>.md` |
| 6 | Update index | Edit | `learning/system-vault/index.md` |
| 7 | Update circuit | Edit | `.claude/state/vault-circuit.json` |

---

## Steps

### 1. Check the circuit breaker

Read `.claude/state/vault-circuit.json`. If `paused` is true, exit
without writing. If `compile_failures` is at least 3, exit without
writing. The cron operator should investigate.

### 2. Read the raw log window

Read `learning/logs/raw.jsonl`. Filter to entries from the last 24 hours.
If the file is empty, exit cleanly with no changes.

### 3. Compile

Follow the prompt in
`.claude/skills/system-vault-compile/references/compile-prompt.md`.
Group entries by topic, write or extend topic notes under the matching
subdirectory: `findings/`, `workarounds/`, `decisions/`, `sessions/`,
`components/`, `health/`. Each topic file stays under 4KB. If a topic
note would exceed 4KB, split it by date suffix.

### 4. Update the index

Rebuild `learning/system-vault/index.md` from the topic file tree. Keep
it under 200 lines. Use sections per subdirectory with wiki-links to
each topic file.

### 5. Update the circuit

On success, set `compile_failures` to 0 in
`.claude/state/vault-circuit.json` and write the current ISO timestamp
under `last_compile_ts`. On any failure, increment `compile_failures`
and exit non-zero so the cron does not proceed to rotation.

### 6. Rotation

After a successful compile, follow
`.claude/skills/system-vault-compile/references/rotation-policy.md` to
gzip yesterday's segment of `raw.jsonl` into `learning/logs/archive/`.

---

## Rules

1. No emojis.
2. Never delete topic files. Use `system-vault-prune` for that.
3. Never write outside `learning/system-vault/**`,
   `learning/logs/raw.jsonl`, `learning/logs/archive/**`, or
   `.claude/state/vault-circuit.json`.
4. Atomic: if any phase fails, increment the failure counter and exit.
