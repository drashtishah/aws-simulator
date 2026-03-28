---
name: play
description: Run an AWS incident simulation as an interactive session. Presents available sims based on learning level, loads narrator and console behavioral context, tracks investigation and validates fixes, updates learning profile and player catalog. Use when user says "play", "start sim", "run simulation", "practice AWS", or "let's play".
---

# play Skill

Runs an AWS incident simulation end-to-end. Consumes sim packages from `sims/{id}/` and plays the combined role of narrator (game master) and AWS console emulator using a single consolidated prompt.

---

## Phase 1: Setup

### 0. Check Workspace

If any of the following are missing, tell the user: "Run `/setup` first to initialize your workspace." and stop.

- `learning/` directory
- `learning/profile.json`
- `learning/catalog.csv`

### 0a. Choose Play Mode

Ask the player:

```
How would you like to play?

1. Terminal -- play right here in Claude Code
2. Web app -- open the simulator in your browser
```

Wait for the player's response.

If the player chooses **web app**:

1. Run `npm install` (if `node_modules/` does not exist)
2. Run `npm start` in the background using Bash (do not wait for it to exit)
3. Wait 2 seconds for the server to start
4. Run `open http://localhost:3200` to open the browser
5. Tell the player: "The simulator is running at http://localhost:3200. Play from your browser. When you are done, press Ctrl+C in the terminal to stop the server."
6. Stop. Do not proceed to Phase 2 or any further steps. The web app handles the game loop.

If the player chooses **terminal**, continue to Step 0b and the rest of the skill.

### 0b. Disable MCP Tools

The `aws-knowledge-mcp-server` MCP tools are for sim creation, not gameplay. Do NOT call any `aws___` prefixed tools during the play session. If the player asks about AWS documentation or service details, answer from the sim's artifacts and glossary only.

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

### 3b. Select Theme

Read the `themes/` directory. List all `.md` files except `_base.md`. Read YAML frontmatter from each to extract `id`, `name`, and `tagline`.

Present to the player:

```
Choose a narrative voice for this session:

1. Still Life -- "Flat affect. The facts carry the weight."
2. Slow Burn -- "The narrator has all the time in the world. The system does not."
3. Field Notes -- "Observed at 14:32. Behavior consistent with prior specimens."
```

Wait for choice. Store `theme_id` for Step 7.

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

## Phase 2: Load and Prepare

### 5. Load Sim Package

Read the selected sim's files:

- `sims/{id}/manifest.json` -- full manifest
- `sims/{id}/story.md` -- structured facts (key: value pairs for Opening and Resolution, not prose)
- `sims/{id}/artifacts/context.txt` -- briefing card for opening
- `sims/{id}/artifacts/architecture-hint.txt` -- clean architecture diagram (late hint)
- `sims/{id}/artifacts/architecture-resolution.txt` -- marked architecture diagram (debrief)
- All artifact files referenced in `manifest.team.consoles[].artifacts`

### 6. Prepare Consolidated Prompt

Read `.claude/skills/play/references/agent-prompts.md` for the consolidated prompt template.

### 7. Populate Prompt

Populate the template following the population instructions in agent-prompts.md:

- Read `themes/_base.md` and `themes/{theme_id}.md` (selected in Step 3b)
- Inject `_base.md` content into the "Structural Rules" section
- Strip YAML frontmatter from the theme file and inject full content as `{theme.voice}` into the "Narrative Voice" section
- Story.md facts are rendered through the theme at delivery time, not pre-inserted as prose
- Insert narrator fields: personality (structured object), company, story facts, briefing card, architecture diagrams, fix criteria, hints, story beats, learning objectives, sim_id
- Insert console data: for each entry in `manifest.team.consoles[]`, insert the service name, capabilities, and full contents of all referenced artifacts
- This populated prompt governs the rest of the session -- it defines both Narrator Mode and Console Mode behavior

### 8. Handle Resume

If the user chose to resume an in-progress session:

- Read the session state from `learning/sessions/{sim_id}.json`
- Restore `theme_id` from session state (do not re-prompt for theme selection)
- Load `themes/_base.md` and `themes/{theme_id}.md` for prompt population
- Use the investigation_summary and criteria_met to restore context
- Acknowledge the resume: "Resuming your investigation of {title}. Here is where you left off: {investigation_summary}"
- Do NOT replay the Opening or already-fired story beats

---

## Phase 3: Simulation

### 9. Start the Simulation

Read the Opening facts from story.md. Narrate them to the player in the active theme's voice, incorporating the narrator personality traits from the manifest. Present the briefing card from artifacts/context.txt. Wait for the player to begin investigating.

### 10. Player Investigation Loop

The player investigates conversationally. Respond according to the behavioral rules in the populated prompt:

- **Narrator Mode** for story delivery, hints, fix validation, and general questions
- **Console Mode** when the player queries a specific AWS service -- serve raw artifact data in native AWS format, then return to Narrator Mode

### 10a. Narrative Arc Awareness

The narrator uses `manifest.team.narrator.narrative_arc` to pace improvised narration. During the "trials" phase (player investigating, hitting red herrings), let mundane details accumulate. When the player nears revelation, do not accelerate. All improvised speech follows the active theme's voice (injected from the selected theme file).

### 10b. Inline Jargon Explanation

When the player asks about an AWS term:
- Source from `manifest.team.narrator.glossary` first
- If the term is not in the glossary, the narrator explains from general AWS knowledge
- Deliver in the narrator's voice, woven into narrative, never break character
- NEVER hint at root cause through definitions
- Only explain when the player asks or the term is central to a story beat being delivered

### 10c. System Visualization Narration

During gameplay, the narrator helps the player build a mental model of the system:
- Source from `manifest.team.narrator.system_narration`
- On first query to a service console, the narrator adds one sentence about that component's role
- On second+ service query, the narrator describes how the services relate
- Observations are factual -- what the system IS, not what is wrong
- Do NOT reference `system_narration.what_broke` during gameplay -- that is resolution-only

### 10d. Adaptive Hint Delivery

Hints are objects with `hint`, `relevant_services`, and `skip_if_queried` fields. Before delivering the next hint:
- Check the player's `services_queried` from session state
- If all services in a hint's `skip_if_queried` have been queried, skip that hint
- If a hint's `relevant_services` overlap with services the player has NOT queried, prioritize that hint
- Still deliver only one hint at a time, still require 2+ unproductive questions before offering

### 11. Session State Auto-Save

Auto-save session state to `learning/sessions/{sim_id}.json` after every significant interaction. Include `theme_id` in the session state so it persists across resumes.

- Player asks a question (increment questions_asked)
- Hint is delivered (increment hints_used)
- Fix criterion is met (move from criteria_remaining to criteria_met)
- Story beat fires (add to story_beats_fired)
- Player queries a service console (add to services_queried)

### 12. Story Beat Management

Manage story beats per the manifest triggers:

- Time-based beats fire at elapsed intervals
- Action-based beats fire on specific player actions
- The "fix_validated" beat fires when all required criteria are met

### 12b. Architecture Diagram as Final Hint

After the player has used `max_hints_before_nudge` hints without progress, offer the architecture diagram as a final visual aid:

"Here is what the infrastructure looks like."

Then display the contents of `artifacts/architecture-hint.txt`. This is the last nudge before giving direct guidance toward the answer. The diagram has NO problem markers -- it shows the infrastructure layout without revealing the root cause.

### 13. Fix Validation

When the player proposes a fix, check it against `manifest.resolution.fix_criteria`:

- If all required criteria are met: proceed to Phase 4
- If not: tell the player what aspect is incomplete without revealing the answer

---

## Phase 4: Resolution and Debrief

### 14a. Deliver Summary

Keep this short -- roughly 150 words. The player just solved something. Let it land.

1. Deliver the Resolution section from story.md
2. Present the marked architecture diagram from artifacts/architecture-resolution.txt
3. State `manifest.resolution.root_cause` in one plain-English sentence. Not the learning objectives. Not the SOP. Just what broke and what fixed it.
4. Update session state: set `status` to `"resolved"`, set `debrief_phase` to `"summary"`

### 14b. Open Debrief Q&A

Generate three seed questions from the manifest -- things the player might be wondering. One from each type:

- **Concept seed**: drawn from `manifest.resolution.learning_objectives`. Frame as a "why" or "how does this work" question.
- **How-to seed**: drawn from `manifest.resolution.fix_criteria`. Point toward the practical remediation (Console/CLI/IaC).
- **What-else seed**: drawn from `manifest.resolution.related_failure_modes`. Frame as "what if the problem had been something else."

Present the seeds in narrator voice as observations, not instructions. "Three things you might be wondering" -- not "Here are questions you should ask." End with: "Ask about any of these. Or ask something else entirely."

Update session state: set `debrief_phase` to `"qa"`, record seeds in `debrief_seeds_offered`.

Wait for the player to respond.

### 14c. Debrief Conversation Loop

When the player asks a question, identify which content zone it maps to and serve the relevant manifest content. Five zones:

| Zone | Manifest source |
|---|---|
| concepts | `learning_objectives` -- explain each relevant objective |
| remediation | Console/CLI/IaC for the relevant `fix_criteria` action |
| process | `sop_steps` -- present as numbered steps under "How AWS recommends approaching this" |
| failure_modes | `related_failure_modes` -- describe the relevant scenario, how it differs, prevention |
| practices | `sop_practices` -- present as bulleted list under "Best practices from AWS SOPs" |

All answers use beginner-friendly language: plain English first, AWS term second. If the manifest text contains unexplained jargon, rephrase it during delivery.

After each answer, plant one follow-up seed -- a sentence embedded in the answer that implies a question toward an unexplored zone. Not a directive. An observation that trails toward the next idea. The narrator does not say "you should ask about X." The narrator says something that makes X the obvious next thought.

If the player asks something outside all five zones, answer from general AWS knowledge (same as glossary rule 12), then redirect toward an unexplored zone with a follow-up seed.

Update session state after each exchange:
- Increment `debrief_questions_asked`
- Add zone to `debrief_zones_explored`
- Increment `debrief_depth_score` if the question demonstrated systems thinking (follow-ups, cross-references, "why" / "what if" questions)

**Exit conditions:**
- Player signals done ("I'm good", "thanks", "that's all", etc.)
- All five zones explored -- narrator says: "That covers the full picture." and transitions to coaching
- Inactivity: prompt once ("Anything you want to dig into?"). If still silent, transition to coaching.

On exit: set `debrief_phase` to `"coaching"`. Signal: "SIMULATION COMPLETE. Generating coaching analysis."

### 15. Coaching Analysis

Read `.claude/skills/play/references/coaching-patterns.md` for analysis rules.

Read the final session state from `learning/sessions/{sim_id}.json`.

Analyze the player's investigation using the patterns and rules in coaching-patterns.md:

- Identify the player's first action category
- Count services queried vs services available
- Check for audit trail awareness
- Check for blast radius consideration
- Check investigation depth (questions before fix)
- Check hint usage
- Analyze debrief engagement: questions asked, zones explored, depth score (see "Debrief Engagement" section in coaching-patterns.md)

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

### 16. Score Knowledge

For each service in `manifest.services`, calculate a knowledge score per the rules in coaching-patterns.md:

- +1 for asking relevant questions about the service
- +1 for correctly identifying an issue in the service
- +1 for demonstrating config understanding
- Cap at +2 per sim per service

### 17. Update Learning Profile

Read and update `learning/profile.json`:

1. Add the sim `id` to `completed_sims`
2. Update `service_exposure`: for each service in the sim, increment its count
3. Update `question_patterns` with data from this session
4. **Level progression**: if 2 or more sims completed at `current_level`, add `current_level + 1` to `unlocked_levels` and set `current_level` to `current_level + 1`
5. Update `weaknesses` and `strengths` per coaching-patterns.md rules
6. Increment `total_sessions` by 1
7. Set `last_session` to today's date (YYYY-MM-DD)

### 18. Update Services Catalog

Read `learning/catalog.csv`. For each service in `manifest.services`:

- Add the knowledge score to the `knowledge_score` column
- Increment `sims_completed` by 1
- Set `last_practiced` to today's date (YYYY-MM-DD)
- Append coaching observation to `notes` (format: `{sim_id}: {observation}`)

Write the updated CSV back to `learning/catalog.csv`.

### 19. Write Journal Entry

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

### 20. Clean Up Session State

Delete the session state file: `learning/sessions/{sim_id}.json`

### 21. Report Feedback

If `feedback_notes` in the session state is non-empty:

1. Tell the user: "You left {count} feedback notes during this session. They are saved in `learning/feedback.md`. Run `/fix` in a fresh session to apply them."
2. Do NOT apply feedback inline -- the `/fix` command handles skill improvements separately.

### 22. Wrap Up

Tell the user: "Sim complete. Start a new Claude Code session to play the next one."

Do NOT offer another simulation. One sim per session.

---

## Handling Mid-Sim Quit

If the user quits, abandons, or closes the session before resolution:

1. The auto-save ensures the latest session state is in `learning/sessions/{sim_id}.json`
2. Do NOT mark the sim as complete
3. Do NOT update `learning/profile.json` or `learning/catalog.csv`
4. Do NOT delete the session state file
5. Next time the user runs the play skill, Phase 1 Step 2 will detect the in-progress session and offer to resume

---

## Handling /feedback Messages

The user may run `/feedback [text]` during play. This is the `/feedback` skill that logs feedback to `learning/feedback.md` and updates the session state's `feedback_notes` array. No action needed from the play skill -- the skill handles it.

---

## Rules

1. One sim per session. After resolution, do not offer another sim.
2. No emojis in any output or files.
3. Markdown formatting for journal entries: YAML frontmatter where applicable.
4. AWS vocabulary throughout -- use official service names and API action names.
5. Narrate the story AND serve raw console data. In Console Mode: raw AWS output only, no analysis.
6. Session state must be saved after every significant interaction. If the process crashes, the player can resume.
7. Knowledge scores are capped at +2 per sim per service. No exceptions.
8. Level progression requires completing 2 sims at the current level before unlocking the next.
9. Coaching feedback must be specific and reference actual player behavior from the session. No generic advice.
10. All learning file updates happen ONLY after successful resolution. Mid-sim quits preserve state but change nothing else.
11. Never call MCP tools (aws___*) during a play session. All information comes from the sim package.

---

## Related

- [[agent-prompts]] -- Consolidated prompt template (Narrator Mode + Console Mode)
- [[coaching-patterns]] -- Investigation pattern analysis and scoring rules
- [[sim-template]] -- Simulation package structure (consumed by this skill)
- [[create-sim]] -- Companion skill that generates sim packages
- [[learning/catalog.csv]] -- Player service catalog and progress
- [[profile.json]] -- Learner state and progression
