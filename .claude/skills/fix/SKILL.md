---
name: fix
description: Gather feedback, open Issues, and chain into /test. /fix never edits code or writes plans. Use when user says "fix", "apply feedback", or "propose improvements".
effort: low
references_system_vault: true
---

# fix Skill

/fix has two jobs: (1) gather inputs and create GitHub Issues for the GHA
pipeline, and (2) chain into the /test skill to run agent-driven test layers.
It never edits code, never runs deterministic tests, never writes plans, never
commits. Issues created here flow through the label-driven pipeline
(planner -> critic -> implementer -> verifier) described in
`references/architecture/gha-pipeline.md`.

## Flow

1. Dispatch SIX fetching subagents in parallel via `superpowers:dispatching-parallel-agents`, one per task in `.claude/skills/fix/references/fetching-tasks.md`. The six tasks are: (1) open Issues list, (2) feedback deltas, (3) vault prior art, (4) top health findings, (5) contradictory-instructions scanner, (6) old-plan staleness scanner. Use the exact prompts verbatim from that file. Each subagent returns ~300 words; /fix concatenates the six summaries into the input bundle. No raw Issue bodies, vault articles, or health JSON land in main context.
2. Verify the returned bundle has all six summaries, each well-formed per the Output schema in `fetching-tasks.md`. If any is missing or malformed, re-dispatch just that one task. Do not proceed until the bundle is complete.
3. Group by label, root cause, and shared file references using the heuristics in `.claude/skills/fix/references/issue-grouping.md`. Grouping stays in main context: synthesis is judgment, not fetching, and must not be delegated to a subagent.
4. For every orphan-feedback theme surfaced in step 2 and every actionable finding, create a GitHub Issue NOW via `gh issue create --label needs-triage`. Use the depth template in memory `feedback_detailed_issues.md` (Context, Current state verified, Scope with file:line refs, Architecture note, Out of scope, Verification naming exact test file paths + the test command + "Verified by separate subagent", Refers to). Capture every Issue number. This is the ONLY write operation /fix performs against external state (Issue #113). Tag every Issue with the `needs-triage` label so the owner can review and promote to `needs-plan` when ready.
5. Validate every Issue created in step 4 against the Issue checklist in `.claude/skills/fix/references/issue-validator.md`. If ANY section is missing from ANY Issue, /fix refuses to proceed to step 6 and reports the gap to the user. Fix the gap via `gh issue edit <N> --body-file ...` then re-run step 5.
6. Run the agent test layers. After all issues are created and validated, invoke the `test` skill so the agent-driven test layers (browser specs, evals) run against the current state of the code. Their findings feed `learning/feedback.md`, which becomes input for the NEXT /fix cycle. Use the Skill tool: `Skill(skill: "test")`. Do not invoke any other skill. Do not write code. Do not create more issues based on the test output (the test skill writes feedback that the next /fix run will pick up).

## Rules

1. /fix never modifies code or tests. It creates GitHub Issues (step 4) and chains into /test (step 6). That is all.
2. Every Issue must reference at least one open concern from the input bundle.
3. Every file path in Issue bodies is absolute or repo-root-relative, never bare.
4. /fix must not proceed past step 5 until the issue-validator checklist in `.claude/skills/fix/references/issue-validator.md` passes for every Issue created.
5. /fix writes salience-triggered notes during its input gathering. Any moment that feels surprising, exciting, frustrating, or like a self-correction gets a note. Any emotion, positive or negative, is a valid signal.
6. The /test chain (step 6) is one-directional: /fix calls /test. /test never calls /fix back. The loop closes when the human runs /fix again next time.
