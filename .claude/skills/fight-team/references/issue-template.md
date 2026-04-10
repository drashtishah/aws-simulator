# Fight-team Issue Template

Every Issue body filed by fight-team MUST follow this exact schema. The
coordinator runs every candidate body through `scripts/lib/validate-fight-team-issue.ts`
before calling `gh issue create`. Bodies that fail the validator are
regenerated (max 2 retries); on the third failure the coordinator surfaces
the malformed body to the user instead of filing.

## Schema (copy into the gh issue create body)

```markdown
## Finding
<one sentence; same as Issue title>

## Bucket and metric
- Bucket: <code|test|skill|command|hook|sim|reference|registry|config|memory_link>
- Metric: <metric from scripts/metrics.config.json>
- Current score: <n>
- Expected score after fix: <n>
- Point gain: <delta>

## Evidence
- `<absolute path>:<line>` , <what is wrong here>
(at least one; absolute paths only; matches \.(ts|md|json|jsonl|js)(:\d+))

## Current behavior
<3 to 8 lines, concrete; quote offending code if under 15 lines>

## Expected behavior
<3 to 8 lines, concrete>

## Suggested approach
1. Edit `<path>` lines X to Y to do ...
2. Add new file `<path>` containing ...
3. Run `<command>` to verify ...
(numbered steps, each names a path; downstream agent copies into a plan with no extra research)

## Verification
\`\`\`bash
npm run health
npx tsx scripts/test.ts run --files <glob>
\`\`\`

## Debate transcript excerpts
- **Challenger r1:** <verbatim, max 5 lines>
- **Defender r2 rebuttal:** <verbatim, max 5 lines>
- **Challenger r2 counter:** <verbatim, max 5 lines>
- **Steelman r3 by Defender:** <verbatim, max 5 lines>
- **Convergence note:** <one line: why this finding survived>

## Labels
- source:fight-team-weekly
- priority:high if both agreed by r3, else priority:investigate
- bucket:<bucket>
- metric:<metric>

## Linked context
- System vault finding cluster: learning/system-vault/findings/<slug>.md
- Health score entry: learning/logs/health-scores.jsonl line <N>, run <ts>
```

## Hard requirements (enforced by validator)

1. All sections above present (## Finding, ## Bucket and metric, ## Evidence, ## Current behavior, ## Expected behavior, ## Suggested approach, ## Verification, ## Debate transcript excerpts, ## Labels, ## Linked context).
2. Evidence section has at least 1 `path:line` matching `\.(ts|md|json|jsonl|js):\d+`. Absolute paths only (must start with `/`).
3. Suggested approach has at least 1 numbered step naming a path.
4. Verification has at least 1 fenced code block.
5. Debate transcript has at least 3 of the 4 bullet labels: Challenger r1, Defender r2 rebuttal, Challenger r2 counter, Steelman r3 by Defender.
6. Body length 600 to 4000 characters.
