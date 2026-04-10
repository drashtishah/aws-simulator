# Compile prompt

You are compiling 24 hours of `learning/logs/notes.jsonl` (primary
semantic source) and `learning/logs/raw.jsonl` (supplementary session
metadata) into the system vault. The vault is the system's long-term
memory: stable, structured, small.

## Inputs

- `learning/logs/notes.jsonl` (last 24 hours, JSONL, if present). Each entry is
  `{ts, kind, topic, body}`. This is the primary semantic signal when available.
- `learning/logs/raw.jsonl` (last 24 hours, JSONL). Mechanical session
  metadata (SessionStart, PostToolUse, Stop, Failure events).
- Existing files under `learning/system-vault/`.

## Output layout

The notes log carries the primary semantic signal. Map by `kind`:

| `kind` | Subdirectory | Notes |
|--------|--------------|-------|
| `finding` | `findings/` | One file per recurring symptom; merge if existing |
| `negative_result` | `findings/` | File name suffix `-negative.md`; preserves "tried X, did not work" trail |
| `workaround` | `workarounds/` | One file per symptom and applied fix |
| `decision` | `decisions/` | One file per decision, ADR style |
| `none` | dropped | Escape hatch from the Stop hook; carries no signal |

The raw log is supplementary. Use it for:

| Source event in raw.jsonl | Subdirectory | Notes |
|---------------------------|--------------|-------|
| `Failure` (with `kind: tool` or `kind: stop`) | `findings/` | One file per recurring symptom |
| `SessionStart` and `Stop` pair | `sessions/` | One file per `session_id`, summarizing session shape (tool counts, duration) |
| Code health snapshot | `health/` | Single rolling file `current.md` |
| Code health regression on a module | `components/` | One file per affected module |

## File rules

1. Each topic file is plain markdown with YAML frontmatter:
   `tags: [type/<kind>, scope/<area>]`, `created: <iso>`,
   `updated: <iso>`, `source_archives: [raw.jsonl.YYYY-MM-DD.gz, ...]`.
2. Files must be at most 4KB. If a note would exceed 4KB, split it by
   date suffix, e.g. `auth-flake-2026-04.md`, `auth-flake-2026-05.md`.
3. Use `[[wiki-links]]` between related notes. Findings linked from any
   other vault file cannot be deleted by the dream skill.
4. Never include personally identifying or secret material.

## Index

After writing topic files, rebuild `learning/system-vault/index.md`. The
index has one section per subdirectory and lists each topic file as a
bullet with a one-line summary. The index must be at most 200 lines.

## Failure mode

If you cannot determine a topic for a notes entry, use `topic` from
the entry directly (it is already a slug). For raw log entries with
no obvious topic, drop them. Do not invent content. Do not summarize
sessions that are still in progress.
