## Text-only change

This issue is labeled text-only. Override the base workflow:
- Skip TDD. No tests needed for pure text changes.
- Apply the plan's edits directly.
- Commit message format: `docs: <thing>` with `Ref #{{ISSUE}}`.
- Still run `npm test` before pushing (catches broken path references).
