---
name: system-vault-prune
description: >
  Manual prune of the system vault. Supports `--revert <ts>` to undo a
  previous dream by restoring topic files from the most recent
  pre-dream snapshot. Use when user says "vault prune", "system vault
  prune", or "revert vault dream".
effort: low
references_system_vault: true
paths:
  - learning/system-vault/**
  - .claude/state/dream-state.json
---

# system-vault-prune Skill

Manual prune of `learning/system-vault/`. Unlike `system-vault-dream`,
this skill is invoked by the user, not by a cron or hook. It is
deliberately small and reversible.

## Modes

### Default mode

Walk `learning/system-vault/findings/` and `learning/system-vault/sessions/`.
List candidates for pruning, namely files that are:

- not linked from any other vault file, and
- have an `updated` frontmatter field older than 30 days, and
- are not the canonical `index.md`.

Print the list. Do nothing else. The user must confirm with an
explicit second invocation to actually delete.

### Revert mode

Invoked as `system-vault-prune --revert <ts>` where `<ts>` is an ISO
timestamp matching a dream snapshot under
`learning/system-vault/dreams/<ts>/`. The dream skill writes a tarball
or directory snapshot of the pre-dream vault before phase 4. This
skill restores from that snapshot, then writes a new entry to
`.claude/state/dream-state.json` recording the revert.

If `<ts>` does not match any snapshot, exit non-zero and print the
available snapshot timestamps.

## Tool Reference

| Step | Action | Tool | Target |
|------|--------|------|--------|
| 1 | Walk vault | Glob, Read | `learning/system-vault/**` |
| 2 | Read dream snapshots | Read | `learning/system-vault/dreams/<ts>/**` |
| 3 | Restore on revert | Write | `learning/system-vault/<subdir>/<slug>.md` |
| 4 | Update dream state | Edit | `.claude/state/dream-state.json` |

---

## Rules

1. Never delete a linked finding. Reuse `validateDreamPlan` from
   `web/lib/system-vault.ts` if you need to confirm.
2. Default mode prints only. No deletes without explicit confirmation.
3. Revert mode is the only path that restores files; it cannot also
   delete.
4. No emojis.
