# Pipeline Labels

## Trigger labels (one required to enter pipeline)

| Label | Meaning |
|-------|---------|
| needs-triage | Awaiting human review before pipeline entry |
| needs-plan | Enter pipeline: Planner picks it up |

## Type labels (at most one, applied at issue creation)

| Label | When to apply | Effect on pipeline |
|-------|---------------|-------------------|
| text-only | Issue changes ONLY markdown, YAML, or docs (no .ts, .css, .json code) | Planner skips TDD, Implementer commits as `docs:` |
| ui | Issue changes `web/public/**`, `web/lib/*.css`, or `web/test-specs/browser/**` | Implementer/Verifier get Chrome DevTools MCP, Planner requires browser spec coverage |
| sim-content | Issue changes `sims/**/manifest.json`, `story.md`, `resolution.md`, or `artifacts/**` | Planner/Critic get AWS Knowledge MCP for accuracy verification |
| (none) | Standard code change | Default TDD workflow, no extra MCP |

## How to decide

Look at the files in the issue's Scope section:
- All files are .md, .yaml, or non-code? -> text-only
- Any file under `web/public/`, `web/lib/*.css`, or `web/test-specs/browser/`? -> ui
- Any file under `sims/`? -> sim-content
- Mixed or standard .ts/.json code? -> no type label

If unsure, omit the type label. The planner workflow auto-applies `ui` (when the plan body contains `web/` paths) or `sim-content` (when it contains `sims/` paths) if no type label is present after the plan is written.

## State labels (set automatically by pipeline)

| Label | Meaning | Recovery |
|-------|---------|----------|
| revised-plan | Critic sent the plan back for revision | Planner revises and resubmits |
| revised-impl | Verifier sent the implementation back | Implementer continues on the existing `feature/issue-N` branch and resubmits |
| needs-decomposition | Critic requested decomposition; planner splits on next pass | Planner decomposes and removes this label |
| decomposed-from | Issue was created by planner decomposition of a parent | Prevents recursive decomposition; never removed |
| pipeline-failed | A pipeline stage failed; trigger label removed, run link posted | Re-add the appropriate needs-* label after investigation |

## Reflection labels

| Label | When applied | Effect |
|-------|--------------|--------|
| needs-eval | Verifier auto-labels on PASS | Evaluator workflow fires, reads full issue chain, writes vault entries, scores pipeline (X/32), optionally files needs-triage issue for systemic failures, then removes the label |

## Escape labels

| Label | Meaning | Recovery |
|-------|---------|----------|
| blocked | Halt pipeline; prevents any stage from starting | Remove label, re-add the appropriate needs-* label |
| cancel | Cancel in-flight agent runs AND prevent future stages | Remove label, re-add the appropriate needs-* label |
| needs-human | Pipeline escalated to human review | Human resolves, re-adds appropriate needs-* label |
