---
tags:
  - type/staging
  - scope/eval-system
  - status/active
---

# Eval Proposals

Staged proposals from /fix for conversion to eval YAML via `sim-test eval --proposals`.
Each proposal describes an expected behavior that should be tested as a Layer 4 eval.

### 2026-04-03: Evaluate whether hint counter display adds player value
- **Source**: feedback
- **Track**: judgment
- **Category**: coaching
- **Sim**: any
- **What to test**: Hint tracking should provide useful signal without discouraging hint usage
- **What went wrong**: Player reports hint counter feels unnecessary; hints should guide freely

### 2026-04-03: Session data completeness in web mode
- **Source**: activity-log
- **Track**: deterministic
- **Category**: enablement
- **Sim**: any
- **What to test**: After a web play session with 3+ turns, session.json should have non-zero question_profile counts
- **What went wrong**: All counts were 0 after 8 player turns due to subprocess architecture losing context per turn

### 2026-04-03: Scoring progression rate
- **Source**: feedback
- **Track**: judgment
- **Category**: scoring
- **Sim**: any
- **What to test**: After 10 sims, beginner polygon should reflect early-stage learning, not expert level
- **What went wrong**: Player at 10 sims had Analyst rank despite self-reporting as beginner due to purely additive scoring
