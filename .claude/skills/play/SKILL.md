---
name: play
description: Run an AWS incident simulation as an interactive agent team. Presents available sims based on learning level, spins up Narrator + service agents, tracks investigation and validates fixes, updates learning profile and services catalog. Use when user says "play", "start sim", "run simulation", "practice AWS", or "let's play".
---

# play Skill

Runs an AWS incident simulation end-to-end. Consumes sim packages from `sims/{id}/` and orchestrates a team of agents: one Narrator (game master) and N service agents (AWS console emulators).

---

## Phase 1: Setup

### 1. Load Learner Profile

Read `learning/profile.json`. If the file is missing or empty, create it with this default:

```json
{
  "current_level": 1,
  "completed_sims": [],
  "unlocked_levels": [1],
  "service_exposure": {},
  "question_patterns": {
    "first_action_frequency": {
      "logs": 0, "permissions": 0, "architecture": 0,
      "metrics": 0, "recent_changes": 0, "immediate_fix": 0
    },
    "avg_questions_before_fix": 0,
    "audit_trail_check_rate": 0.0,
    "multi_service_investigation_rate": 0.0
  },
  "weaknesses": [],
  "strengths": [],
  "total_sessions": 0,
  "last_session": null
}
```

### 2. Check for In-Progress Sessions

List files in `learning/sessions/`. If any `.json` files exist with `"status": "in_progress"`:

- Read each session file to get the sim_id and investigation_summary
- Present to the user: "You have an in-progress session: {sim title}. Resume or start fresh?"
- Wait for the user's choice via conversation

### 3. Filter Eligible Simulations

Read `sims/registry.json`. A sim is eligible if ALL of these are true:

- `difficulty` <= `profile.current_level` (or difficulty is in `profile.unlocked_levels`)
- `id` is NOT in `profile.completed_sims`
- All entries in `prerequisites` (if any) are in `profile.completed_sims`

If no sims are eligible, tell the user: "No eligible simulations at your current level. Run create-sim to generate more." Then stop.

### 4. Present Available Simulations

Sort eligible sims with weakness-targeting sims first:

1. Sims whose `services` array overlaps with `profile.weaknesses` -- show these first
2. Remaining eligible sims sorted by difficulty ascending

Present each sim:

```
{number}. {title}
   Difficulty: {difficulty} | Category: {category}
   Services: {comma-separated services}
   Estimated time: {estimated_minutes} minutes
```

Ask the user to pick a sim. Wait for their response.

---

## Phase 2: Team Creation

### 5. Load Sim Package

Read the selected sim's files:

- `sims/{id}/manifest.json` -- full manifest
- `sims/{id}/story.md` -- narrative
- `sims/{id}/artifacts/context.txt` -- briefing card for opening
- `sims/{id}/artifacts/architecture-hint.txt` -- clean architecture diagram (late hint)
- `sims/{id}/artifacts/architecture-resolution.txt` -- marked architecture diagram (debrief)
- All artifact files referenced in `manifest.team.agents[].artifacts`

### 6. Prepare Prompt Templates

Read `.claude/skills/play/references/agent-prompts.md` for the two prompt templates.

### 7. Create Agent Team

Use TeamCreate to create a team named `sim-{id}`.

### 8. Spawn Narrator Agent

Populate the Narrator prompt template from `references/agent-prompts.md`:

- Insert `manifest.team.narrator.personality`
- Insert `manifest.company` fields (name, industry, size)
- Insert full contents of `story.md`
- Insert full contents of `artifacts/context.txt`
- Insert full contents of `artifacts/architecture-hint.txt`
- Insert full contents of `artifacts/architecture-resolution.txt`
- Insert `manifest.resolution.fix_criteria` (with required/optional flags)
- Insert `manifest.team.narrator.hints` (ordered list)
- Insert `manifest.team.narrator.max_hints_before_nudge`
- Insert `manifest.team.narrator.story_beats`
- Insert `manifest.resolution.learning_objectives`
- Insert `manifest.id` as the sim_id for session state path

Spawn the Narrator as a team agent with this populated prompt as its system instructions.

### 9. Spawn Service Agents

For each agent in `manifest.team.agents[]`, populate the Service Agent prompt template:

- Insert `agent.service` as the service name
- Insert `manifest.company.name`
- Read each file in `agent.artifacts` and insert its full contents
- Insert `agent.capabilities` list

Spawn each service agent as a team member with the populated prompt.

### 10. Handle Resume

If the user chose to resume an in-progress session:

- Read the session state from `learning/sessions/{sim_id}.json`
- Pass the session state to the Narrator agent so it can restore context
- The Narrator will acknowledge the resume and continue from the saved state
- Do NOT replay the Opening or already-fired story beats

---

## Phase 3: Simulation

### 11. Start the Simulation

Send a message to the Narrator to begin. The Narrator will:

1. Deliver the Opening section from story.md
2. Present the briefing card from artifacts/context.txt
3. Wait for the player to begin investigating

### 12. Player Investigation Loop

The player investigates conversationally. Route messages as follows:

- Questions directed at the Narrator (general questions, fix proposals, "what's happening?"): forward to Narrator
- Questions directed at a specific service ("show me the bucket policy", "check CloudTrail"): forward to the appropriate service agent
- If ambiguous, the Narrator will redirect the player to the correct service agent

### 13. Session State Auto-Save

The Narrator auto-saves session state to `learning/sessions/{sim_id}.json` after every significant interaction:

- Player asks a question (increment questions_asked)
- Hint is delivered (increment hints_used)
- Fix criterion is met (move from criteria_remaining to criteria_met)
- Story beat fires (add to story_beats_fired)
- Player queries a service agent (add to services_queried)

### 14. Story Beat Management

The Narrator manages story beats per the manifest triggers:

- Time-based beats fire at elapsed intervals
- Action-based beats fire on specific player actions
- The "fix_validated" beat fires when all required criteria are met

### 14b. Architecture Diagram as Final Hint

After the player has used `max_hints_before_nudge` hints without progress, the Narrator offers the architecture diagram as a final visual aid:

"Here is what the infrastructure looks like."

Then display the contents of `artifacts/architecture-hint.txt`. This is the last nudge before the Narrator begins giving direct guidance toward the answer. The diagram has NO problem markers -- it shows the infrastructure layout without revealing the root cause.

### 15. Fix Validation

When the player proposes a fix, the Narrator checks it against `manifest.resolution.fix_criteria`:

- If all required criteria are met: proceed to Phase 4
- If not: the Narrator tells the player what aspect is incomplete without revealing the answer

---

## Phase 4: Resolution

### 16. Deliver Resolution

The Narrator:

1. Delivers the Resolution section from story.md
2. Presents the marked architecture diagram from artifacts/architecture-resolution.txt
3. Provides a learning summary referencing the manifest's learning_objectives
3. Updates session state to `"status": "resolved"`
4. Signals: "SIMULATION COMPLETE. Generating coaching analysis."

### 17. Coaching Analysis

Read `.claude/skills/play/references/coaching-patterns.md` for analysis rules.

Read the final session state from `learning/sessions/{sim_id}.json`.

Analyze the player's investigation using the patterns and rules in coaching-patterns.md:

- Identify the player's first action category
- Count services queried vs services available
- Check for audit trail awareness
- Check for blast radius consideration
- Check investigation depth (questions before fix)
- Check hint usage

Generate coaching feedback by applying ALL matching rules from coaching-patterns.md. Present the feedback to the player in a structured format:

```
## Investigation Debrief

### What you did well
{Positive pattern feedback, with specific examples from the session}

### Areas to develop
{Negative pattern feedback, with specific actionable suggestions}

### Key takeaway
{Single most important learning from this session}
```

### 18. Score Knowledge

For each service in `manifest.services`, calculate a knowledge score per the rules in coaching-patterns.md:

- +1 for asking relevant questions about the service
- +1 for correctly identifying an issue in the service
- +1 for demonstrating config understanding
- Cap at +2 per sim per service

### 19. Update Learning Profile

Read and update `learning/profile.json`:

1. Add the sim `id` to `completed_sims`
2. Update `service_exposure`: for each service in the sim, increment its count
3. Update `question_patterns` with data from this session
4. **Level progression**: if 2 or more sims completed at `current_level`, add `current_level + 1` to `unlocked_levels` and set `current_level` to `current_level + 1`
5. Update `weaknesses` and `strengths` per coaching-patterns.md rules
6. Increment `total_sessions` by 1
7. Set `last_session` to today's date (YYYY-MM-DD)

### 20. Update Services Catalog

Read `services/catalog.csv`. For each service in `manifest.services`:

- Add the knowledge score to the `knowledge_score` column
- Increment `sims_completed` by 1
- Set `last_practiced` to today's date (YYYY-MM-DD)
- Append coaching observation to `notes` (format: `{sim_id}: {observation}`)

Write the updated CSV back to `services/catalog.csv`.

### 21. Regenerate Catalog Markdown

Regenerate `services/catalog.md` from the updated `services/catalog.csv`. Use the same format as the existing file, with an Obsidian frontmatter header and a markdown table.

### 22. Write Journal Entry

Append an entry to `learning/journal.md`:

```markdown
## {sim title}

- **Date**: {today YYYY-MM-DD}
- **Sim**: [[{sim-id}]]
- **Difficulty**: {difficulty}
- **Category**: {category}
- **Services**: {comma-separated services}
- **Questions asked**: {questions_asked}
- **Hints used**: {hints_used}
- **Criteria met**: {count met} / {count total}

### Coaching summary

{Condensed version of the coaching feedback -- 2-3 sentences}

### Key takeaway

{Single most important learning}
```

### 23. Clean Up Session State

Delete the session state file: `learning/sessions/{sim_id}.json`

### 24. Commit and Push

```bash
git add learning/profile.json learning/journal.md learning/sessions/
git add services/catalog.csv services/catalog.md
git commit -m "learn: complete sim {id} -- {title}"
git push
```

### 25. Wrap Up

Tell the user: "Sim complete. Start a new Claude Code session to play the next one."

Do NOT offer another simulation. One sim per session.

---

## Handling Mid-Sim Quit

If the user quits, abandons, or closes the session before resolution:

1. The Narrator's auto-save ensures the latest session state is in `learning/sessions/{sim_id}.json`
2. Do NOT mark the sim as complete
3. Do NOT update `learning/profile.json` or `services/catalog.csv`
4. Do NOT delete the session state file
5. Next time the user runs the play skill, Phase 1 Step 2 will detect the in-progress session and offer to resume

---

## Handling /btw Messages

The user may send `/btw` messages during play with improvement suggestions or side notes. When this happens:

1. Acknowledge briefly: "Noted." or "Got it, will keep that in mind."
2. Do NOT interrupt the simulation flow
3. Add the note to the session state's `btw_notes` array
4. These notes are available for review during post-sim analysis or future skill improvements

---

## Rules

1. One sim per session. After resolution, do not offer another sim.
2. No emojis in any output, files, or agent prompts.
3. Obsidian formatting for journal entries: YAML frontmatter where applicable, wiki-links for internal references.
4. AWS vocabulary throughout -- use official service names and API action names.
5. The Narrator drives the story. Service agents only serve raw data. The play skill orchestrates but does not narrate.
6. Session state must be saved after every significant interaction. If the process crashes, the player can resume.
7. Knowledge scores are capped at +2 per sim per service. No exceptions.
8. Level progression requires completing 2 sims at the current level before unlocking the next.
9. Coaching feedback must be specific and reference actual player behavior from the session. No generic advice.
10. All learning file updates happen ONLY after successful resolution. Mid-sim quits preserve state but change nothing else.

---

## Related

- [[agent-prompts]] -- Narrator and service agent prompt templates
- [[coaching-patterns]] -- Investigation pattern analysis and scoring rules
- [[sim-template]] -- Simulation package structure (consumed by this skill)
- [[create-sim]] -- Companion skill that generates sim packages
- [[catalog.csv]] -- AWS services catalog with knowledge scores
- [[profile.json]] -- Learner state and progression
