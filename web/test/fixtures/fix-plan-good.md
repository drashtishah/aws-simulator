# /fix plan, 2026-04-07, ownership-overlap-cluster

## Workflow

This plan follows `references/architecture/core-workflow.md`. Issue-first,
small revertable commits, TDD strict, verifier subagent separation.

## Testing

This plan tests through `references/architecture/testing-system.md`.
Unit tests in `web/test/code-health.test.ts`. Health check via
`npm run health`.

## Group 1: ownership_integrity overlap on shared file

- Closes #65
- Feedback: 2026-04-06 user reinforced via /feedback "ownership feels duplicated"

Files:
- /Users/drashti/experiments/aws-simulator/.claude/skills/play/ownership.json
- /Users/drashti/experiments/aws-simulator/.claude/skills/setup/ownership.json

Steps:
1. Edit /Users/drashti/experiments/aws-simulator/.claude/skills/play/ownership.json line 1 to drop the duplicate entry.
2. Run npm run health to confirm the finding disappears.

## Group 2: missing regression test for overlap pairs

- Closes #66
- Ref #65

Files:
- /Users/drashti/experiments/aws-simulator/web/test/code-health.test.ts

Steps:
1. Add a test case to /Users/drashti/experiments/aws-simulator/web/test/code-health.test.ts asserting no two ownership.json files declare the same path.
