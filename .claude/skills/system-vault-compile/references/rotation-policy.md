# Rotation policy

The daily-compile-and-rotate cron rotates `learning/logs/raw.jsonl`
after a successful compile.

## Window

- Archives are gzipped to `learning/logs/archive/raw.jsonl.<YYYY-MM-DD>.gz`.
- Archives older than 7 days may be considered for deletion.
- Archives older than 90 days are out of window: deletion is refused.
- Archives still referenced by any vault topic file (via `source_archives`
  frontmatter or markdown link) are never deleted, regardless of age.

The TypeScript predicate `canRotate` in `web/lib/system-vault.ts`
encodes these rules. The cron should consult it before any unlink.

## Procedure

1. After compile succeeds, identify the segment of `raw.jsonl` whose
   timestamps fall on the previous calendar day, in local time.
2. Move that segment to `learning/logs/archive/raw.jsonl.<YYYY-MM-DD>`.
3. Gzip the archive in place: produces `raw.jsonl.<YYYY-MM-DD>.gz`.
4. For every existing `*.gz` archive, call the predicate. If the
   predicate returns `allow: false`, leave the archive in place. If it
   returns `allow: true`, unlink the archive.

## Failure mode

If any step fails, increment `compile_failures` in
`.claude/state/vault-circuit.json` and exit non-zero. Never delete an
archive on a failure path.
