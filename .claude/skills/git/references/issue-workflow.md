# Issue Workflow

GitHub Issues are the planning and tracking layer for all work.

## Labels

Three labels: `bug`, `enhancement`, `chore`.

## Creating issues

Before starting any work item:

    gh issue create --title "<type>: <description>" --label "<label>" --body "<context>"

The body should include:
- Source (feedback entry, plan step, user request)
- Affected files or skills
- Expected outcome

## Creating issues from a plan file

Use the task-to-issue procedure in `.claude/skills/git/references/task-to-issue.md`:

1. Read the plan file
2. Create a task per plan step (Stage 1)
3. Promote each task to a GitHub Issue (Stage 2)
4. Record the task-to-issue mapping for commit references

## Closing issues

- `Closes #N` in commit messages for auto-close on push
- `Ref #N` for partial progress
- Manual close for non-code resolutions: `gh issue close #N --reason "not planned"`

## Rules

- Every code change should trace back to an issue
- Small ad-hoc fixes can share an issue (create one, reference from multiple commits)
- Issues are the single source of truth for "what work exists"
- Do not create issues during /play sessions
