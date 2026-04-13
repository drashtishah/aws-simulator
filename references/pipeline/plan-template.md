## Plan
### Scope
- [ ] Focused (1-3 files, one concern)
- [ ] Text/docs only (no code, no tests needed)
- [ ] System-wide (multiple directories, cross-cutting)
Check one. If system-wide, explain WHY in one sentence.
If text/docs only, the implementer skips TDD and commits directly.
### Files to read
- path/to/file.ts, why it matters
### Files to change
- path/to/file.ts:LINE, what changes (include old/new strings)
### Files NOT to touch
- ...
### Tests
- new test: web/test/foo.test.ts (failing test first, always)
- existing tests that must still pass: ...
- Testing layers: see `references/architecture/testing-system.md`
  (Layer 1: unit, Layer 2: browser specs, Layer 4: evals).
### Verification command
- npm test
### Risks / open questions
- ...
### Decomposition (only if split occurred)
- [ ] Decomposed: child issues created for remaining concerns
- Retained concern: <what this issue now covers>
- Child issues: #N (summary), #M (summary)
