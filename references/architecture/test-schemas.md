# test CLI output schemas

This document describes the JSON contracts emitted by the `test` CLI. Schemas live at `web/lib/schemas/` and are exercised by `web/test/test-schemas.test.ts` and `web/test/test-selftest.test.ts`.

## Why schemas

The `test` CLI is a developer surface area. Callers include the user at the terminal, `npm test`, the web app's background test runner, and the agent-driven browser tests. Each caller parses the JSON output. Without a schema, a field rename or type change silently breaks every downstream consumer and the failure mode is "my script crashed" rather than "the CLI contract was violated."

The schemas are derived from observed CLI output, not guessed. `web/test/test-schemas.test.ts` spawns the real CLI in dry-run mode and validates its output against the schemas, so drift shows up the next time `npm test` runs.

## Schemas

### `web/lib/schemas/agent-specs-output.schema.json`

Covers `test agent --json` and `test agent --dry-run --json`.

Top-level envelope:

- `command`: constant `"agent"`.
- `ts`: ISO-8601 timestamp.
- `specs`: array of `{ file, name, steps, valid }`.
- `verdict`: one of `VALID`, `INVALID`, `PASS`, `FAIL`.

## Evolving a schema

1. Run the CLI and eyeball the output.
2. Edit the schema to match, keeping `additionalProperties: true` on the envelope for forward compatibility.
3. Run `npx tsx --test web/test/test-schemas.test.ts` and confirm it passes.
4. Update this document if the contract changed.

## Related

- Issue #31 — CLI hardening work that introduced these schemas.
- `references/architecture/testing-system.md` — broader testing strategy.
