# GHA Pipeline

Label-driven GitHub Actions pipeline for autonomous issue resolution.

## Label state machine

```
gh issue create (mobile or /fix)
  -> [needs-plan]    -> planner.yml   (Sonnet)  -> [needs-critique]
  -> [needs-critique] -> critic.yml    (Opus)    -> [needs-impl] | [needs-plan, revision-1]
  -> [needs-impl]    -> implementer.yml (Opus)  -> [needs-verify]
  -> [needs-verify]  -> verifier.yml   (Sonnet)  -> gh pr create + gh pr merge --merge --auto
```

Retry budget is 2 (retry-1, retry-2, then needs-human). Critic caps at one revision. Escape labels: blocked, needs-human.

Label swaps in critic, implementer, and verifier are driven by `structured_output` from `claude-code-action` (via `--json-schema` in `claude_args`), not by grep on comment text.

## Security

- `close-foreign-issues.yml` auto-closes any issue not opened by the repo owner.
- Every agent workflow gates on `sender.login == repository_owner AND issue.user.login == repository_owner`.
- Each stage has a minimal `--allowed-tools` allowlist.

## Failure recovery

Each workflow has a `Handle stage failure` step with `if: failure()`. On any step failure it:
1. Removes the trigger label (needs-plan, needs-critique, needs-impl, needs-verify).
2. Adds `pipeline-failed`.
3. Posts a comment with the workflow run URL.

Known limitation: if `--resume` is passed with an expired server-side session, the claude step fails and triggers this handler rather than falling back to a fresh session. Re-add the trigger label to retry after the session expires. Graceful retry without resume is tracked as a follow-up.

## Models per stage

| Stage | Model | Max turns |
|---|---|---|
| Planner | claude-sonnet-4-6 | 5 |
| Critic | claude-sonnet-4-6 | 5 |
| Implementer | claude-opus-4-6 | 15 |
| Verifier | claude-sonnet-4-6 | 8 |

## Tool allowlists per stage

Base tools per role. Additional tools are added by issue type label (see Label Groups below).

| Stage | Base tools |
|---|---|
| Planner | Read, Glob, Grep, WebFetch, Bash(gh issue view/list/comment) |
| Critic | Read, Glob, Grep, Bash(gh issue view/comment) |
| Implementer | Read, Glob, Grep, Edit, Write, Bash(git/npm/npx/tsx/python3/gh issue view/comment) |
| Verifier | Read, Glob, Grep, Edit, Bash(git/npm/tsx/gh issue view/comment/gh pr create/merge) |

Verifier also has `actions: read` permission for CI check-run access.

## Label groups

Issue type labels control which prompt overlay and MCP toolset each agent receives. The classify step in each workflow reads labels and routes accordingly.

| Label | MCP added | Which roles get MCP |
|---|---|---|
| text-only | none | n/a |
| ui | Chrome DevTools | Implementer, Verifier |
| sim-content | AWS Knowledge | Planner, Critic |
| (none) | none | n/a |

See `references/pipeline/labels.md` for label definitions and decision rules.

## Prompt files

Base prompts and context overlays live in `references/pipeline/`:

| File | Purpose |
|---|---|
| `planner.md` | Base Planner role prompt |
| `critic.md` | Base Critic role prompt |
| `implementer.md` | Base Implementer role prompt |
| `verifier.md` | Base Verifier role prompt |
| `context-text.md` | Overlay for text-only issues (Planner/Critic) |
| `context-ui.md` | Overlay for ui issues (all roles) |
| `context-sim.md` | Overlay for sim-content issues (Planner/Critic) |
| `labels.md` | Label definitions and routing rules |

## Repo settings

1. Branch protection on master: require PR, require `test` status check, no force push, no deletion.
2. Merge commits only (no squash, no rebase). Auto-delete head branches.
3. Actions permissions: read+write. Allow GHA to create and approve PRs.
4. Discussions enabled (for close-foreign-issues redirect).
5. Secret: `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`.

## Workflow files

- `.github/workflows/planner.yml`
- `.github/workflows/critic.yml`
- `.github/workflows/implementer.yml`
- `.github/workflows/verifier.yml`
- `.github/workflows/close-foreign-issues.yml`
- `.github/workflows/poc-claude.yml` (one-time verification)
