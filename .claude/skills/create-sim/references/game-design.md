---
tags:
  - type/reference
  - scope/game-design
  - status/active
---

# Game Design Best Practices

Reference for the create-sim and play skills. Distills findings from text-based game design, interactive fiction investigation mechanics, and incident response tabletop exercises into actionable guidance for AWS incident simulations.

---

## 1. Investigation as Search Mechanic

**Source:** Her Story / Telling Lies (Sam Barlow)

**Principle:** The player queries a database using keywords, watches fragments, and builds connections themselves. Searching is the gameplay -- not a means to get to gameplay.

**What this means for our sims:** Players query AWS service consoles (CloudTrail, CloudWatch, IAM, S3) and receive raw data. They must connect evidence across services to build a theory. The system displays; the player analyzes.

**create-sim application:**
- Distribute evidence fragments across multiple service consoles -- never put the full picture in one artifact
- Design artifacts so that a finding in one console (e.g., a suspicious IP in CloudTrail) becomes a search term in another (e.g., VPC Flow Logs)
- Leave breadcrumbs that reward curiosity: timestamps that correlate, ARNs that recur, error codes that point elsewhere
- Include plausible noise in artifacts so players must distinguish signal from irrelevant data

**play application:**
- Return raw console output when the player queries a service -- do not summarize or interpret findings
- Never volunteer which service the player should check next
- When the player connects two pieces of evidence, acknowledge the connection without confirming or denying the conclusion
- Encourage note-taking by referencing details the player mentioned earlier in conversation

**What to avoid:**
- Narrating conclusions the player has not reached ("As you can see, the attacker used this role to...")
- Putting all critical evidence in a single artifact
- Interpreting raw data on behalf of the player

---

## 2. Progressive Hint Design

**Source:** Broken Sword 5 hint system; interactive fiction design conventions

**Principle:** Each hint access gives progressively more detail, creating a flexible difficulty curve. Hints should feel fair -- in hindsight, the player should believe the solution was discoverable.

**What this means for our sims:** Hints move from vague nudges toward specific guidance. Each level acknowledges the player's current progress rather than repeating generic advice.

**create-sim application:**
- Write 3-4 hint levels per resolution step, progressing from thematic nudge to specific service to exact artifact detail
- Tag each hint with the services and investigation paths it relates to (used by play for adaptive delivery)
- Ensure the first hint level never names a specific service -- it should point to a category of thinking ("What would show you who accessed this resource?")
- Ensure the final hint level is specific enough to unblock a stuck player without giving away the full answer

**play application:**
- Track which hint level the player has seen for each resolution step
- When delivering a hint, reference what the player has already done ("You have already looked at CloudTrail -- consider what else logs network-level activity")
- Weave hints into narrative beats: a Slack message from a teammate, a page from monitoring, a comment from the incident commander
- Never present hints as a numbered help menu

**What to avoid:**
- Fixed-sequence hints that repeat what the player already knows
- Hints that feel like a cheat sheet rather than a natural part of the story
- Skipping directly to the answer without intermediate levels

---

## 3. Adaptive Hint Delivery

**Source:** Adaptive difficulty research; player modeling in interactive fiction

**Principle:** Hints must account for what the player has already explored. If the player has already investigated a service, skip hints pointing to it. If the player has not touched a relevant service, nudge toward it.

**What this means for our sims:** The play skill tracks which consoles the player has queried and uses this history to select contextually appropriate hints.

**create-sim application:**
- Tag every hint with a `related_consoles` list so play can filter based on player history
- Write alternative hint paths for cases where the player has already explored the obvious service but missed the relevant detail within it
- Include "dig deeper" hints for services the player has visited superficially (queried but did not examine the right time range, filter, or field)

**play application:**
- Maintain a record of every console the player has queried and what filters/parameters they used
- When the player requests a hint, select from hints tagged with consoles they have NOT yet explored
- If all related consoles have been visited, shift to "dig deeper" hints that point to missed details within already-visited consoles
- Preserve vague-to-specific progression even within the adaptive selection

**What to avoid:**
- Telling the player to check CloudTrail when they already have CloudTrail output in front of them
- Ignoring the player's investigation history when selecting hints
- Delivering hints in a fixed order regardless of player behavior

---

## 4. Perceived Agency

**Source:** Agency research in interactive narrative ("The perception of agency may carry more weight than actual narrative control")

**Principle:** Players feel engaged when they believe their choices matter. Open investigation paths with fixed resolution criteria give both freedom and structure.

**What this means for our sims:** The player can investigate services in any order, form any hypothesis, and take any path -- but resolution requires identifying specific root cause elements. The freedom is real in investigation; the structure is in what counts as solved.

**create-sim application:**
- Define resolution criteria as a checklist of findings, not a sequence of steps -- the player can arrive at them in any order
- Design multiple valid investigation paths to the same root cause
- Include services that contain supporting but non-essential evidence so exploration feels rewarding even off the critical path
- Write the story opening to describe the situation, not the investigation plan -- let the player decide where to start

**play application:**
- Never prescribe an investigation order
- When the player chooses an unusual starting point, make it work -- return whatever that console would realistically show
- Describe the system as the player discovers it, not upfront -- reveal architecture details through console output rather than exposition
- Validate partial findings as the player builds toward full resolution

**What to avoid:**
- Requiring the player to investigate services in a specific order
- Front-loading a system architecture briefing that removes the discovery element
- Dismissing a player's hypothesis without letting them test it through console queries

---

## 5. Pleasantly Frustrating

**Source:** James Paul Gee, "What Video Games Have to Teach Us About Learning and Literacy"

**Principle:** Challenges should be hard enough to engage but achievable enough to not cause the player to quit. Failure holds few consequences, and rich debrief after struggle makes the struggle worthwhile.

**What this means for our sims:** Wrong diagnoses are learning moments, not failures. The difficulty curve is calibrated through hint budgets and artifact complexity. The debrief transforms struggle into understanding.

**create-sim application:**
- Calibrate artifact complexity to the sim's stated difficulty level (1-5)
- For lower difficulty: fewer red herrings, more obvious timestamp correlations, clearer error messages
- For higher difficulty: more noise in logs, subtler indicators, evidence spread across more services
- Write a rich resolution guide that maps each clue back to the root cause -- this is the payoff for the player's effort
- Include system visualization in resolution that shows how all the pieces connect

**play application:**
- When the player proposes an incorrect diagnosis, do not say "wrong" -- ask them to verify their theory against the evidence
- Track how long the player has been stuck and offer progressively stronger hints
- Frame the debrief as a learning conversation, not a score report
- Show the player what they found, what they missed, and how the pieces fit together

**What to avoid:**
- Punishing wrong guesses with negative feedback
- Making the debrief a flat answer reveal without connecting it to the player's investigation journey
- Setting difficulty so high that no amount of console queries can surface the needed evidence

---

## 6. Tabletop Exercise Realism

**Source:** Incident response tabletop exercise methodology (NIST, FEMA, industry IR practices)

**Principle:** Role assignment, time pressure, and storytelling techniques immerse participants. The exercise trains incident response tasks, communication, and decision-making -- not just technical diagnosis.

**What this means for our sims:** The player operates within an incident response context with teammates, time pressure, and organizational dynamics. The story beats create IR texture beyond raw technical investigation.

**create-sim application:**
- Define the player's role in the story opening (on-call engineer, security analyst, SRE) -- this grounds their perspective
- Create supporting characters who appear through story beats: incident commander requesting updates, legal asking about data exposure, comms lead drafting customer notifications
- Write time-based pressure beats into the story (e.g., "30 minutes in, your manager asks for an ETA on resolution")
- Include decision points beyond diagnosis: escalation calls, communication drafts, remediation prioritization

**play application:**
- Deliver story beats at appropriate investigation milestones, not on a fixed timer
- Voice supporting characters consistently -- the incident commander sounds different from the junior engineer
- Use time pressure to create urgency without artificial countdown mechanics
- When the player makes a remediation decision, show realistic consequences through updated console output

**What to avoid:**
- Reducing the sim to a pure technical puzzle with no organizational context
- Making time pressure punitive (auto-failing the player)
- Having all communication come from a single generic "team" voice

---

## 7. Text-Based Design Principles

**Source:** Text-based game design conventions; interactive fiction craft

**Principle:** Clear and concise language, player agency, imagination as a feature, consistent game world, and compelling narrative drive engagement in text-only formats.

**What this means for our sims:** Without visual UI, every word carries weight. All narrative text is rendered at play-time through the player's chosen theme. The AWS artifacts must be internally consistent, and the narrative must motivate investigation.

**create-sim application:**
- Write all narrative text in the established voice: dry, observational, precise
- Ensure internal consistency across all artifacts: timestamps must align, ARNs must resolve to the same resources, IAM policies must match the actions shown in logs
- Give the incident a human stakes narrative -- not just "find the misconfiguration" but "customer data may be exposed and the CISO wants answers before the board meeting"
- Keep artifact text concise -- real AWS console output is dense but structured, not verbose

**play application:**
- Match the narrative voice consistently across all story beats and narrator responses
- When the player queries a console, format output to match real AWS conventions (JSON for API responses, tabular for CLI output, plaintext for logs)
- Use the player's imagination as an asset -- describe enough for them to build a mental model, but do not over-describe
- Maintain game world consistency: if the player changed a security group in a remediation step, subsequent queries must reflect that change

**What to avoid:**
- Inconsistent tone shifts between narrative voice and console output framing
- Artifacts that contradict each other (timestamps that do not align, resources that appear in one artifact but not another)
- Verbose narration that slows the pace of investigation
- Breaking the fourth wall by referencing game mechanics ("You have 2 hints remaining")

---

## Quick Reference Matrix

| Principle | create-sim Priority | play Priority |
|---|---|---|
| Investigation as Search | Distribute evidence across consoles | Return raw data, never interpret |
| Progressive Hints | Write 3-4 levels per step, tagged | Deliver in narrative, track level |
| Adaptive Delivery | Tag hints with related_consoles | Filter by player history |
| Perceived Agency | Multiple valid paths, checklist criteria | Never prescribe order |
| Pleasantly Frustrating | Calibrate to difficulty level | No negative feedback on wrong guesses |
| Tabletop Realism | Roles, characters, time beats | Voice characters, milestone-based beats |
| Text-Based Design | Consistent voice, aligned artifacts | Match AWS output conventions |

---

## Related

- [[sim-template]] -- Gold-standard simulation package structure
- [[exam-topics]] -- Exam domain and incident pattern reference
- [[SKILL|create-sim SKILL]] -- Simulation generation workflow
- [[SKILL|play SKILL]] -- Gameplay and narration workflow
