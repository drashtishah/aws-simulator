# Task-to-Issue Procedure

Work items flow through two stages: in-session tasks for progress tracking,
then GitHub Issues for persistent tracking.

## Stage 1: Create tasks

For each work item, call TaskCreate with:
- subject: imperative description (e.g., "Fix scoring regression in correlate category")
- Include source (feedback, log, plan step), affected files, and expected outcome

## Stage 2: Promote tasks to issues

After tasks are created and user confirms the list, create a GitHub Issue for each:

    gh issue create --title "<type>(<scope>): <subject>" \
      --label "<bug|enhancement|chore>" \
      --body "<source and context from task>"

Update the task description with the issue number for commit references.

## Stage 3: Work through tasks

As the skill works on each item:
1. Mark task in_progress
2. Do the work
3. Commit with `Closes #N` or `Ref #N` referencing the issue
4. Mark task completed

## Bulk pattern

For skills that discover multiple items at once (like /fix):
1. Create ALL tasks first (gives user a full picture)
2. Present task list to user for confirmation
3. Promote confirmed tasks to issues
4. Work through them sequentially

## Rules

- Every code-driving work item gets both a task AND an issue
- Tasks are session-scoped; issues are the permanent record
- Do not create tasks during /play sessions
