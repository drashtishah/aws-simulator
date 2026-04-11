# Issue grouping heuristics

The /fix skill groups open Issues, feedback notes, and health findings
into a small number of plan groups before delegating to
`superpowers:writing-plans`. Use these heuristics in step 5 of /fix.

## Group by label first

Open Issues are pre-labelled by fight-team and other sources:

- bucket:<bucket> groups all findings touching the same bucket (code,
  test, skill, command, hook, sim, reference, registry, config,
  memory_link). Strong group signal.
- metric:<metric> is tighter than bucket. Findings sharing a metric
  almost always share a fix shape.
- priority:high and priority:investigate split into separate plans.
  Investigate items become research notes, not edits.
- source:fight-team indicates the body already passed the
  fight-team validator and the Suggested approach is copy-paste-ready.

## Group by root cause

When labels are insufficient, group by root cause:

- Same file referenced by multiple findings: one group.
- Same import graph subtree: one group.
- Same skill directory: one group.

## Group by feedback theme

Feedback notes from `learning/feedback.md` cluster by topic. If a
feedback theme matches an open Issue, attach the feedback to that
Issue's group as "user reinforced this." Orphan feedback (no matching
Issue) becomes a separate group with the action "propose creating an
Issue."

## Hard constraint

Every plan group must reference at least one open Issue OR at least
one feedback note by date. Orphan-feedback groups must propose creating
an Issue as their first numbered step.
