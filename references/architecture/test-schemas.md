# test CLI output schemas

This document describes the JSON contracts emitted by the `test` CLI and the file format consumed by `test personas --feedback`. Schemas live at `web/lib/schemas/` and are exercised by `web/test/test-schemas.test.ts` and `web/test/test-selftest.test.ts`.

## Why schemas

The `test` CLI is a developer surface area. Callers include the user at the terminal, `npm test`, the web app's background test runner, and the agent-driven browser tests. Each caller parses the JSON output. Without a schema, a field rename or type change silently breaks every downstream consumer and the failure mode is "my script crashed" rather than "the CLI contract was violated."

The schemas are derived from observed CLI output, not guessed. `web/test/test-schemas.test.ts` spawns the real CLI in dry-run mode and validates its output against the schemas, so drift shows up the next time `npm test` runs.

## Schemas

### `web/lib/schemas/personas-output.schema.json`

Covers `test personas --json` and `test personas --dry-run --json`.

Top-level envelope:

- `command`: constant `"personas"`.
- `ts`: ISO-8601 timestamp.
- `personas`: array of `{ id, name, behaviors, questions, valid }`.
- `verdict`: one of `VALID`, `INVALID`, `PASS`, `FAIL`.

`additionalProperties: true` at the envelope level so additive fields do not break the contract.

### `web/lib/schemas/agent-specs-output.schema.json`

Covers `test agent --json` and `test agent --dry-run --json`.

Top-level envelope:

- `command`: constant `"agent"`.
- `ts`: ISO-8601 timestamp.
- `specs`: array of `{ file, name, steps, valid }`.
- `verdict`: one of `VALID`, `INVALID`, `PASS`, `FAIL`.

### `web/lib/schemas/persona-finding.schema.json`

Covers a single file under `web/test-results/personas/<persona-id>-<timestamp>.json`, the shape consumed by `test personas --feedback` when merging agent-authored findings into `learning/feedback.md`.

Envelope:

- `persona`: the persona id (for example `hostile-user`).
- `ts`: optional ISO-8601 timestamp. When absent, `--feedback` uses today's date.
- `findings`: array of `{ severity, category, description, reproduction?, suggested_guardrail? }`.

`severity` is restricted to `low | medium | high | critical`. The `findings` object uses `additionalProperties: false` so a typo like `reproductionnn` is flagged at validation time.

## Evolving a schema

1. Run the CLI and eyeball the output.
2. Edit the schema to match, keeping `additionalProperties: true` on the envelope for forward compatibility.
3. Run `npx tsx --test web/test/test-schemas.test.ts` and confirm it passes.
4. Update this document if the contract changed.

## Related

- Issue #31 — CLI hardening work that introduced these schemas.
- Issue #106 — persona Layer 3 smoke test, consumer of `persona-finding.schema.json`.
- `references/architecture/testing-system.md` — broader testing strategy.
