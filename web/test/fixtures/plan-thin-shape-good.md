# Example thin plan, 2026-04-09

## Workflow

This plan follows `references/architecture/core-workflow.md` end to end.
Every plan group below cites at least one open Issue. Plans never run
`gh issue create`.

## Testing

Test layers per `references/architecture/testing-system.md`. Each group
declares its layer below.

## Cleanup

After merge, run §9 cleanup per `references/architecture/core-workflow.md`.

### Group A: tighten foo validator (#999)

**Files:** see Issue #999.
**Test layer:** unit.
**Execute with:** superpowers:subagent-driven-development.

### Group B: extract bar helper (#1000)

**Files:** see Issue #1000.
**Test layer:** integration.
**Execute with:** superpowers:executing-plans.
