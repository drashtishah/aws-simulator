# Commit Procedure

Follow this procedure after every code change. All skills that make edits reference this document.

## Steps

### 1. Check working tree

    git status --short

Identify which files changed and why.

### 2. Decide commit boundaries

Each commit is one logical change. If the working tree has changes from two different concerns, split into two commits. Stage and commit each separately.

### 3. Stage specific files

    git add <file1> <file2>

Never use `git add -A` or `git add .`. Only stage files relevant to this logical change.

### 4. Build commit message

Write the conventional commit header. Add issue reference. Add action lines per `.claude/skills/git/references/contextual-commits-spec.md`. At minimum, include `intent`.

### 5. Commit

Use a heredoc for multi-line messages:

    git commit -m "$(cat <<'EOF'
    <type>(<scope>): <subject>

    Closes #<N>

    intent(<scope>): <goal>
    decision(<scope>): <approach and why>
    EOF
    )"

### 6. Run tests

    npm test

This runs path extraction + all deterministic tests (~5-10 seconds).

### 7. Handle test result

- **Pass**: done. Move to next change or finish.
- **Fail**: follow `.claude/skills/git/references/rollback-procedure.md`.

## When to use

- After every code edit made by /fix, /create-sim, /upgrade, /sim-test
- After every manual refactoring edit
- NOT during /play sessions (game state, not code)
