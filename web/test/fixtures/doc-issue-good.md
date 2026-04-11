## Finding
ownership.json for play skill claims a directory already owned by setup, causing ownership_integrity score to drop.

## Bucket and metric
- Bucket: skill
- Metric: ownership_integrity
- Current score: 88
- Expected score after fix: 100
- Point gain: 12

## Evidence
- `/home/runner/work/aws-simulator/aws-simulator/.claude/skills/play/ownership.json:1` , declares `learning/feedback.md` which is also declared by setup ownership.json
- `/home/runner/work/aws-simulator/aws-simulator/.claude/skills/setup/ownership.json:1` , the original owner of `learning/feedback.md`

## Current behavior
Two skills both claim `learning/feedback.md` as an owned directory. The aggregator in scripts/code-health.ts emits an `ownership_integrity` finding for every overlap pair, dragging the skill bucket composite down by twelve points.

## Expected behavior
Each directory has exactly one owner. Ownership is unambiguous so that /fix and /doc can route findings to a single skill without coordinator arbitration.

## Suggested approach
1. Edit `/home/runner/work/aws-simulator/aws-simulator/.claude/skills/play/ownership.json` lines 1 to 5 to remove the `learning/feedback.md` entry from `dirs`.
2. Run `/home/runner/work/aws-simulator/aws-simulator/scripts/code-health.ts` to confirm the overlap finding disappears.
3. Add a regression test in `/home/runner/work/aws-simulator/aws-simulator/web/test/code-health.test.ts` covering the no-overlap invariant for `learning/feedback.md`.

## Verification
```bash
npm run health
npx tsx scripts/test.ts run --files web/test/code-health.test.ts
```

## Review excerpts
- **Challenger lens:** Two ownership.json files claim the same dir; the scorer counts this twice and the bucket composite drops twelve points. Evidence: `/home/runner/work/aws-simulator/aws-simulator/.claude/skills/play/ownership.json:1`
- **Defender lens:** Overlap was intentional because both skills write session notes; conceded after grep shows zero writes from play/ to learning/feedback.md in code.
- **Steelman pass:** Removing the entry from play is the cleanest fix; paired with a SKILL.md update so the documented intent is preserved.

## Labels
- source:doc
- priority:high
- bucket:skill
- metric:ownership_integrity
- needs-human

## Linked context
- Health score entry: learning/logs/health-scores.jsonl line 42, run 2026-04-07T10:00:00Z
