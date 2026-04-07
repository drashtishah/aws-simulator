# Rollback Procedure

Triggered when `npm test` fails after a commit.

## Steps

### 1. Capture failure output

Save the test output for diagnosis. Note which tests failed and their error messages.

### 2. Revert immediately

    git revert HEAD --no-edit

This creates a new revert commit, preserving history. Never force-delete commits.

### 3. Verify revert fixed tests

    npm test

- **Tests pass**: the last commit was the cause. Proceed to step 4.
- **Tests still fail**: the problem predates the last commit. Use git bisect:

        git bisect start HEAD <last-known-good-commit>
        git bisect run npm test

  Then revert the identified commit with `git revert <bad-commit>`.

### 4. Diagnose

Read the reverted diff (`git show HEAD~1`) and the test failure output. Identify why the change broke tests. Common causes:

- Test assertions don't match the new behavior (update the test)
- The change introduced a real bug (fix the logic)
- The change has an unintended side effect (narrow the scope)

### 5. Fix forward

Make a new edit that addresses both the original goal AND the test failure. Then restart from step 1 of `references/architecture/core-workflow.md`.

## Principles

- Never force-delete commits. Always revert (creates an audit trail).
- Never skip tests. If tests are slow or flaky, fix the tests first.
- Diagnose before retrying. Understand why it broke before attempting a fix.
