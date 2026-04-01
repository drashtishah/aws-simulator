---
name: create-sim
description: Generate AWS incident simulation packages for the play skill. Searches web for realistic incident patterns, proposes topics for approval, then generates complete sim packages (manifest, story, artifacts, resolution). Use when user says "create-sim", "generate sims", "make new simulations", or "add more scenarios".
effort: high
paths:
  - sims/**
hooks:
  PreToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "node .claude/hooks/guard-write.js --ownership .claude/skills/create-sim/ownership.json"
---

# create-sim Skill

Generates AWS incident simulation packages targeting knowledge gaps and exam coverage. Each package contains a manifest, narrative, resolution guide, and native-format artifacts that the play skill consumes.

---

## Prerequisites

Before starting, confirm these files exist:
- `learning/catalog.csv` -- Player service catalog and progress
- `sims/registry.json` -- Simulation registry
- `.claude/skills/create-sim/references/exam-topics.md` -- Exam domain reference
- `.claude/skills/create-sim/references/sim-template.md` -- Gold-standard template
- `.claude/skills/create-sim/assets/manifest-schema.json` -- Manifest validation schema

Check whether `aws-knowledge-mcp-server` is available as an active MCP tool in the current session. If it is not listed or returns an error on first call:

Tell the user:
> The AWS Knowledge MCP server (`aws-knowledge-mcp-server`) is not connected. It provides accurate API schemas, real error codes, and Agent SOPs used in step 9b and artifact generation. Without it, those steps will fall back to WebSearch, which may produce less accurate results.
> Would you like to continue with WebSearch as a fallback, or restart your session to activate the MCP server first?

Wait for the user's response. Store their answer as `mcp_available: true/false` and use it throughout the workflow.

### 0. Create GitHub Issue

Create a GitHub Issue for this sim creation session per `.claude/skills/git/references/issue-workflow.md`. Use the `enhancement` label. Title: `feat: create sim for <topic or service>`. Record the issue number for commit references.

---

## Workflow

### Phase 1: Identify Knowledge Gaps

1. Read `learning/catalog.csv` for service metadata and player progress
2. Filter for services where `knowledge_score < 2`
3. Sort by `sims_completed` ascending (least practiced first)
4. If the user provided a topic area argument (security, compute, networking, database, serverless, etc.), filter by `category` column
5. Note which certifications each service appears in (`cert_relevance` column)
6. Also consult `.claude/skills/create-sim/references/exam-topics.md` to identify services not yet in the catalog that are relevant to the player's current cert targets

### Phase 2: Research Incident Patterns

6. Use WebSearch to find realistic AWS incident patterns for the gap services. Search queries:
   - `"AWS {service} misconfiguration incident"`
   - `"AWS {service} outage postmortem"`
   - `"AWS {service} security vulnerability common"`
   - `"AWS {service} production issue root cause"`
7. Look for patterns that involve 2-3 services interacting (not single-service trivial issues)
8. Cross-reference findings against `.claude/skills/create-sim/references/exam-topics.md` to ensure exam domain coverage
9. Prioritize patterns that cover multiple exam domains or certifications
9b. **If `mcp_available: true`:** For each service in the proposed scenarios, use the following tools to collect reference data for Phase 4 artifact generation:

    For API response schemas and IAM action names:
    ```
    aws___search_documentation(
      search_phrase="<ServiceName> API response schema <ActionName>",
      topics=["reference_documentation"]
    )
    ```

    For error codes:
    ```
    aws___search_documentation(
      search_phrase="<ServiceName> error codes <ActionName>",
      topics=["troubleshooting"]
    )
    ```

    For CloudWatch metric names:
    ```
    aws___search_documentation(
      search_phrase="CloudWatch metrics <ServiceName>",
      topics=["reference_documentation"]
    )
    ```

    For the Agent SOP — two steps, do NOT skip step 1:
    ```
    Step 1: aws___search_documentation(
              search_phrase="<describe the remediation task, e.g. 'remediate S3 public access'>",
              topics=["agent_sops"]
            )
    Step 2: Find the result entry that has a `sop_name` field.
            aws___retrieve_agent_sop(sop_name=<exact value from step 1 result>)
            Do NOT guess or paraphrase the sop_name — copy it verbatim.
    ```

    For common failure modes and anti-patterns:
    ```
    aws___search_documentation(
      search_phrase="<ServiceName> common misconfiguration troubleshooting",
      topics=["troubleshooting"]
    )
    ```

    For best practices:
    ```
    aws___search_documentation(
      search_phrase="<ServiceName> security best practices",
      topics=["reference_documentation"]
    )
    ```

    For service interaction patterns (for each pair of services in the scenario):
    ```
    aws___search_documentation(
      search_phrase="<ServiceA> integration with <ServiceB>",
      topics=["reference_documentation"]
    )
    ```

    After search, pick 2-3 most relevant URLs and deep-read them:
    ```
    aws___read_documentation(url="<doc_url_from_search_results>")
    ```

    Store all returned data as labeled `mcp_research` subsections: `api_schemas`, `error_codes`, `cloudwatch_metrics`, `sop`, `failure_modes`, `best_practices`, `service_interactions`. Reference by name in steps 15-18.

    **If `mcp_available: false`:** Use WebSearch to find the API response schema and error codes for each service. Search queries:
    - `"AWS {service} API response JSON format site:docs.aws.amazon.com"`
    - `"AWS {service} error codes list"`
    - `"AWS CloudWatch metrics {service}"`
    Note: SOP-based fix criteria and resolution alignment will be skipped; rely on exam-topics.md and WebSearch findings instead.

#### 9c. Update Catalog with Discovered Services

After completing research, check whether any services encountered are missing from `learning/catalog.csv`. This includes:
- Services directly involved in the incident patterns found
- Supporting services mentioned in SOPs, best practices, or failure modes
- Less well-known or newer AWS services discovered during web search or MCP research

For each missing service, append a row to `learning/catalog.csv`:
```
{slug},{Official AWS Name},{category},{cert_codes},0,0,,
```

Where:
- `slug`: kebab-case (e.g., `resource-explorer`)
- `full_name`: official AWS name (e.g., `AWS Resource Explorer`)
- `category`: compute, storage, database, networking, security, serverless, containers, integration, management, developer-tools, analytics, ml-ai, migration
- `cert_relevance`: semicolon-separated cert codes from `.claude/skills/create-sim/references/exam-topics.md`, or empty if not exam-relevant

Report additions: "Added {N} new services to catalog: {list}."

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

12. Read `.claude/skills/create-sim/references/sim-template.md` -- study the complete annotated example
13. Read `sims/registry.json` to determine the next available sim ID number
14. Create the sim directory: `sims/{id}-{slug}/`

#### 15. Generate manifest.json

- Follow the exact structure in `sim-template.md`
- Validate against `.claude/skills/create-sim/assets/manifest-schema.json`
- ID format: 3-digit zero-padded number + kebab-case slug (e.g., `002-rds-failover-cascade`)
- Company: generate a realistic name matching the industry (never "Acme Corp")
- Narrator personality: structured object with `role`, `demeanor`, and `recurring_concern` fields
- Story beats: minimum `start` and `fix_validated` triggers; add time-based pressure beats. Non-section beats use `facts` arrays (not `message` strings)
- Hints: 3-5 hints progressing from vague to specific, using `hint` field (not `text`)
- Agents: minimum 2 service consoles; one per involved AWS service
- Every service in the `services` array MUST have a corresponding console entry
- Fix criteria: at least 2, with at least 1 marked `required: true`
- Fix criteria must align with the Agent SOP retrieved in step 9b: require the same remediation actions the SOP prescribes, in the same order where sequence matters. Describe each criterion in plain English so a beginner understands what action to take, then name the specific AWS API or setting.
- Exam topics: reference real domains from `.claude/skills/create-sim/references/exam-topics.md`
- Glossary: for each AWS term, API action, or service concept in the sim's artifacts or story, write a 1-2 sentence definition pitched at an AWS beginner. 5-10 entries. Use your own knowledge of AWS -- no MCP needed for basic definitions. Do not define common English words.
- Narrative arc: map this sim's story to the Campbell monomyth using `.claude/skills/create-sim/references/story-structure.md`. Each field (`call`, `threshold`, `trials`, `revelation`, `return`) is a short factual pacing cue describing what that phase looks like in THIS specific sim. No styled prose -- plain facts only. The `call` field should reference "story.md Opening" rather than duplicating its facts.
- System narration: for each major component in the architecture diagram, write a `components` entry with `name`, `role`, `connections`, and `failure_impact`. Write `data_flow` (normal data path) and `what_broke` (resolution-only). Source from `mcp_research.service_interactions`.
- Hints: generate as objects with `hint`, `relevant_services`, and `skip_if_queried` fields. For each hint, identify which services it relates to and which services, if already queried by the player, would make this hint redundant. Consult `.claude/skills/create-sim/references/game-design.md` for adaptive hint design principles. Hints still progress from vague to specific.
- SOP steps: from the SOP in step 9b, write the full "How AWS recommends approaching this" section as numbered steps adapted to the sim's specific resources and company name. If no SOP was found, generate equivalent best-practice remediation steps from `mcp_research.best_practices` instead -- this field is required, never omit it. Follow the beginner-friendly writing rule below.
- Related failure modes: from `mcp_research.failure_modes` and `mcp_research.best_practices`, generate 2-4 alternative failure modes for the same services. Each has `scenario`, `how_it_differs`, and `prevention`. Follow the beginner-friendly writing rule below.
- SOP practices: from the SOP in step 9b, extract 2-4 best-practice recommendations beyond the immediate fix -- preventive measures, guardrails, operational habits. If no SOP, use `mcp_research.best_practices`. Follow the beginner-friendly writing rule below.

**Beginner-friendly writing rule for all MCP-sourced content**: Every field populated from `mcp_research` data -- SOP steps, related failure modes, SOP practices, key concepts, remediation steps, system narration `failure_impact` and `what_broke` -- must be written for someone who does not yet know AWS terminology. Lead with a plain English explanation of what happens and why it matters. Then introduce the official AWS term, API action, or concept name. Never drop a term like "ACL", "presigned URL", "Origin Access Control", "PrincipalOrgID", "BucketOwnerEnforced", or any service-specific jargon without first explaining the idea in everyday language. The glossary handles definitions; these sections handle context and consequences.

#### 16. Generate story.md

- Consult `.claude/skills/create-sim/references/story-structure.md` for story beat pacing
- YAML frontmatter with tags: type/simulation, service/{slug} for each service, difficulty/{level-name}, category/{category}
- Difficulty tag mapping: 1=starter, 2=associate, 3=professional, 4=expert
- Opening section (structured facts, not prose):
  - company, industry, product, scale
  - time, scene, alert (the exact alert text)
  - stakes (concrete deadlines, user impact)
  - early_signals (list of what users/stakeholders are reporting)
  - investigation_starting_point (what the player knows at the start)
- Resolution section (structured facts, not prose):
  - root_cause (what went wrong, when, who, what specific resource)
  - mechanism (how the root cause produces the symptoms)
  - fix (specific remediation action and its immediate effect)
  - contributing_factors (list of systemic issues that allowed this to happen)

#### 17. Generate resolution.md

- YAML frontmatter matching `story.md` tags
- Sections: Root Cause, Timeline (table), Correct Remediation (numbered), Key Concepts, Other Ways This Could Break, SOP Best Practices, Learning Objectives
- All sections follow the beginner-friendly writing rule from step 15.
- Root Cause: explain the misconfiguration in plain English first, then name the specific AWS resource, API action, or policy field.
- Correct Remediation: the numbered steps must align with the Agent SOP retrieved in step 9b. Each step should explain what it accomplishes before naming the AWS setting or API action.
- Key Concepts: explain 2-3 AWS concepts at the appropriate difficulty depth. Assume the reader is encountering these concepts for the first time -- lead with what the concept does and why it matters, then name the AWS feature.
- AWS documentation links must point to real docs pages
- Learning objectives should be concrete and testable

#### 18. Generate artifacts/

Every sim MUST include these artifacts at minimum:

| File | Format | Purpose | When Shown |
|---|---|---|---|
| `context.txt` | Structured briefing card | Orientation at sim start | Opening |
| `architecture-hint.txt` | ASCII diagram, clean | Late hint for stuck players | After hints exhausted |
| `architecture-resolution.txt` | ASCII diagram, marked | Answer key with problem areas | Resolution debrief |
| At least 2 service-specific artifacts | Native AWS format | Evidence for investigation | On query |

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
- AWS Services uses official names from learning/catalog.csv
- No markers, no hints about the root cause

**architecture-hint.txt rules:**
- Same level of detail as architecture-resolution.txt but with ALL problem markers removed
- No `[PROBLEM]`, `[PUBLIC ACCESS]`, `[DELETED]`, `[WRONG REGION]`, or similar annotations
- IAM roles, permissions, and data flow arrows are shown (these are factual, not hints)
- Resource names match the company story

**architecture-resolution.txt rules:**
- Identical to architecture-hint.txt plus problem markers
- Markers use the format `[ALL CAPS DESCRIPTION]` next to the affected resource
- May include annotation lines below the diagram explaining the problem area

Before generating each service-specific artifact, use the `aws-knowledge-mcp-server` data retrieved in step 9b to verify accuracy:
- JSON field names and types must match the real AWS API response exactly
- Error codes must use the exact strings AWS returns (e.g., `"AccessDeniedException"` not `"AccessDenied"`)
- CloudWatch metric names must be from the service's published metric list
- IAM action names in `cloudtrail-events.json` must use the correct format (e.g., `"s3:GetBucketPolicy"`)

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

- Verify `manifest.json` structure matches `.claude/skills/create-sim/assets/manifest-schema.json`
- Confirm every artifact referenced in manifest `consoles[].artifacts` exists
- Confirm every service in `manifest.services` has a corresponding console entry
- Confirm `context.txt` exists and follows the briefing card format (6 fields, one per line)
- Confirm `architecture-hint.txt` exists and contains NO problem markers
- Confirm `architecture-resolution.txt` exists and contains problem markers
- Confirm `architecture.txt` does NOT exist (old format removed)
- Confirm `story.md` and `resolution.md` have valid YAML frontmatter

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

22. Follow the commit procedure in `.claude/skills/git/references/commit-procedure.md`. Stage the sim directory and registry files. Use `Closes #N` referencing the issue from step 0. Include action lines:

    feat(sim): add sim {id} -- {short title}

    Closes #N

    intent(sim): <what knowledge gap this sim fills>
    decision(sim): <key design choices for this scenario>
    learned(sim): <anything discovered during research>

23. Done. Do not push automatically. Let the user decide when to push.

---

## Content Style

Sim content is theme-agnostic structured data. The play skill renders all text through the player's chosen theme at runtime.

story.md uses structured facts (key: value pairs) for Opening and Resolution sections, not prose. See any existing sim's story.md for the format.

Manifest story_beats use `facts` arrays instead of `message` strings. Manifest hints use `hint` with plain guidance sentences, not styled prose. Manifest narrative_arc uses factual pacing cues, not styled descriptions. Manifest narrator.personality uses a structured object (role, demeanor, recurring_concern), not a styled character description string.

Sim titles are theme-invariant. They read like chapter headings -- quiet, understated, slightly literary. Examples: "A Function in the Wrong Room," "Four Million Records, One by One," "Someone Else's Keys."

---

## Rules

1. No emojis in any output, files, or UI
2. Markdown formatting for all files: YAML frontmatter tags, callout syntax where appropriate
3. All narrative text is rendered at play-time through the player's chosen theme -- sim content is structured facts only
4. AWS vocabulary throughout -- use official service names (Amazon S3, not "S3 storage"), official API action names (PutBucketPolicy, not "change bucket settings")
5. Artifacts in native AWS formats -- never wrap AWS JSON/logs in markdown code blocks within artifact files
6. Every sim requires at least 2 service consoles
7. Three diagram files are REQUIRED for every sim: `context.txt`, `architecture-hint.txt`, `architecture-resolution.txt`
8. Difficulty must match cert level: Level 1-2 for Associate services, Level 3-4 for Professional/Specialty services
9. Company names must feel real -- match the industry, sound like a startup or enterprise that could exist
10. Sim IDs are globally unique and sequential -- always check registry.json for the next available number
11. Never generate a sim for a topic that already exists in the registry unless the user explicitly asks for a variant
12. Sim titles read like chapter headings -- quiet, understated, slightly literary

## Related

- [[sim-template]] -- Complete annotated example of a simulation package
- [[exam-topics]] -- Exam domain and incident pattern reference
- [[manifest-schema.json]] -- JSON Schema for manifest validation
- [[learning/catalog.csv]] -- Player service catalog and progress
- [[story-structure]] -- Campbell monomyth mapping for sim storytelling
- [[themes/_base]] -- Structural constants for the theme system
- [[game-design]] -- Text-based game and investigation design best practices
