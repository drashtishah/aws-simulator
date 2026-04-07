---
name: system-vault-dream
description: >
  AutoDream pass over the system vault: orient, gather signal,
  consolidate, prune and reindex. 4 phases, atomic, cannot delete
  findings linked from any other vault file. Triggered by the
  dream-check SessionStart hook when sessions_since_last_dream
  crosses the threshold. Use when user says "dream", "vault dream",
  or "consolidate vault".
effort: medium
references_system_vault: true
paths:
  - learning/system-vault/**
  - .claude/state/dream-state.json
  - .claude/state/vault-circuit.json
---

# system-vault-dream Skill

Periodic consolidation of the system vault. The dream is a 4-phase
plan, run atomically: if any phase fails, the whole plan is rolled
back and `dream_failures` is incremented in
`.claude/state/vault-circuit.json`.

Linked findings are protected: any markdown file under `findings/`
that is referenced by another vault file (via wiki-link or markdown
link) cannot be deleted by the dream skill. The validator
`validateDreamPlan` in `web/lib/system-vault.ts` enforces this.

## Tool Reference

| Step | Action | Tool | Target |
|------|--------|------|--------|
| 1 | Load dream phases | Read | `.claude/skills/system-vault-dream/references/dream-phases.md` |
| 2 | Read dream state | Read | `.claude/state/dream-state.json` |
| 3 | Walk vault | Glob, Read | `learning/system-vault/**` |
| 4 | Write consolidations | Write, Edit | `learning/system-vault/<subdir>/<slug>.md` |
| 5 | Update dream state | Edit | `.claude/state/dream-state.json` |

---

## Steps

### 1. Phase 1: orient

Read `.claude/state/dream-state.json`. Note `last_dream_ts` and
`sessions_since_last_dream`. Walk the vault tree. Compute the set of
all topic files and the link graph. Record this as the dream baseline.
This phase is read-only.

### 2. Phase 2: gather_signal

Identify three signal classes:

- duplicates: two findings with substantially overlapping content.
- stale: notes whose `updated` frontmatter is older than 30 days and
  which are not linked from anywhere.
- hot: notes that have been updated more than 5 times in the last 7
  days.

This phase is read-only. Output is a JSON-serializable plan.

### 3. Phase 3: consolidate

Apply the plan:

- Merge duplicates by appending content into the canonical note and
  rewriting the duplicate as a one-line redirect to the canonical
  wiki-link.
- Promote hot notes by linking them from the matching subdirectory
  section in `index.md`.
- Tag stale notes for the prune phase.

Every write must keep topic files at most 4KB and `index.md` at most
200 lines. If any write would exceed these, abort the plan.

### 4. Phase 4: prune_and_index

Build a `DreamPlan` with `phases = ['orient', 'gather_signal',
'consolidate', 'prune_and_index']` and `deletes = [<stale orphans>]`.
Pass it to `validateDreamPlan`. If the validator returns `ok: false`,
abort and increment `dream_failures`. Otherwise delete the listed
files and rebuild `index.md`.

### 5. Update dream state

Write `last_dream_ts = <iso now>` and reset
`sessions_since_last_dream = 0` in `.claude/state/dream-state.json`.

---

## Rules

1. Atomic. The four phases happen together or not at all.
2. Linked findings are immutable from this skill.
3. No emojis.
4. Never write outside `learning/system-vault/**` and the two state
   files.
