# C4 Context Diagrams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single architecture.txt with a three-tier diagram system (context.txt, architecture-hint.txt, architecture-resolution.txt) so players discover architecture through investigation rather than having it handed to them at sim start.

**Architecture:** Three files per sim replace one. The play skill shows context.txt at start, offers architecture-hint.txt as a late hint, and displays architecture-resolution.txt during debrief. The create-sim skill generates all three. All 11 existing sims are backfilled.

**Tech Stack:** Markdown skill files, JSON manifests, plain text artifacts. No code dependencies.

---

### Task 1: Update play skill (SKILL.md)

**Files:**
- Modify: `.claude/skills/play/SKILL.md:82-87` (Phase 2, Step 5 -- Load Sim Package)
- Modify: `.claude/skills/play/SKILL.md:139-144` (Phase 3, Step 11 -- Start the Simulation)
- Modify: `.claude/skills/play/SKILL.md:182-190` (Phase 4, Step 16 -- Deliver Resolution)

- [ ] **Step 1: Update Step 5 (Load Sim Package)**

Change line 86 from:
```
- `sims/{id}/artifacts/architecture.txt` -- ASCII diagram
```
To:
```
- `sims/{id}/artifacts/context.txt` -- briefing card for opening
- `sims/{id}/artifacts/architecture-hint.txt` -- clean architecture diagram (late hint)
- `sims/{id}/artifacts/architecture-resolution.txt` -- marked architecture diagram (debrief)
```

- [ ] **Step 2: Update Step 11 (Start the Simulation)**

Change lines 141-144 from:
```
1. Deliver the Opening section from story.md
2. Present the ASCII architecture diagram
3. Wait for the player to begin investigating
```
To:
```
1. Deliver the Opening section from story.md
2. Present the briefing card from artifacts/context.txt
3. Wait for the player to begin investigating
```

- [ ] **Step 3: Add architecture-hint.txt to the hints system**

Insert the following as a new section between Step 14 (Story Beat Management) and Step 15 (Fix Validation):

```
### 14b. Architecture Diagram as Final Hint

After the player has used `max_hints_before_nudge` hints without progress, the Narrator offers the architecture diagram as a final visual aid:

"Here is what the infrastructure looks like."

Then display the contents of `artifacts/architecture-hint.txt`. This is the last nudge before the Narrator begins giving direct guidance toward the answer. The diagram has NO problem markers -- it shows the infrastructure layout without revealing the root cause.
```

- [ ] **Step 4: Update Step 16 (Deliver Resolution)**

Change lines 186-190 from:
```
1. Delivers the Resolution section from story.md
2. Provides a learning summary referencing the manifest's learning_objectives
```
To:
```
1. Delivers the Resolution section from story.md
2. Presents the marked architecture diagram from artifacts/architecture-resolution.txt
3. Provides a learning summary referencing the manifest's learning_objectives
```

- [ ] **Step 5: Verify play skill is internally consistent**

Read through the full updated SKILL.md. Confirm no remaining references to `architecture.txt`. Confirm the three new filenames are used consistently.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/play/SKILL.md
git commit -m "feat(play): replace architecture.txt with three-tier diagram system

Show context.txt briefing card at sim start, offer architecture-hint.txt
as late hint, display architecture-resolution.txt during resolution debrief."
```

---

### Task 2: Update agent-prompts.md

**Files:**
- Modify: `.claude/skills/play/references/agent-prompts.md:28-31` (Narrator template -- Architecture section)
- Modify: `.claude/skills/play/references/agent-prompts.md:60-61` (Narrator behavioral rule 1)
- Modify: `.claude/skills/play/references/agent-prompts.md:207-209` (Template population instructions)

- [ ] **Step 1: Update Narrator template Architecture section**

Change lines 28-31 from:
```
## Architecture

{artifacts/architecture.txt contents}
```
To:
```
## Briefing Card

{artifacts/context.txt contents}

## Architecture (Late Hint)

The following diagram is NOT shown at the start. It is available as a final hint after the player has exhausted all regular hints. It has no problem markers.

{artifacts/architecture-hint.txt contents}

## Architecture (Resolution)

The following diagram is shown ONLY during the resolution debrief. It includes problem markers.

{artifacts/architecture-resolution.txt contents}
```

- [ ] **Step 2: Update Narrator behavioral rule 1**

Change line 61 from:
```
1. START by delivering the Opening section from the story. After the opening, present the ASCII architecture diagram so the player can see the infrastructure layout.
```
To:
```
1. START by delivering the Opening section from the story. After the opening, present the Briefing Card so the player has basic orientation. Do NOT show any architecture diagram at start.
```

- [ ] **Step 3: Add behavioral rule for architecture hint**

After rule 6 (hint delivery), add a new rule:

```
6b. After `max_hints_before_nudge` hints have been delivered without the player resolving the incident, offer the architecture diagram (from the "Architecture (Late Hint)" section) as a final visual aid: "Here is what the infrastructure looks like." This diagram has no problem markers -- it shows layout without revealing the root cause.
```

- [ ] **Step 4: Add behavioral rule for resolution diagram**

Update rule 9 (resolution delivery) to include the marked diagram:

```
9. On resolution (all required criteria met):
   - Deliver the Resolution section from the story
   - Present the marked architecture diagram from the "Architecture (Resolution)" section
   - Provide a learning summary referencing the learning_objectives from the manifest
   ...
```

- [ ] **Step 5: Update Template Population Instructions**

Change lines 207-209 from:
```
2. Read `sims/{sim-id}/story.md` -- insert full contents into the story section
3. Read `sims/{sim-id}/artifacts/architecture.txt` -- insert into architecture section
```
To:
```
2. Read `sims/{sim-id}/story.md` -- insert full contents into the story section
3. Read `sims/{sim-id}/artifacts/context.txt` -- insert into briefing card section
4. Read `sims/{sim-id}/artifacts/architecture-hint.txt` -- insert into Architecture (Late Hint) section
5. Read `sims/{sim-id}/artifacts/architecture-resolution.txt` -- insert into Architecture (Resolution) section
```

Renumber subsequent items (old 4-11 become 6-13).

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/play/references/agent-prompts.md
git commit -m "feat(play): update narrator template for three-tier diagrams

Briefing card at start, architecture-hint as late hint, marked
architecture-resolution during debrief."
```

---

### Task 3: Update create-sim skill (SKILL.md)

**Files:**
- Modify: `.claude/skills/create-sim/SKILL.md:104-135` (Step 18 -- Generate artifacts)
- Modify: `.claude/skills/create-sim/SKILL.md:137-143` (Step 19 -- Validate the package)

- [ ] **Step 1: Update Step 18 artifact table**

Replace the minimum artifacts table (lines 108-111):
```
| File | Format | Purpose |
|---|---|---|
| `architecture.txt` | ASCII diagram | Infrastructure layout with problem area marked |
| At least 2 service-specific artifacts | Native AWS format | Evidence for investigation |
```
With:
```
| File | Format | Purpose | When Shown |
|---|---|---|---|
| `context.txt` | Structured briefing card | Orientation at sim start | Opening |
| `architecture-hint.txt` | ASCII diagram, clean | Late hint for stuck players | After hints exhausted |
| `architecture-resolution.txt` | ASCII diagram, marked | Answer key with problem areas | Resolution debrief |
| At least 2 service-specific artifacts | Native AWS format | Evidence for investigation | On query |
```

- [ ] **Step 2: Add context.txt format specification**

After the updated table, add:

```
**context.txt format:**

A plain-text briefing card. No boxes, no arrows, no diagrams. One line per field.

```
Company: {name} ({size})
Industry: {industry}
Users: {concrete user description with numbers}
AWS Services: {official service names, comma-separated}
Your role: {role and time context}
Situation: {one sentence, what brought you here}
```

Rules for context.txt:
- Users line includes concrete numbers, not "many users"
- Situation line is factual, not dramatic
- AWS Services uses official names from catalog.csv
- No markers, no hints about the root cause
```

- [ ] **Step 3: Add architecture file rules**

After the context.txt specification, add:

```
**architecture-hint.txt rules:**
- Same level of detail as architecture-resolution.txt but with ALL problem markers removed
- No `[PROBLEM]`, `[PUBLIC ACCESS]`, `[DELETED]`, `[WRONG REGION]`, or similar annotations
- IAM roles, permissions, and data flow arrows are shown (these are factual, not hints)
- Resource names match the company story

**architecture-resolution.txt rules:**
- Identical to architecture-hint.txt plus problem markers
- Markers use the format `[ALL CAPS DESCRIPTION]` next to the affected resource
- May include annotation lines below the diagram explaining the problem area
```

- [ ] **Step 4: Update Step 19 validation checklist**

Replace line 142:
```
- Confirm `architecture.txt` exists
```
With:
```
- Confirm `context.txt` exists and follows the briefing card format (6 fields, one per line)
- Confirm `architecture-hint.txt` exists and contains NO problem markers
- Confirm `architecture-resolution.txt` exists and contains problem markers
- Confirm `architecture.txt` does NOT exist (old format removed)
```

- [ ] **Step 5: Update Rules section**

Replace rule 7 (line 237 of create-sim/SKILL.md):
```
7. Three diagram files are REQUIRED for every sim: `context.txt`, `architecture-hint.txt`, `architecture-resolution.txt`
```
Was:
```
7. `architecture.txt` is REQUIRED for every simulation package
```

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/create-sim/SKILL.md
git commit -m "feat(create-sim): update artifact requirements for three-tier diagrams

Replace architecture.txt with context.txt, architecture-hint.txt, and
architecture-resolution.txt. Add format specs and validation rules."
```

---

### Task 4: Update sim-template.md

**Files:**
- Modify: `.claude/skills/create-sim/references/sim-template.md`

- [ ] **Step 1: Update directory structure listing**

Replace `architecture.txt` in the package directory structure with the three new files:
```
  artifacts/
    context.txt              -- REQUIRED: briefing card for sim opening
    architecture-hint.txt    -- REQUIRED: clean ASCII diagram (late hint)
    architecture-resolution.txt -- REQUIRED: marked ASCII diagram (debrief)
```

- [ ] **Step 2: Replace architecture.txt section with three sections**

Replace the existing `### artifacts/architecture.txt (REQUIRED for every sim)` section with three new sections:

Section 1: `### artifacts/context.txt (REQUIRED)` -- show the briefing card format with the NovaPay example:

```
Company: NovaPay (Series B startup, 45 engineers)
Industry: Fintech / payment processing
Users: 2,300 small merchants across the eastern seaboard, $4.2M daily transaction volume
AWS Services: Amazon S3, AWS IAM, AWS CloudTrail
Your role: Incident Commander, 3:14 AM Tuesday
Situation: External security researcher reported that transaction report files are downloadable by anyone with the URL
```

Section 2: `### artifacts/architecture-hint.txt (REQUIRED)` -- show the same NovaPay ASCII diagram from the current `architecture.txt` section but with these removals:
- Remove `[PUBLIC ACCESS]` marker from the S3 bucket box
- Remove the `PROBLEM: Allows s3:GetObject to Principal: *` annotation line below the diagram
- Keep all other content (boxes, arrows, IAM role annotations, CloudTrail config)

Section 3: `### artifacts/architecture-resolution.txt (REQUIRED)` -- show the existing NovaPay ASCII diagram as-is (it already has markers). This is the current `architecture.txt` content unchanged.

- [ ] **Step 3: Update quality checklist references**

In the Manifest Quality Checklist (line ~176 of sim-template.md), replace:
```
> - `architecture.txt` exists with problem areas marked
```
With:
```
> - `context.txt` exists with 6 briefing card fields
> - `architecture-hint.txt` exists with NO problem markers
> - `architecture-resolution.txt` exists with problem markers
```

In the Architecture Diagram Rules callout (line ~379), rename the heading and update rules to cover both hint and resolution versions.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/create-sim/references/sim-template.md
git commit -m "docs(sim-template): update gold-standard example for three-tier diagrams"
```

---

### Task 5: Backfill sims 001-005 (original batch)

**Files (per sim):**
- Create: `sims/{id}/artifacts/context.txt`
- Create: `sims/{id}/artifacts/architecture-hint.txt`
- Create: `sims/{id}/artifacts/architecture-resolution.txt`
- Remove: `sims/{id}/artifacts/architecture.txt`
- Modify: `sims/{id}/manifest.json` (update artifact references)

**Approach:** Run 5 agents in parallel, one per sim. Each agent:

1. Reads `manifest.json` and `story.md` to extract company, users, services, situation
2. Generates `context.txt` briefing card
3. Copies `architecture.txt` to `architecture-resolution.txt` (already has markers)
4. Creates `architecture-hint.txt` by stripping all `[BRACKETED MARKERS]` and problem annotation lines from the diagram
5. Removes `architecture.txt`
6. Updates `manifest.json`: changes any agent artifact reference from `artifacts/architecture.txt` to `artifacts/architecture-hint.txt` (service agents serve the clean diagram when queried; the Narrator gets all three files via the template population in agent-prompts.md, not via manifest artifact references)

- [ ] **Step 1: Dispatch 5 parallel agents for sims 001-005**

Each agent gets the sim ID, the transformation rules, and the context.txt format spec.

Sims to process:
- 001-ec2-unreachable (architecture.txt referenced by vpc-console)
- 002-s3-public-exposure (architecture.txt NOT in any agent artifacts)
- 003-rds-storage-full (architecture.txt referenced by ec2-console)
- 004-lambda-access-denied (architecture.txt referenced by dynamodb-console)
- 005-elb-502-errors (architecture.txt referenced by ec2-console)

- [ ] **Step 2: Verify all 5 sims have correct files**

For each sim, confirm:
- `context.txt` exists with 6 fields
- `architecture-hint.txt` exists with NO bracketed markers
- `architecture-resolution.txt` exists with bracketed markers
- `architecture.txt` is removed
- `manifest.json` artifact references updated

- [ ] **Step 3: Commit**

```bash
git add sims/001-ec2-unreachable/ sims/002-s3-public-exposure/ sims/003-rds-storage-full/ sims/004-lambda-access-denied/ sims/005-elb-502-errors/
git commit -m "refactor(sims 001-005): migrate to three-tier diagram system

Add context.txt briefing cards, split architecture.txt into hint and
resolution versions, update manifest artifact references."
```

---

### Task 6: Backfill sims 006-011 (new batch)

**Files (per sim):**
- Create: `sims/{id}/artifacts/context.txt`
- Create: `sims/{id}/artifacts/architecture-hint.txt`
- Create: `sims/{id}/artifacts/architecture-resolution.txt`
- Remove: `sims/{id}/artifacts/architecture.txt`
- Modify: `sims/{id}/manifest.json` (update artifact references)

**Approach:** Same as Task 5, run 6 agents in parallel.

- [ ] **Step 1: Dispatch 6 parallel agents for sims 006-011**

Sims to process:
- 006-wrong-region (architecture.txt referenced by cloudwatch-console)
- 007-dynamodb-scan (architecture.txt referenced by dynamodb-console)
- 008-s3-cors-presigned (architecture.txt referenced by cloudfront-console)
- 009-credential-chain (architecture.txt NOT in any agent artifacts)
- 010-cloudformation-stuck (architecture.txt referenced by cloudformation-console)
- 011-nat-gateway-cost (architecture.txt referenced by vpc-console)

- [ ] **Step 2: Verify all 6 sims have correct files**

Same verification as Task 5.

- [ ] **Step 3: Commit**

```bash
git add sims/006-wrong-region/ sims/007-dynamodb-scan/ sims/008-s3-cors-presigned/ sims/009-credential-chain/ sims/010-cloudformation-stuck/ sims/011-nat-gateway-cost/
git commit -m "refactor(sims 006-011): migrate to three-tier diagram system

Add context.txt briefing cards, split architecture.txt into hint and
resolution versions, update manifest artifact references."
```

---

### Task 7: Final validation and push

**Files:**
- None created. Verification only.

- [ ] **Step 1: Verify no architecture.txt files remain**

```bash
find sims/ -name "architecture.txt" -type f
```
Expected: no output.

- [ ] **Step 2: Verify all sims have the three required files**

```bash
for sim in sims/0*/; do
  echo "=== $(basename $sim) ==="
  ls "$sim/artifacts/context.txt" "$sim/artifacts/architecture-hint.txt" "$sim/artifacts/architecture-resolution.txt" 2>&1
done
```
Expected: all three files listed for each sim, no errors.

- [ ] **Step 3: Verify no skill files reference architecture.txt**

```bash
grep -r "architecture\.txt" .claude/skills/
```
Expected: no output.

- [ ] **Step 4: Verify no manifests reference architecture.txt**

```bash
grep -r "architecture\.txt" sims/*/manifest.json
```
Expected: no output.

- [ ] **Step 5: Push all commits**

```bash
git push
```
