# Compile prompt

You are compiling 24 hours of `learning/logs/raw.jsonl` into the system
vault. The vault is the system's long-term memory: stable, structured,
small.

## Inputs

- `learning/logs/raw.jsonl` (last 24 hours, JSONL).
- Existing files under `learning/system-vault/`.

## Output layout

Each entry in the raw log belongs to exactly one topic. Choose the
subdirectory by event type:

| Source event | Subdirectory | Notes |
|--------------|--------------|-------|
| `error`, `warning`, persistent failure | `findings/` | One file per recurring symptom |
| Manual workaround applied during a session | `workarounds/` | Title summarizes the symptom |
| Architectural choice or convention | `decisions/` | One file per decision, ADR style |
| Sim play session lifecycle | `sessions/` | One file per session id |
| Code health regression on a module | `components/` | One file per affected module |
| Health snapshot | health subdir | Single rolling file `current.md` |

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

If you cannot determine a topic for an entry, drop it (the raw log is
the source of truth). Do not invent content. Do not summarize sessions
that are still in progress.
