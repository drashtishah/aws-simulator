# Fight-Team Default Checklist

13 review topics for adversarial workspace debate. Each topic includes what to look for and which files/dirs to examine.

---

## 1. Skill modularity and integration

Are skills modular with clean boundaries? Does `ownership.json` correctly partition access? Are logs and session data read/interpreted effectively by consuming skills?

**Look at:** all `ownership.json` files, `references/workspace-map.md` shared data table, cross-skill data flow.

## 2. Test coverage and expansion

Are the unit tests sufficient? What code paths lack coverage? What creative deterministic tests can we add (property-based, round-trip, schema validation, idempotency, regression)? Can we generate fixtures from real session data?

**Look at:** `web/test/`, `web/test-specs/`, `references/testing-system.md`, `scripts/code-health.ts` test_sync metric.

## 3. Simplification opportunities

Is the project too complicated for what it does? Are there files, folders, or abstractions that exist "just in case"? Can multi-step workflows be collapsed?

**Look at:** entire directory tree, skill SKILL.md lengths, reference file count, hook complexity.

## 4. Blind spots and failure modes

What are we not thinking about? What happens when things fail (corrupted sessions, malformed manifests, missing sims)? What assumptions could break silently?

**Look at:** error handling in `web/lib/`, skill edge cases, data validation.

## 5. Agent navigability

Can a fresh agent find what it needs from `CLAUDE.md` and `references/workspace-map.md` alone? Is there too much reference material for context windows? Are SKILL.md files concise or bloated? Can agents trace data flow without reading every file?

**Look at:** all SKILL.md files, `references/` folder, `CLAUDE.md`.

## 6. Player experience (setup to play)

Is the setup-to-play path smooth? Are error messages and coaching patterns helpful for AWS learning? Does the feedback loop (play, feedback, fix) actually close?

**Look at:** `.claude/skills/setup/SKILL.md`, `.claude/skills/play/SKILL.md`, `.claude/skills/play/references/coaching-patterns.md`.

## 7. Workflow robustness

What breaks if: /play without /setup? /create-sim generates bad manifest? Web server starts but Claude subprocess fails? /fix runs with empty inputs?

**Look at:** each skill's entry point and precondition checks.

## 8. GitHub Issues health

Are open issues well-scoped? Are there missing issues for known problems? What new issues should exist?

**Look at:** `gh issue list`, git log for unresolved TODOs.

## 9. Web app and API coherence

Does the web app correctly consume all shared data files? Are API endpoints tested for edge cases? Is the prompt-builder aligned with all sim manifests?

**Look at:** `web/server.ts`, `web/lib/`, `web/test/`, `web/public/`.

## 10. Sim quality and consistency

Are all sims consistent in structure? Do manifests follow the schema? Are stories and resolutions well-written for learning?

**Look at:** `sims/`, `sims/registry.json`.

## 11. Hook and guard system

Are hooks correctly enforcing constraints? Is guard-write coverage complete? Are there gaps where unprotected writes could happen?

**Look at:** `.claude/hooks/`, `web/test/guard-write.test.ts`, `web/test/guard-coverage.test.ts`.

## 12. Data flow integrity

Can data get corrupted as it flows between skills? Are there race conditions (e.g., two sessions writing `learning/profile.json`)? Is session cleanup reliable?

**Look at:** `references/workspace-map.md` shared data table, session lifecycle in play skill.

## 13. Documentation vs. reality

Does `references/workspace-map.md` match the actual codebase? Are there undocumented components? Does `CLAUDE.md` accurately describe the workspace?

**Look at:** compare documented components vs actual directory tree.
