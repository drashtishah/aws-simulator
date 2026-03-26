Apply accumulated feedback to improve the simulation skills.

1. Read `learning/feedback.md`. If there are no entries beyond the header, say "No feedback to process." and stop.

2. Group feedback entries by target:
   - Feedback about sim content, narrative, artifacts, difficulty --> target: `create-sim` skill and `references/sim-template.md`
   - Feedback about play flow, coaching, hints, console behavior --> target: `play` skill and its references
   - Feedback about both or unclear --> present to user for classification

3. For each group of actionable feedback:
   - Read the target skill's `SKILL.md` and relevant reference files
   - Use the skill-creator skill for guidance on skill editing best practices
   - Enter plan mode to design the changes
   - Present the plan to the user for approval
   - After approval, apply edits to the target files

4. After all changes are applied, clear the processed entries from `learning/feedback.md` (keep the frontmatter header intact).

5. Commit skill changes: `git commit -m "improve: apply feedback from learning/feedback.md"`
