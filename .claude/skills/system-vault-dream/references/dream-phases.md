# Dream phases

The system-vault-dream skill runs four phases in strict order. The
canonical phase names, in the canonical order, are declared by
`DREAM_PHASES` in `web/lib/system-vault.ts`:

1. `orient`
2. `gather_signal`
3. `consolidate`
4. `prune_and_index`

`validateDreamPlan` rejects any plan that omits a phase, reorders
phases, or schedules a delete that would remove a finding linked from
another vault file.

## Phase contracts

### orient

Read-only. Inputs: `learning/system-vault/**`, dream state file.
Output: an in-memory baseline (file list, link graph, last dream
timestamp). No writes.

### gather_signal

Read-only. Output: a JSON plan with three lists,
`{ duplicates: [...], stale: [...], hot: [...] }`. No writes.

### consolidate

Mutating. Merges duplicates, promotes hot notes into the index, tags
stale notes for pruning. Every write must keep topic files at most
4KB and `index.md` at most 200 lines.

### prune_and_index

Mutating. Builds the final `DreamPlan` with the full
`['orient', 'gather_signal', 'consolidate', 'prune_and_index']` phase
list and the proposed deletes. Calls `validateDreamPlan`. On `ok:
false`, the entire dream is rolled back and `dream_failures` is
incremented in `.claude/state/vault-circuit.json`. On `ok: true`,
deletes are applied and `index.md` is rebuilt.

## Atomicity

If any phase fails, no changes survive. The skill must reset
`learning/system-vault/` to the orient baseline before exiting. The
state files (`.claude/state/dream-state.json`,
`.claude/state/vault-circuit.json`) are updated last so a partial
failure does not look like a successful dream.
