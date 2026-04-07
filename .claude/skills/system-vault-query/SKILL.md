---
name: system-vault-query
description: >
  Query the system vault for relevant prior findings, decisions, and
  workarounds. Read-only. Enforces strict per-turn and per-session
  budgets so the vault never floods context. Use when user says "ask
  vault", "system vault query", "what did we learn about X", or when a
  skill wants prior context.
effort: low
references_system_vault: true
paths:
  - learning/system-vault/**
---

# system-vault-query Skill

Read-only query against `learning/system-vault/`. Returns short
excerpts. Hard budgets, enforced by `web/lib/system-vault.ts`:

- At most 5 files per turn.
- At most 4KB per file.
- At most 20KB per turn.
- At most 60KB per session.

If a budget would be exceeded, refuse the next file and explain why.

## Tool Reference

| Step | Action | Tool | Target |
|------|--------|------|--------|
| 1 | Load scout prompt | Read | `.claude/skills/system-vault-query/references/scout-prompt.md` |
| 2 | Read vault index | Read | `learning/system-vault/index.md` |
| 3 | Read topic files | Read | `learning/system-vault/<subdir>/<slug>.md` |

---

## Steps

### 1. Parse the question

Treat the user's question as a search query. Extract keywords. Identify
which subdirectory is most likely to hold the answer (`findings`,
`decisions`, `workarounds`, `components`, `sessions`, `health`).

### 2. Read the index

Read `learning/system-vault/index.md`. Index entries are wiki-links to
topic files with one-line summaries. Pick at most 5 candidates.

### 3. Apply the budget

For each candidate, check the file size. Skip files larger than 4KB
(they should not exist; the compile skill prevents this). Stop when:

- 5 files have been read this turn, or
- 20KB of total content has been pulled this turn, or
- 60KB of total content has been pulled this session.

The `QueryBudget` class in `web/lib/system-vault.ts` is the canonical
implementation. Conceptually: track `(turnFiles, turnBytes, sessionBytes)`,
admit each candidate only if all four budgets still hold.

### 4. Synthesize the answer

Quote at most 3 short snippets per file. Cite each snippet with the
topic file path. If no candidates matched, say so plainly. Do not
invent content; the vault is the source of truth.

### 5. Refuse cleanly

If a budget is exhausted, return what was found so far and add a single
line: `vault budget exhausted: <reason>`. Do not retry.

---

## Rules

1. Read-only. This skill never writes to the vault.
2. No emojis.
3. Never read files outside `learning/system-vault/**`.
4. Honour the budget even when the user asks for more.
