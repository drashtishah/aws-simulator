---
name: create-sim
description: Generate AWS incident simulation packages for the play skill. Searches web for realistic incident patterns, proposes topics for approval, then generates complete sim packages (manifest, story, artifacts, resolution). Use when user says "create-sim", "generate sims", "make new simulations", or "add more scenarios".
---

# create-sim Skill

Generates AWS incident simulation packages targeting knowledge gaps and exam coverage. Each package contains a manifest, narrative, resolution guide, and native-format artifacts that the play skill consumes.

---

## Prerequisites

Before starting, confirm these files exist:
- `services/catalog.csv` -- AWS service catalog with knowledge scores
- `sims/registry.json` -- Simulation registry
- `.claude/skills/create-sim/references/exam-topics.md` -- Exam domain reference
- `.claude/skills/create-sim/references/sim-template.md` -- Gold-standard template
- `.claude/skills/create-sim/assets/manifest-schema.json` -- Manifest validation schema

---

## Workflow

### Phase 1: Identify Knowledge Gaps

1. Read `services/catalog.csv`
2. Filter for services where `knowledge_score < 2` AND `exam_priority` is 1 or 2
3. Sort by `exam_priority` ascending (highest priority first)
4. If the user provided a topic area argument (security, compute, networking, database, serverless, etc.), filter the gap list to that category
5. Note which certifications each gap service appears in (`cert_relevance` column)

### Phase 2: Research Incident Patterns

6. Use WebSearch to find realistic AWS incident patterns for the gap services. Search queries:
   - `"AWS {service} misconfiguration incident"`
   - `"AWS {service} outage postmortem"`
   - `"AWS {service} security vulnerability common"`
   - `"AWS {service} production issue root cause"`
7. Look for patterns that involve 2-3 services interacting (not single-service trivial issues)
8. Cross-reference findings against `references/exam-topics.md` to ensure exam domain coverage
9. Prioritize patterns that cover multiple exam domains or certifications

### Phase 3: Propose Scenarios

10. Present 5-6 scenario proposals to the user. For each proposal, show:

```
## Proposal N: {Title}
- Services: {service1}, {service2}, {service3}
- Difficulty: {1-4}
- Category: {security|reliability|performance|cost|operations|networking|data|migration}
- Pitch: {One compelling sentence describing the incident}
- Gaps filled: {Which catalog services get coverage}
- Exam topics: {Which cert domains this covers}
```

11. Ask the user which proposals to approve. Wait for response before proceeding.

### Phase 4: Generate Simulation Packages

For each approved scenario, execute steps 12-19:

12. Read `references/sim-template.md` -- study the complete annotated example
13. Read `sims/registry.json` to determine the next available sim ID number
14. Create the sim directory: `sims/{id}-{slug}/`

#### 15. Generate manifest.json

- Follow the exact structure in `sim-template.md`
- Validate against `assets/manifest-schema.json`
- ID format: 3-digit zero-padded number + kebab-case slug (e.g., `002-rds-failover-cascade`)
- Company: generate a realistic name matching the industry (never "Acme Corp")
- Narrator personality: match the incident tone (3am page vs business-hours escalation)
- Story beats: minimum `start` and `fix_validated` triggers; add time-based pressure beats
- Hints: 3-5 hints progressing from vague to specific
- Agents: minimum 2 service agents; one per involved AWS service
- Every service in the `services` array MUST have a corresponding agent
- Fix criteria: at least 2, with at least 1 marked `required: true`
- Exam topics: reference real domains from `references/exam-topics.md`

#### 16. Generate story.md

- Obsidian frontmatter with tags: `type/simulation`, `service/{slug}` for each service, `difficulty/{level-name}`, `category/{category}`
- Difficulty tag mapping: 1=starter, 2=associate, 3=professional, 4=expert
- Opening section (3-4 paragraphs):
  - Start with sensory detail (phone buzzing, Slack notification, dashboard turning red)
  - Name the company, its business, its scale (revenue, users, team size)
  - Describe customer impact in concrete terms (merchants cannot process payments, users see errors)
  - Establish urgency and the player's role as Incident Commander
- Resolution section (2-3 paragraphs):
  - Explain the full causal chain
  - State when the misconfiguration was introduced and by whom
  - Describe the fix and preventive measures

#### 17. Generate resolution.md

- Obsidian frontmatter matching `story.md` tags
- Sections: Root Cause, Timeline (table), Correct Remediation (numbered), Key Concepts, AWS Documentation Links, Learning Objectives
- AWS documentation links must point to real docs pages
- Key Concepts should explain 2-3 AWS concepts at the appropriate difficulty depth
- Learning objectives should be concrete and testable

#### 18. Generate artifacts/

Every sim MUST include these artifacts at minimum:

| File | Format | Purpose |
|---|---|---|
| `architecture.txt` | ASCII diagram | Infrastructure layout with problem area marked |
| At least 2 service-specific artifacts | Native AWS format | Evidence for investigation |

Common artifact types (generate as needed based on services involved):

- `bucket-policy.json` -- S3 bucket policy (native AWS JSON)
- `iam-policy.json` -- IAM policy document (native AWS JSON)
- `cloudtrail-events.json` -- CloudTrail event records (native AWS JSON)
- `cloudwatch-logs.txt` -- Log entries with ISO 8601 timestamps, levels, service tags
- `s3-access-logs.txt` -- S3 server access log format (space-delimited)
- `vpc-flow-logs.txt` -- VPC Flow Log records
- `metrics.csv` -- CSV: timestamp, metric_name, value, unit
- `config-snapshot.json` -- AWS Config resource configuration
- `security-group-rules.json` -- Security group ingress/egress rules
- `route-table.json` -- VPC route table entries
- `alarm-config.json` -- CloudWatch alarm configuration
- `event-rule.json` -- EventBridge rule definition
- `task-definition.json` -- ECS task definition
- `lambda-config.json` -- Lambda function configuration

Artifact rules:
- Native AWS formats only -- no markdown wrappers
- Realistic resource names matching the company and story
- Timestamps consistent with the story timeline
- Include both the evidence (the problem) and context (normal operations)
- Red herrings for difficulty 2+: include artifacts that look suspicious but are not the root cause

#### 19. Validate the package

- Verify `manifest.json` structure matches `assets/manifest-schema.json`
- Confirm every artifact referenced in manifest `agents[].artifacts` exists
- Confirm every service in `manifest.services` has a corresponding agent
- Confirm `architecture.txt` exists
- Confirm `story.md` and `resolution.md` have valid Obsidian frontmatter

### Phase 5: Register and Index

20. Read `sims/registry.json`, append each new sim:
```json
{
  "id": "002-rds-failover-cascade",
  "title": "The Title",
  "difficulty": 3,
  "category": "reliability",
  "services": ["rds", "route53", "cloudwatch"],
  "created": "2026-03-24"
}
```

21. Regenerate `sims/index.md` from the registry:
```markdown
---
tags:
  - type/index
  - scope/simulations
---

# Simulation Index

| ID | Title | Difficulty | Category | Services |
|---|---|---|---|---|
| 001-s3-bucket-breach | The Midnight S3 Breach at NovaPay | 2 | security | s3, iam, cloudtrail |
```

### Phase 6: Commit

22. Stage all new sim files:
```bash
git add sims/{id}-{slug}/
git add sims/registry.json
git add sims/index.md
```

23. Commit with message format:
```
feat: add sim {id} -- {short title}
```

24. Push to remote:
```
git push
```

---

## Rules

1. No emojis in any output, files, or UI
2. Obsidian formatting for all markdown: YAML frontmatter tags, wiki-links for internal references, callout syntax where appropriate
3. Customer-obsessed narrative language -- stories are about impact on real users, not abstract technical problems
4. AWS vocabulary throughout -- use official service names (Amazon S3, not "S3 storage"), official API action names (PutBucketPolicy, not "change bucket settings")
5. Artifacts in native AWS formats -- never wrap AWS JSON/logs in markdown code blocks within artifact files
6. Every sim requires at least 2 service agents plus the narrator
7. `architecture.txt` is REQUIRED for every simulation package
8. Difficulty must match cert level: Level 1-2 for Associate services, Level 3-4 for Professional/Specialty services
9. Company names must feel real -- match the industry, sound like a startup or enterprise that could exist
10. Sim IDs are globally unique and sequential -- always check registry.json for the next available number
11. Never generate a sim for a topic that already exists in the registry unless the user explicitly asks for a variant

## Related

- [[sim-template]] -- Complete annotated example of a simulation package
- [[exam-topics]] -- Exam domain and incident pattern reference
- [[manifest-schema.json]] -- JSON Schema for manifest validation
- [[catalog.csv]] -- AWS services catalog with knowledge gaps
