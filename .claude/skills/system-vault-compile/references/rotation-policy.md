# Rotation policy

The daily-compile-and-rotate cron rotates BOTH `learning/logs/raw.jsonl`
and `learning/logs/notes.jsonl` after a successful compile.

## Window

- Archives are gzipped to `learning/logs/archive/raw.jsonl.<YYYY-MM-DD>.gz`
  and `learning/logs/archive/notes.jsonl.<YYYY-MM-DD>.gz` respectively.
- Archives older than 7 days may be considered for deletion.
- Archives older than 90 days are out of window: deletion is refused.
- Archives still referenced by any vault topic file (via `source_archives`
  frontmatter or markdown link) are never deleted, regardless of age.

The TypeScript predicate `canRotate` in `web/lib/system-vault.ts`
encodes these rules. The cron should consult it before any unlink.

## Procedure

For each of `raw.jsonl` and `notes.jsonl`:

1. After compile succeeds, identify the segment whose timestamps fall
   on the previous calendar day, in local time.
2. Move that segment to `learning/logs/archive/<filename>.<YYYY-MM-DD>`.
3. Gzip the archive in place.
4. For every existing `*.gz` archive, call the `canRotate` predicate.
   If it returns `allow: false`, leave the archive in place. If
   `allow: true`, unlink it.

## Failure mode

If any step fails, increment `compile_failures` in
`.claude/state/vault-circuit.json` and exit non-zero. Never delete an
archive on a failure path.
