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

## Security

- `close-foreign-issues.yml` auto-closes any issue not opened by the repo owner.
- Every agent workflow gates on `sender.login == repository_owner AND issue.user.login == repository_owner`.
- Each stage has a minimal `--allowed-tools` allowlist.

## Models per stage

| Stage | Model | Max turns |
|---|---|---|
| Planner | claude-sonnet-4-6 | 5 |
| Critic | claude-opus-4-6 | 5 |
| Implementer | claude-opus-4-6 | 15 |
| Verifier | claude-sonnet-4-6 | 8 |

## Tool allowlists per stage

| Stage | Allowed tools |
|---|---|
| Planner | Read, Glob, Grep, WebFetch, Bash(gh issue view/list/comment) |
| Critic | Read, Glob, Grep, Bash(gh issue view/comment) |
| Implementer | Read, Glob, Grep, Edit, Write, Bash(git/npm/npx/tsx/python3/gh issue view/comment) |
| Verifier | Read, Glob, Grep, Edit, Bash(git/npm/tsx/gh issue view/comment/gh pr create/merge) |

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
