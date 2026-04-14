---
tags:
  - type/reference
  - scope/story-structure
  - status/active
---

# Story Structure: What story.md Should Contain

Reference for the create-sim skill. Describes what the author captures in `story.md` for each sim. The play agent is given `story.md`, the full manifest, `resolution.md`, and the player's theme at session start. It decides when (and whether) to narrate any of this material during the session. Authors do not schedule beats.

This is not a player-facing document.

---

## What story.md Carries

story.md carries Opening and Resolution prose the agent reaches for. The agent decides when to narrate, without triggers. Two sections, both written as structured facts rather than styled prose. The agent supplies the voice at runtime.

### Opening

The state of the ordinary world right before the alert fires, plus the inciting alert itself. The author provides facts; the agent reaches for them when the session begins.

Include:
- Company, industry, product, scale (specific numbers: users served, transaction volume, team size)
- Time, scene, the exact alert text
- Stakes (concrete deadlines, real user impact)
- Early signals: what users and stakeholders are reporting
- Investigation starting point: what the player already knows when they sit down

Keep it efficient. Two to four paragraphs worth of material, not two pages. The ordinary world grounds the player so the disruption has weight.

Good: "Meera is the only infrastructure engineer at Canopy Health. The patient portal serves twelve clinics. It is 2:15 PM and the on-call phone rings. The portal login page returns a 504."

The company is small. The person is alone. The product matters to real people. The alert is specific. The facts carry the weight.

### Resolution

What actually happened, written as facts the agent draws on during the debrief. This is the full explanation: who did what, when, why, and how it was fixed.

Include:
- Root cause: what went wrong, when, who, what specific resource
- Mechanism: how the root cause produces the symptoms the player observed
- Fix: the specific remediation action and its immediate effect
- Contributing factors: the systemic issues that allowed this to happen

The Resolution is the ground truth. The agent uses it to confirm the player's diagnosis, fill in gaps the player did not uncover, and connect the incident to broader architectural principles.

---

## Quality Guidelines

### Flat Voice, Concrete Detail

The register is observational, not breathless. Tension accumulates through specific facts, not adjectives about urgency. Avoid "the dreaded alert," "time is running out," or other editorial framing. The agent handles tone at runtime.

Good: "Three merchants have emailed support about exposed transaction records."
Bad: "Customers are in a panic as their data hangs in the balance."

### Specific Numbers

Every scale claim is a number. "2,300 small merchants." "$4.2 million in daily transaction volume." "14,847 files for six days." The specificity is what makes the stakes feel real.

### No Resolution Hints in the Opening

The Opening states symptoms and stakes. It does not hint at the root cause or tell the player where to look. That is the agent's job during play, and it uses `progressive_clues` from the manifest for pacing.

---

## Common Anti-Patterns

- **The overwritten opening**: Three paragraphs of company backstory before the alert arrives. Establish the ordinary world efficiently, then cut to the alert.
- **Scripted drama**: Exclamation marks, ticking clocks, "your heart races." The agent picks the voice at session start based on the player's theme; the story file should not pre-stage emotion.
- **Resolution in the Opening**: The Opening reveals the root cause or names the misconfigured resource. This strips the investigation of any investigative work. Keep Opening and Resolution separate.
- **Missing mechanism**: The Resolution names the root cause and the fix but skips the mechanism (how the cause produces the symptoms). Without it, the player learns what was broken but not how the failure propagated.
- **Vague stakes**: "Many users are affected." Replace with concrete numbers and the specific harm (data exposure, service outage, cost overrun).

