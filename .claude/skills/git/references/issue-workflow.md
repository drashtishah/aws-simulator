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

When starting a plan implementation:

1. Read the plan file
2. Extract each task's title
3. Create one issue per task:

        gh issue create --title "feat: <task title>" --label "enhancement" --body "Plan: <plan-file-path>
        Task: <N>
        Files: <list of files from task>"

4. Record the mapping of task number to issue number for commit references

## Closing issues

- `Closes #N` in commit messages for auto-close on push
- `Ref #N` for partial progress
- Manual close for non-code resolutions: `gh issue close #N --reason "not planned"`

## Rules

- Every code change should trace back to an issue
- Small ad-hoc fixes can share an issue (create one, reference from multiple commits)
- Issues are the single source of truth for "what work exists"
- Do not create issues during /play sessions
