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

Check whether `aws-knowledge-mcp-server` is available as an active MCP tool in the current session. If it is not listed or returns an error on first call:

Tell the user:
> The AWS Knowledge MCP server (`aws-knowledge-mcp-server`) is not connected. It provides accurate API schemas, real error codes, and Agent SOPs used in step 9b and artifact generation. Without it, those steps will fall back to WebSearch, which may produce less accurate results.
> Would you like to continue with WebSearch as a fallback, or restart your session to activate the MCP server first?

Wait for the user's response. Store their answer as `mcp_available: true/false` and use it throughout the workflow.

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
- Agents: minimum 2 service consoles; one per involved AWS service
- Every service in the `services` array MUST have a corresponding console entry
- Fix criteria: at least 2, with at least 1 marked `required: true`
- Fix criteria must align with the Agent SOP retrieved in step 9b: require the same remediation actions the SOP prescribes, in the same order where sequence matters
- Exam topics: reference real domains from `references/exam-topics.md`
- Glossary: for each AWS term, API action, or service concept in the sim's artifacts or story, write a 1-2 sentence definition pitched at an AWS beginner. 5-10 entries. Use your own knowledge of AWS -- no MCP needed for basic definitions. Do not define common English words.
- Narrative arc: map this sim's story to the Campbell monomyth using `references/story-structure.md`. Each field (`call`, `threshold`, `trials`, `revelation`, `return`) is a short sentence describing what that phase looks like in THIS specific sim. Write in the Emi Yagi voice -- flat, observational, concrete.
- System narration: for each major component in the architecture diagram, write a `components` entry with `name`, `role`, `connections`, and `failure_impact`. Write `data_flow` (normal data path) and `what_broke` (resolution-only). Source from `mcp_research.service_interactions`.
- Hints: generate as objects with `text`, `relevant_services`, and `skip_if_queried` fields. For each hint, identify which services it relates to and which services, if already queried by the player, would make this hint redundant. Consult `references/game-design.md` for adaptive hint design principles. Hints still progress from vague to specific.
- SOP steps: from the SOP in step 9b, write the full "How AWS recommends approaching this" section as numbered steps adapted to the sim's specific resources and company name. If no SOP was found, generate equivalent best-practice remediation steps from `mcp_research.best_practices` instead -- this field is required, never omit it.
- Related failure modes: from `mcp_research.failure_modes` and `mcp_research.best_practices`, generate 2-4 alternative failure modes for the same services. Each has `scenario`, `how_it_differs`, and `prevention`.
- SOP practices: from the SOP in step 9b, extract 2-4 best-practice recommendations beyond the immediate fix -- preventive measures, guardrails, operational habits. If no SOP, use `mcp_research.best_practices`.

#### 16. Generate story.md

- Consult `references/story-structure.md` for story beat pacing and `references/narrative-voice.md` for prose calibration
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
- Sections: Root Cause, Timeline (table), Correct Remediation (numbered), Key Concepts, Other Ways This Could Break, SOP Best Practices, Learning Objectives
- The numbered remediation steps must align with the Agent SOP retrieved in step 9b, presented in the same sequence the SOP prescribes, adapted to the sim's specific company and resources
- AWS documentation links must point to real docs pages
- Key Concepts should explain 2-3 AWS concepts at the appropriate difficulty depth
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
- AWS Services uses official names from catalog.csv
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

- Verify `manifest.json` structure matches `assets/manifest-schema.json`
- Confirm every artifact referenced in manifest `consoles[].artifacts` exists
- Confirm every service in `manifest.services` has a corresponding console entry
- Confirm `context.txt` exists and follows the briefing card format (6 fields, one per line)
- Confirm `architecture-hint.txt` exists and contains NO problem markers
- Confirm `architecture-resolution.txt` exists and contains problem markers
- Confirm `architecture.txt` does NOT exist (old format removed)
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

## Narrative Style

The narrative voice for all story.md files follows the register of contemporary Japanese literary fiction -- specifically the quiet, observational tone of works like *Diary of a Void* (Emi Yagi).

**Principles:**

- Simple, short declarative sentences. No compound sentences where two simple ones will do.
- Flat affect. The stress lives in what is left unsaid, not in exclamation marks or "the clock is ticking" urgency.
- Mundane details sit right next to the crisis and are given equal weight. A deploy fails; the coffee is cold; the product manager sends a message.
- No breathlessness. No dramatic narration. No "your heart races" or "time is running out."
- Observations stacked like small facts. Let the weight accumulate on its own.
- The narrator states what happened. The reader feels the tension.

**Sim titles** should read like chapter headings, not incident reports. Quiet, understated, slightly literary. Examples: "A Function in the Wrong Room," "Four Million Records, One by One," "Someone Else's Keys."

**Narrator personality** in manifests should match: a quiet observer who states facts, not a high-energy SRE barking updates. Story beats use the same flat register.

**What to avoid:**
- Exclamation marks
- "The clock is ticking" / "time is running out" / "your heart races"
- Breathless compound sentences strung together with dashes
- Dramatic rhetorical questions
- Any language that sounds like a thriller novel or a conference talk

**Example opening (good):**

> The terminal said `ResourceNotFoundException`. I read it twice. I had deployed the function twenty minutes ago. I watched it succeed. The green checkmark was still in the pipeline dashboard, small and certain.

**Example opening (bad):**

> It's 3 AM and your phone is BUZZING -- a PagerDuty alert screams across your nightstand! The API is down, customers are furious, and the clock is ticking. You need to figure out what went wrong before the VP joins the war room!

---

## Rules

1. No emojis in any output, files, or UI
2. Obsidian formatting for all markdown: YAML frontmatter tags, wiki-links for internal references, callout syntax where appropriate
3. Narrative language follows the style guide above -- quiet, observational, impact shown through concrete detail not dramatic language
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
- [[catalog.csv]] -- AWS services catalog with knowledge gaps
- [[story-structure]] -- Campbell monomyth mapping for sim storytelling
- [[narrative-voice]] -- Emi Yagi style guide for narrative prose
- [[game-design]] -- Text-based game and investigation design best practices
