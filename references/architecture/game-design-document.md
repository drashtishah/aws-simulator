# Game Design Document

Single source of truth for all game mechanics. See `references/config/progression.yaml` for the machine-readable config.

---

## Core Loop

Investigate, diagnose, fix, learn. Each sim is a complete loop:

1. Player receives an incident alert (scenario brief)
2. Player investigates by querying simulated AWS consoles
3. Player diagnoses the root cause and proposes a fix
4. Player debriefs to consolidate learning
5. System scores the session and updates the learning vault

---

## Skill Polygon

6 axes forming a hexagon. Each axis represents an investigation skill:

| Axis | Label | Description |
|------|-------|-------------|
| gather | Gather | Information collection |
| diagnose | Diagnose | Root cause identification |
| correlate | Correlate | Cross-service analysis |
| impact | Impact | Blast radius assessment |
| trace | Trace | Change investigation and audit |
| fix | Fix | Remediation proposals |

Points per axis per sim are weighted by question quality (see below). The polygon grows slowly due to diminishing returns, with quality acting as a multiplier.

---

## Question Quality Rubric

The core skill the player develops. Each question is scored on 4 dimensions, each 0-2, total 0-8:

| Dimension | 0 | 1 | 2 |
|-----------|---|---|---|
| Specificity | Vague ("what happened?") | Somewhat targeted ("check the logs") | Precise ("show me CloudTrail events for IAM role changes in us-east-1 in the last 24 hours") |
| Relevance | Unrelated to incident | Tangentially related | Directly advances investigation |
| Building | Standalone, ignores previous info | Loosely follows up | Explicitly references prior response data |
| Targeting | No specific service/component | Names a service | Names a service AND specifies what to look for |

The play agent scores each question inline during the investigation loop. Players see their scores during coaching feedback with concrete examples.

---

## Scoring Formula

```
quality_factor = clamp(avg_session_quality / 8, 0.25, 1.0)
multiplier = max(min_multiplier, 1 / (1 + floor(total_sessions / ramp_interval)))
points_per_axis = round(base_points * multiplier * quality_factor)
```

Current parameters (from `references/config/progression.yaml`):
- base_points: 1
- ramp_interval: 3
- min_multiplier: 0.05
- quality_weight: 0.5
- quality_threshold: 4

---

## Rank Definitions

10 tiers designed for 1000+ sims. Each rank has a polygon gate, a quality gate, and a minimum sessions requirement.

| # | Rank | Polygon Gate | Quality Gate | Min Sessions | Max Difficulty | Cumulative Sims |
|---|------|-------------|-------------|-------------|----------------|-----------------|
| 1 | Responder | (none) | (none) | (none) | 1 | 1-20 |
| 2 | Junior Investigator | any 2 axes >= 1 | avg >= 2/8 | 15 | 1 | 20-50 |
| 3 | Investigator | gather >= 2, diagnose >= 2 | avg >= 3/8 | 30 | 2 | 50-100 |
| 4 | Senior Investigator | gather >= 3, 3 axes >= 2 | avg >= 3/8 | 40 | 2 | 100-170 |
| 5 | Analyst | 3 axes >= 3 | avg >= 4/8 | 50 | 3 | 170-260 |
| 6 | Senior Analyst | correlate >= 4, 4 axes >= 3 | avg >= 4/8 | 60 | 3 | 260-370 |
| 7 | Incident Commander | all >= 3, 3 axes >= 4 | avg >= 5/8 | 70 | 4 | 370-500 |
| 8 | Senior Commander | all axes >= 4 | avg >= 5/8 | 80 | 4 | 500-650 |
| 9 | Chaos Engineer | all >= 5, 3 axes >= 6 | avg >= 6/8 | 90 | 4 | 650-820 |
| 10 | Chaos Architect | all axes >= 6 | avg >= 6/8 | 100 | 4 | 820-1000+ |

The min_sessions_at_rank gate is the primary pacing mechanism: even with high polygon values, the player must spend enough time at each rank to demonstrate sustained quality.

### Difficulty Unlocks

- Difficulty 1: ranks 1-2 (Responder, Junior Investigator)
- Difficulty 2: ranks 3-4 (Investigator, Senior Investigator)
- Difficulty 3: ranks 5-6 (Analyst, Senior Analyst)
- Difficulty 4: ranks 7-10 (Incident Commander through Chaos Architect)

### Sawtooth Difficulty Pacing

First sim in a new category feels slightly easier than the last sim of the previous category. Difficulty oscillates within each rank: challenge, consolidation, challenge, consolidation. This keeps the player in flow state.

---

## Tiered Decay

Skills fade without practice. Decay rate depends on rank tier:

| Tier | Ranks | Warn | Decay | Min Value | Floor |
|------|-------|------|-------|-----------|-------|
| Fast | Responder, Junior Investigator, Investigator | 10 days | 21 days | 2 | 0 |
| Medium | Senior Investigator, Analyst, Senior Analyst, Incident Commander | 14 days | 28 days | 3 | 1 |
| Slow | Senior Commander, Chaos Engineer, Chaos Architect | 21 days | 42 days | 4 | 2 |

Higher ranks decay more slowly because the skills are more deeply ingrained. Each tier has a floor to prevent catastrophic skill loss.

---

## Spaced Repetition

Concepts encountered in sims are tracked in the learning vault. When a concept has not appeared in recent sims, the sim selector prioritizes sims that exercise it. Modified Fibonacci intervals: the sorting weight for stale concepts increases over time.

---

## Behavioral Profile

Observable behaviors tracked across sessions (not fixed types):

- **Approach pattern**: first action frequencies (logs, architecture, permissions, metrics, recent changes, immediate fix)
- **Error response**: retry same approach vs pivot to different service
- **Hint usage**: resist vs seek
- **Confidence calibration**: questions before first fix attempt, first-attempt accuracy
- **Investigation breadth**: services queried vs available
- **Debrief engagement**: questions asked, zones explored
- **HEXAD signals**: inferred from behavior (Achiever, Free Spirit, Player, Socializer)

Tracked in `learning/player-vault/patterns/behavioral-profile.md`, updated after each sim.

---

## Progressive Clues

Author-supplied clues the play agent reaches for when the player stalls:

- Clues are pre-authored per sim in `manifest.progressive_clues`, a string array ordered vague-to-specific
- The play agent receives the full sim package (manifest, story, resolution, artifacts) at session start and decides if and when to surface a clue
- No scheduling triggers, no skip-if-queried logic; the agent reads the room
- Hint-prompted questions still count for question-quality scoring, no separate penalty

---

## Sim Replay

Players can replay completed sims:

- Replayed sims give 50% of normal polygon points
- Question quality scores from replays count toward the running average
- Replays appear in the vault with `replay: true` frontmatter
- Replays with challenge modifiers give full points
- Critical early on when sim count is low

---

## Challenge Modifiers

Opt-in constraints unlocked at Incident Commander (rank 7). Custom constraints unlock at Chaos Architect (rank 10).

| Modifier | Description | Bonus Axes |
|----------|-------------|------------|
| Fog of War | One service console is hidden | correlate, diagnose |
| Clock Pressure | 15-minute investigation deadline | gather, fix |
| Signal Noise | Extra misleading log entries | diagnose, trace |
| Solo Responder | No hints available | correlate, trace |

---

## Debrief as Progression Factor

Debrief engagement affects quality scoring:

- Debrief questions are scored the same way as investigation questions
- Sessions with 0 debrief questions: 0.7x multiplier on session quality average
- Sessions with 3+ debrief questions across 2+ zones: 1.1x bonus (capped at 8/8)
- Not a gate: players can skip debrief and still progress, just slower

---

## Session Abandonment

When a player quits mid-sim:

- Session stays with `status: in_progress`
- No points awarded, no vault notes compiled
- Player offered to resume on next `/play`
- If starting a different sim, abandoned session archived with `status: abandoned`
- Abandoned sessions do not count as completed or toward sessions_at_current_rank
- Vault behavioral profile tracks abandonment rate

---

## Related

- `references/config/progression.yaml`: machine-readable progression config
- `.claude/skills/play/references/coaching-patterns.md`: coaching feedback templates
- `learning/player-vault/index.md`: learning vault entry point
