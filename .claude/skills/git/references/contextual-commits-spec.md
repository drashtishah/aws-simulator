# Contextual Commits Spec

Extends Conventional Commits with typed action lines in the commit body. Action lines capture decision context that diffs lose.

## Format

    <type>(<scope>): <subject>

    [Closes #<issue> | Ref #<issue>]

    [intent(<scope>): <the user's goal>]
    [decision(<scope>): <chosen approach and why>]
    [rejected(<scope>): <explored but discarded options>]
    [constraint(<scope>): <hard limits shaping implementation>]
    [learned(<scope>): <discovered quirks and gotchas>]

## Types

feat, fix, improve, refactor, test, chore, docs

## Scopes

Use the area of the codebase: play, scoring, sim, skills, web, hooks, test, git

## Rules

1. Subject line: imperative, lowercase, no period.
2. At minimum include `intent`. Others when relevant.
3. `rejected` and `learned` are the most valuable for future recall. Include them when a non-obvious choice was made.
4. Issue reference: `Closes #N` when the commit fully resolves the issue. `Ref #N` for partial progress.
5. Small changes (typo, config tweak) need only type/scope/subject and intent. Action lines scale with decision significance.

## Querying

    # Find all decisions about scoring
    git log --all --grep="decision(scoring)" --format="%h %s%n%b"

    # Find all rejected approaches
    git log --all --grep="rejected(" --format="%h %s%n%b"

    # Find what was learned about a service
    git log --all --grep="learned(dynamodb)" --format="%h %s%n%b"

## Example

    feat(play): include correlate category in hexagon score update

    Closes #7

    intent(scoring): fix hexagon polygon so correlate progress is visible to players
    decision(scoring): add correlate to the category list in Phase 3 scoring block,
      same pattern as gather/diagnose/impact/trace/fix
    rejected(scoring): considered recalculating all categories from session history
      instead of incremental update, but that would be slower and break the existing
      per-question update pattern
    learned(play): the Phase 3 scoring block has a hardcoded category list that must
      be updated whenever new question types are added
