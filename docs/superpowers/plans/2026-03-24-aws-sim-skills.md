# AWS Incident Simulation Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build two Claude Code skills (`create-sim` and `play`) that generate and run interactive AWS incident simulations using agent teams, plus the supporting data layer (services catalog, sim registry, learning tracking).

**Architecture:** Two project-local skills in `.claude/skills/`. `create-sim` generates simulation packages (manifest.json + story.md + native-format artifacts) via web search. `play` activates sims by spinning up agent teams (Narrator + service agents), tracks learning progress in `learning/profile.json` and `services/catalog.csv`, auto-saves session state for resume.

**Tech Stack:** Claude Code skills (SKILL.md + references + assets), JSON manifests, CSV catalog, Obsidian-formatted markdown, agent teams (TeamCreate/SendMessage/TeamDelete)

**Spec:** `docs/superpowers/specs/2026-03-24-aws-sim-design.md` (to be written from `.claude/plans/curried-crunching-elephant.md`)

---

## File Structure

```
aws-simulator/
  .gitignore                              # MODIFY - fix exclusions
  .claude/skills/
    create-sim/
      SKILL.md                            # CREATE - main skill file
      references/
        exam-topics.md                    # CREATE - AWS cert topic map
        sim-template.md                   # CREATE - annotated sim example
      assets/
        manifest-schema.json              # CREATE - JSON schema
    play/
      SKILL.md                            # CREATE - main skill file
      references/
        agent-prompts.md                  # CREATE - system prompt templates
        coaching-patterns.md              # CREATE - coaching analysis rules
  sims/
    registry.json                         # CREATE - empty sim registry
    index.md                              # CREATE - Obsidian catalog
  learning/
    profile.json                          # CREATE - default learner profile
    journal.md                            # CREATE - empty journal
    sessions/                             # CREATE - dir for mid-sim state
  services/
    catalog.csv                           # CREATE - full AWS services list
    catalog.md                            # CREATE - Obsidian view
```

---

## Task 1: Fix .gitignore and Create Directory Scaffolding

**Files:**
- Modify: `.gitignore`
- Create: `sims/registry.json`, `sims/index.md`, `learning/profile.json`, `learning/journal.md`, `services/.gitkeep`, `learning/sessions/.gitkeep`

- [ ] **Step 1: Update .gitignore**

Replace contents of `.gitignore` with:

```
# Session artifacts (transient)
.sessions/

# Obsidian config
.obsidian/

# Claude Code local settings and plans (not skills)
.claude/plans/
.claude/settings.local.json
.claude/commands/

# Transient sim session state
learning/sessions/
```

- [ ] **Step 2: Create directory structure**

```bash
mkdir -p sims
mkdir -p learning/sessions
mkdir -p services
mkdir -p .claude/skills/create-sim/references
mkdir -p .claude/skills/create-sim/assets
mkdir -p .claude/skills/play/references
```

- [ ] **Step 3: Create sims/registry.json**

```json
{
  "version": 1,
  "sims": []
}
```

- [ ] **Step 4: Create sims/index.md**

```markdown
---
tags:
  - type/index
  - domain/aws-simulator
---

# Simulation Catalog

No simulations created yet. Run `create-sim` to generate your first batch.
```

- [ ] **Step 5: Create learning/profile.json**

```json
{
  "current_level": 1,
  "completed_sims": [],
  "unlocked_levels": [1],
  "service_exposure": {},
  "question_patterns": {},
  "weaknesses": [],
  "strengths": [],
  "total_sessions": 0,
  "last_session": null
}
```

- [ ] **Step 6: Create learning/journal.md**

```markdown
---
tags:
  - type/learning-journal
  - domain/aws-simulator
---

# Learning Journal

Progress entries are added automatically after each completed simulation.
```

- [ ] **Step 7: Commit scaffolding**

```bash
git add .gitignore sims/ learning/ services/ .claude/skills/ agent.md claude.md index.md
git commit -m "feat: scaffold AWS incident simulation project structure"
```

---

## Task 2: Create AWS Services Catalog

**Files:**
- Create: `services/catalog.csv`
- Create: `services/catalog.md`

- [ ] **Step 1: Research comprehensive AWS services list**

Use `WebSearch` to find the full list of AWS services that appear on certification exams. Cross-reference with the exam topic research from the design phase.

- [ ] **Step 2: Create services/catalog.csv**

CSV with columns: `service,full_name,category,exam_priority,difficulty_level,cert_relevance,knowledge_score,sims_completed,last_practiced,notes`

Include all services organized by these categories: compute, storage, database, networking, security, integration, management, analytics, migration, developer-tools.

Exam priority: 1 (always tested) through 4 (rarely tested).
Difficulty level: 1-4 matching sim difficulty levels.
Knowledge score, sims_completed, last_practiced, notes: all start empty/zero.

Target: 60-80 services covering all cert levels.

- [ ] **Step 3: Generate services/catalog.md**

Obsidian-formatted markdown grouped by category, sorted by exam_priority within each group. Include frontmatter tags. Show knowledge_score as progress text (e.g., "Not started" for 0, "Encountered" for 1, etc.).

- [ ] **Step 4: Commit catalog**

```bash
git add services/
git commit -m "feat: add comprehensive AWS services catalog with exam priorities"
```

---

## Task 3: Build create-sim Skill

**Files:**
- Create: `.claude/skills/create-sim/SKILL.md`
- Create: `.claude/skills/create-sim/references/exam-topics.md`
- Create: `.claude/skills/create-sim/references/sim-template.md`
- Create: `.claude/skills/create-sim/assets/manifest-schema.json`

- [ ] **Step 1: Write references/exam-topics.md**

Comprehensive exam topic map covering:
- SAA-C03 (Solutions Architect Associate): 4 domains with services per domain
- SAP-C02 (Solutions Architect Professional): 4 domains with services per domain
- DVA-C02 (Developer Associate): 4 domains with services per domain
- SCS-C02 (Security Specialty): 6 domains with services per domain

Organized by difficulty level (1-4). Each entry lists: domain name, weight percentage, key services, common incident patterns suitable for simulation.

- [ ] **Step 2: Write references/sim-template.md**

A complete annotated example of one simulation package. Include:

1. Full `manifest.json` example with every field annotated (comments explaining each section)
2. Full `story.md` example with correct Obsidian frontmatter, Opening section, and Resolution section
3. Full `resolution.md` example with root cause, fix explanation, AWS documentation links, learning objectives
4. Example artifact files:
   - `artifacts/architecture.txt` -- ASCII diagram
   - `artifacts/cloudwatch-logs.txt` -- realistic log entries
   - `artifacts/iam-policy.json` -- real IAM policy format
   - `artifacts/metrics.csv` -- metrics data
5. Annotations explaining quality expectations: realistic company names, customer-obsessed language, AWS vocabulary, native artifact formats

- [ ] **Step 3: Create assets/manifest-schema.json**

JSON Schema for manifest.json validation. Required fields: id, title, difficulty, category, services, tags, estimated_minutes, company, team (narrator + agents), resolution (root_cause, fix_criteria, learning_objectives). Agent team section: narrator must have personality, story_beats, hints, max_hints_before_nudge. Each agent must have name, service, artifacts, capabilities.

- [ ] **Step 4: Write SKILL.md**

Frontmatter:
```yaml
---
name: create-sim
description: Generate AWS incident simulation packages for the play skill. Searches web for realistic incident patterns, proposes topics for approval, then generates complete sim packages (manifest, story, artifacts, resolution). Use when user says "create-sim", "generate sims", "make new simulations", or "add more scenarios".
---
```

Body -- the full create-sim workflow:

1. Read `services/catalog.csv` to identify knowledge gaps (knowledge_score < 2, high exam_priority)
2. Accept optional topic area argument (security, compute, networking, etc.)
3. Use WebSearch to find realistic AWS incident patterns, postmortems, common misconfigurations targeting gap services
4. Cross-reference against `references/exam-topics.md` for exam coverage
5. Present 5-6 scenario proposals: title, services, difficulty, 1-line pitch, which gaps they fill
6. Wait for user approval
7. For each approved scenario:
   a. Read `references/sim-template.md` for format guidance
   b. Generate manifest.json (validate structure against `assets/manifest-schema.json`)
   c. Generate story.md with Obsidian frontmatter
   d. Generate resolution.md with AWS doc links
   e. Generate all artifacts in native formats (MUST include architecture.txt with ASCII diagram)
   f. Dynamic agent team: determine which service agents are needed based on involved services
8. Register each sim in `sims/registry.json`
9. Regenerate `sims/index.md`
10. Commit and push all new sims

Include: no emojis rule, Obsidian formatting conventions, customer-obsessed narrative language, AWS vocabulary emphasis.

- [ ] **Step 5: Commit create-sim skill**

```bash
git add .claude/skills/create-sim/
git commit -m "feat: add create-sim skill for generating AWS incident simulations"
```

---

## Task 4: Build play Skill

**Files:**
- Create: `.claude/skills/play/SKILL.md`
- Create: `.claude/skills/play/references/agent-prompts.md`
- Create: `.claude/skills/play/references/coaching-patterns.md`

- [ ] **Step 1: Write references/agent-prompts.md**

System prompt templates with placeholders:

**Narrator prompt template:**
- Role: Game Master / Narrator for AWS incident simulation
- Personality: `{narrator.personality}` from manifest
- Company context: `{company.name}`, `{company.industry}`, `{company.size}`
- Full story from story.md (Opening, story beats, Resolution)
- Resolution criteria: list of fix_criteria with required/optional flags
- Hint progression: ordered hints, max_hints_before_nudge
- Rules: deliver story beats on triggers, validate fix proposals against criteria, auto-save session state after every interaction, track which criteria are met
- Session state file path and format
- On resolution: read Resolution section, provide learning summary, signal completion

**Service agent prompt template:**
- Role: AWS `{service}` console for `{company.name}`
- Loaded artifacts: list of file paths
- Capabilities: list of queryable operations
- Rules: respond ONLY with data from artifacts, use AWS console output formatting, never interpret or suggest, never reveal information not in artifacts, if asked about something outside capabilities say "This console does not have that information"

- [ ] **Step 2: Write references/coaching-patterns.md**

Pattern analysis rules:

1. **Investigation patterns to track:**
   - What does user check first? (logs, permissions, architecture, metrics)
   - How many questions before proposing a fix?
   - Does user check CloudTrail / audit trail?
   - Does user consider blast radius before proposing changes?
   - Does user ask about the architecture first?

2. **Coaching feedback rules:**
   - If user never checked logs: "Consider starting with CloudWatch logs next time -- they often contain the first clue"
   - If user jumped straight to fix without investigation: "Take time to investigate before proposing fixes -- understanding the root cause prevents recurrence"
   - If user only checked one service: "This incident involved multiple services. Broadening your investigation would have uncovered the connection faster"
   - If user asked excellent diagnostic questions: reinforce positively with specific examples

3. **Knowledge score update rules:**
   - +1 for asking relevant questions about a service
   - +1 for correctly identifying an issue in a service
   - +1 for demonstrating config understanding (e.g., knowing what a bucket policy field means)
   - Cap at +2 per sim per service (prevents score inflation from one sim)

- [ ] **Step 3: Write SKILL.md**

Frontmatter:
```yaml
---
name: play
description: Run an AWS incident simulation as an interactive agent team. Presents available sims based on learning level, spins up Narrator + service agents, tracks investigation and validates fixes, updates learning profile and services catalog. Use when user says "play", "start sim", "run simulation", "practice AWS", or "let's play".
---
```

Body -- the full play workflow:

1. Read `learning/profile.json` (create default if missing)
2. Check `learning/sessions/` for in-progress sims -- offer to resume if found
3. Filter `sims/registry.json`: eligible = difficulty <= current_level AND not in completed_sims AND prerequisites met
4. If no eligible sims: suggest running `create-sim` to generate more
5. Present available sims with title, difficulty, category, estimated time
6. Present sims targeting user's weaknesses first (from profile.json)
7. User picks a sim
8. Read sim's `manifest.json`
9. Create agent team via TeamCreate with team name "sim-{id}"
10. Spawn Narrator agent using prompt template from `references/agent-prompts.md`, populated with manifest data
11. Spawn N service agents using prompt template, each with their artifact subset
12. Narrator delivers Opening from story.md
13. Narrator presents ASCII architecture diagram from `artifacts/architecture.txt`
14. Simulation loop: user investigates, agents respond, Narrator manages pacing
15. Auto-save: Narrator writes to `learning/sessions/{sim-id}.json` after every significant interaction
16. Fix validation: when user proposes fix, Narrator checks against fix_criteria
17. On resolution:
    a. Narrator delivers Resolution section + learning summary
    b. Update `learning/profile.json` (completed_sims, level progression, patterns)
    c. Update `services/catalog.csv` (knowledge scores per service involved)
    d. Regenerate `services/catalog.md`
    e. Append session entry to `learning/journal.md`
    f. Delete session state file
    g. Provide coaching notes per `references/coaching-patterns.md`
    h. Git commit and push all learning changes
    i. Tell user: "Sim complete. Start a new session to play the next one."

18. One sim per session rule: after resolution, do not offer another sim
19. If user quits mid-sim: save state, do not mark complete, do not update learning

Include: session persistence format, level unlock rules (2 completed at level N -> unlock N+1), no emojis.

- [ ] **Step 4: Commit play skill**

```bash
git add .claude/skills/play/
git commit -m "feat: add play skill for running AWS incident simulations via agent teams"
```

---

## Task 5: Generate First Batch of Simulations

**Files:**
- Create: `sims/001-*/` through `sims/005-*/` or `sims/006-*/` (5-6 sim directories)
- Modify: `sims/registry.json`, `sims/index.md`

- [ ] **Step 1: Run create-sim skill targeting Level 1-2 foundational topics**

Invoke the `create-sim` skill. It should:
1. Read catalog.csv and identify priority gaps (all services are at 0 initially)
2. Web search for realistic incident patterns
3. Propose 5-6 scenarios covering: EC2, S3, IAM, VPC, RDS, CloudWatch
4. Get user approval on topic list

Target difficulty mix: 3 sims at Level 1, 2-3 sims at Level 2.

- [ ] **Step 2: Review generated sim packages**

For each generated sim, verify:
- manifest.json has all required fields and valid structure
- story.md has Obsidian frontmatter and Opening/Resolution sections
- resolution.md has root cause, fix explanation, learning objectives
- artifacts/architecture.txt exists with ASCII diagram
- All artifact files are in native formats (not markdown-wrapped)
- Agent team config specifies appropriate service agents with correct artifact references

- [ ] **Step 3: Verify registry and index**

- `sims/registry.json` lists all generated sims with correct metadata
- `sims/index.md` has Obsidian-formatted table with wiki-links

- [ ] **Step 4: Commit first batch**

```bash
git add sims/
git commit -m "feat: generate first batch of Level 1-2 AWS incident simulations"
```

---

## Task 6: End-to-End Verification

- [ ] **Step 1: Invoke play skill**

Run `play` in a test session. Verify:
- Reads profile.json (Level 1)
- Filters registry correctly
- Presents sim options with difficulty/category labels

- [ ] **Step 2: Select a Level 1 sim and verify team creation**

Pick a sim. Verify:
- TeamCreate succeeds with correct team name
- Narrator agent spawns and delivers Opening narrative
- ASCII architecture diagram is presented
- Service agents are spawned per manifest config

- [ ] **Step 3: Test investigation flow**

Ask questions to service agents:
- Request CloudWatch logs -> verify agent returns realistic log data from artifacts
- Request IAM policies -> verify agent returns actual JSON policy
- Request architecture info -> verify agent responds appropriately

- [ ] **Step 4: Test fix validation**

Propose the correct fix. Verify:
- Narrator validates against fix_criteria
- Required criteria are checked
- Resolution narrative is delivered
- Learning summary is presented

- [ ] **Step 5: Verify learning updates**

After resolution, check:
- `learning/profile.json` updated (completed_sims, service_exposure)
- `services/catalog.csv` updated (knowledge_score, sims_completed, last_practiced)
- `services/catalog.md` regenerated
- `learning/journal.md` has new session entry
- Session state file deleted
- Git commit created and pushed

- [ ] **Step 6: Verify session persistence**

Start a second sim, interact partially, then check:
- `learning/sessions/{sim-id}.json` exists with current state
- Criteria met, hints used, investigation summary are tracked
- Starting play again offers to resume this sim
