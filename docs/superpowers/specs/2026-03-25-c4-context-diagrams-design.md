---
tags:
  - type/spec
  - scope/play-skill
  - scope/create-sim-skill
  - status/approved
---

# C4 Context Diagrams for Sim Start

**Date:** 2026-03-25
**Status:** Approved

## Problem

The current play skill shows `architecture.txt` at the start of every simulation. These diagrams are detailed container-level views that mark the problem area with labels like `[PUBLIC ACCESS]` or `[DELETED]`. This spoils the investigation -- the player sees the answer before they start looking.

## Solution

Replace the single `architecture.txt` with three artifacts that serve different moments in the simulation:

1. **`context.txt`** -- a structured briefing card shown at sim start. Orientation only, no architecture details.
2. **`architecture-hint.txt`** -- a clean architecture diagram (no problem markers) offered as a late hint when the player is stuck.
3. **`architecture-resolution.txt`** -- the full architecture diagram with `[PROBLEM]` markers, shown during the resolution debrief.

The old `architecture.txt` file is removed from all sims.

## Artifact Specifications

### context.txt

A plain-text briefing card. No boxes, no arrows. Matches the quiet narrative tone of the sim stories.

Format:

```
Company: {name} ({size})
Industry: {industry}
Users: {concrete user/customer description with numbers}
AWS Services: {official service names, comma-separated}
Your role: {role and time/day context}
Situation: {one sentence describing what brought you here}
```

Example (sim 011):

```
Company: Fieldspar Analytics (Series A, 14 engineers)
Industry: Industrial IoT / sensor data analytics
Users: 42 manufacturing plants, 12,000 sensors pushing telemetry
AWS Services: NAT Gateway, Amazon S3, Amazon VPC, Amazon CloudWatch
Your role: On-call engineer, Wednesday morning
Situation: Finance flagged a $907 charge on a single day labeled "NAT Gateway data processing"
```

Rules:
- One line per field. No prose, no paragraphs.
- Users line includes concrete numbers (not "many users").
- Situation line is factual, not dramatic. States what happened, not how to feel about it.
- AWS Services uses official names from catalog.csv.
- No markers, no hints about the root cause.

### architecture-hint.txt

The infrastructure diagram in ASCII, showing services, connections, data flows, IAM roles. Same level of detail as the current `architecture.txt` but with all problem markers removed.

Rules:
- No `[PROBLEM]`, `[PUBLIC ACCESS]`, `[DELETED]`, `[WRONG REGION]`, or similar markers.
- No annotations that point to the root cause.
- IAM roles and their permissions are shown (these are factual, not hints).
- Data flow arrows are shown.
- Resource names match the company story.

### architecture-resolution.txt

Identical to `architecture-hint.txt` but with problem markers added. This is the "answer key" version.

Rules:
- Markers use the format `[ALL CAPS DESCRIPTION]` next to the affected resource.
- May include additional annotations below the diagram explaining the problem area.
- Shown only during the resolution debrief, never during active investigation.

## Play Skill Changes

### Step 11 (Opening Delivery)

Current behavior:
1. Narrator delivers Opening section from story.md
2. Narrator presents architecture.txt
3. Player begins investigating

New behavior:
1. Narrator delivers Opening section from story.md
2. Narrator presents context.txt as a briefing card
3. Player begins investigating

### Hints System

Current behavior: hints array in manifest, delivered sequentially when player asks for help.

New behavior: same, but with an additional final tier. After the player exhausts `max_hints_before_nudge` hints, the Narrator offers the architecture diagram:

> "Here is what the infrastructure looks like."

Then displays `architecture-hint.txt`. This is the last nudge before the Narrator begins giving the answer away.

The manifest does not need a new field for this -- the play skill handles it as built-in behavior. The hint threshold is already defined by `max_hints_before_nudge`.

### Resolution Debrief (Steps 19-20)

Current behavior: Narrator delivers Resolution section from story.md, then resolution.md content.

New behavior: Narrator delivers Resolution section from story.md, then displays `architecture-resolution.txt` (with markers), then resolution.md content. The marked diagram gives the player a visual summary of what went wrong before the detailed written explanation.

### Narrator Spawn Prompt

Update the Narrator's initialization to reference:
- `context.txt` -- for the opening briefing
- `architecture-hint.txt` -- available as late-stage hint material
- `architecture-resolution.txt` -- for the resolution debrief

Remove reference to `architecture.txt`.

## Create-Sim Skill Changes

### Step 18 (Generate Artifacts)

Replace the `architecture.txt` requirement with three files:

| File | Format | Purpose | When Shown |
|---|---|---|---|
| `context.txt` | Structured briefing card | Orientation at sim start | Opening |
| `architecture-hint.txt` | ASCII diagram, clean | Late hint for stuck players | After hints exhausted |
| `architecture-resolution.txt` | ASCII diagram, marked | Answer key with problem areas | Resolution debrief |

### Step 19 (Validate the Package)

Update validation checklist:
- Confirm `context.txt` exists and follows the briefing card format
- Confirm `architecture-hint.txt` exists and contains NO problem markers
- Confirm `architecture-resolution.txt` exists and contains problem markers
- Confirm `architecture.txt` does NOT exist (old format)

### Artifact Rules Table

Update the artifact rules table to replace the `architecture.txt` row with three rows for the new files.

## Manifest Schema Changes

No structural schema changes required. The architecture files are referenced as paths in `manifest.team.agents[].artifacts` and `manifest.team.narrator` prompt context. The filenames change but the schema shape does not.

Agent artifact references in manifests should be updated to point to the new filenames where applicable.

## Backfill: All 11 Existing Sims

For each sim (001 through 011):

1. **Generate `context.txt`** from:
   - `manifest.json` company fields (name, industry, size)
   - `manifest.json` services array
   - `story.md` opening (extract user/customer details and situation)

2. **Create `architecture-hint.txt`** by copying `architecture.txt` and stripping all problem markers (`[PROBLEM]`, `[PUBLIC ACCESS]`, `[DELETED]`, `[WRONG REGION]`, etc.) and any annotation lines that reveal the root cause.

3. **Create `architecture-resolution.txt`** by copying `architecture.txt` as-is (it already has markers).

4. **Remove `architecture.txt`**.

5. **Update `manifest.json`** artifact references from `artifacts/architecture.txt` to the new filenames.

This is a mechanical transformation. All 11 sims can be processed in parallel.

## File Impact Summary

| Area | Files Changed |
|---|---|
| Play skill | `.claude/skills/play/SKILL.md` |
| Create-sim skill | `.claude/skills/create-sim/SKILL.md` |
| Each sim (x11) | `manifest.json`, `artifacts/context.txt` (new), `artifacts/architecture-hint.txt` (new), `artifacts/architecture-resolution.txt` (new), `artifacts/architecture.txt` (removed) |

Total: 2 skill files + 55 sim files (5 changes per sim x 11 sims).

## Related

- [[sim-template]] -- needs update to reflect new artifact structure
- [[manifest-schema.json]] -- no structural changes needed
- [[create-sim/SKILL.md]] -- artifact generation steps
- [[play/SKILL.md]] -- opening delivery and hints system
