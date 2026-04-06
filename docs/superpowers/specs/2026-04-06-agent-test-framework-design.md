# Agent-in-the-Loop Test Framework + Content Validation

## Problem

Sim summaries, titles, and metadata can drift from actual content (e.g., sim 023 said "afternoon" when the story is about a morning rush). Keyword-overlap heuristics catch nothing meaningful. An LLM agent can read all sim files and judge whether the metadata accurately describes the content.

This is the first use case for a broader pattern: agent-in-the-loop tests where an LLM validates something that deterministic tests cannot.

## Architecture

Three new files, one CLI command update, two skill updates.

```
scripts/
  agent-test-runner.js   # Reusable framework: send prompt to Sonnet, get structured verdict
  content-checks.js      # Builds prompt for sim content validation, parses results
  sim-test.js            # New "content" subcommand added
```

### 1. Agent Test Runner (`scripts/agent-test-runner.js`)

Reusable module for any agent-in-the-loop test.

**Exports:**
- `runAgentCheck({ prompt, systemPrompt })` - returns `{ pass, findings[], usage }`

**Behavior:**
- Model: `claude-sonnet-4-6` (hardcoded, never configurable)
- No tools, no permission bypass, no `allowDangerouslySkipPermissions`
- `maxTurns: 1` (single response, no tool use loop)
- Timeout: 60 seconds
- Parses response for a JSON block (`{ "pass": bool, "findings": [...] }`)
- If JSON parsing fails, returns `{ pass: false, findings: [{ dimension: "parse_error", ... }] }`
- Logs usage (input/output tokens) for cost tracking

**Finding schema:**
```json
{
  "dimension": "summary|title|difficulty|services|tags|category|learning_objectives",
  "pass": true/false,
  "detail": "explanation of what's wrong or right"
}
```

### 2. Content Checks (`scripts/content-checks.js`)

Builds the validation prompt for a specific sim.

**Exports:**
- `buildContentPrompt(simId)` - reads all sim files, returns prompt string
- `runContentCheck(simId)` - calls buildContentPrompt + runAgentCheck, returns structured result

**What it reads:**
- `sims/{simId}/manifest.json`
- `sims/{simId}/story.md`
- `sims/{simId}/resolution.md` (if exists)
- All files in `sims/{simId}/artifacts/`
- `sims/registry.json` (the entry for this sim)

**Prompt structure:**
```
You are a QA reviewer for AWS incident simulation packages.

Below is the complete content of simulation "{simId}". Review it and validate
each dimension listed below. Return a JSON object with your findings.

## Dimensions to validate

1. summary: Does the summary in registry/manifest accurately describe what happens
   in the story? Check for factual errors (wrong time of day, wrong service, wrong
   symptom).
2. title: Does the title fit the narrative arc and incident type?
3. difficulty: Given the number of services, complexity of the root cause, and
   investigation depth required, does the difficulty rating (1-5) seem appropriate?
4. services: Do the listed services match what actually appears in the artifacts
   and story? Are any missing or extraneous?
5. tags: Are the tags relevant to the actual incident mechanism?
6. category: Does the category (networking, performance, security, etc.) match
   the primary failure domain?
7. learning_objectives: Do they match what the sim actually teaches based on the
   resolution and SOP steps?

## Sim Content

[manifest.json contents]
[story.md contents]
[resolution.md contents]
[artifacts contents]
[registry entry]

## Response Format

Return ONLY a JSON block:
{
  "pass": true/false,  // true only if ALL dimensions pass
  "findings": [
    { "dimension": "summary", "pass": true/false, "detail": "..." },
    ...7 entries, one per dimension
  ]
}
```

### 3. CLI Command (`sim-test content <simId>`)

**Usage:**
```
sim-test content <simId>           # validate a specific sim
sim-test content <simId> --json    # structured JSON output
```

**Behavior:**
- Validates simId exists in registry
- Calls `runContentCheck(simId)`
- Prints findings table to stdout (or JSON with --json)
- Exit code 0 if pass, 1 if any finding fails
- Writes result to `web/test-results/content/{simId}-{timestamp}.json`

**Output format (terminal):**
```
Content validation: 023-sagemaker-endpoint-scaling

  summary ............ PASS
  title .............. PASS
  difficulty ......... PASS
  services ........... PASS
  tags ............... PASS
  category ........... PASS
  learning_objectives  PASS

  result: PASS (7/7)
  tokens: 2,340 in / 890 out
```

### 4. Skill Updates

**sim-test skill** (`.claude/skills/sim-test/SKILL.md`):
- Add Option D: "Run content validation" with `sim-test content <simId>` usage

**create-sim skill** (`.claude/skills/create-sim/SKILL.md`):
- Add final step: "Run `sim-test content <simId>` to validate the generated sim"

### 5. Existing Test Updates

Remove the keyword-overlap heuristic test from `web/test/cross-file-consistency.test.js` (the "registry summaries share keywords with manifest summaries" test). It is superseded by this agent-based check and provides false confidence.

## Testing

Unit tests for the new code (in `web/test/`):
- `content-checks.test.js`:
  - `buildContentPrompt` returns string containing manifest, story, and artifact content
  - `buildContentPrompt` throws for nonexistent sim
  - Source of `agent-test-runner.js` hardcodes `claude-sonnet-4-6`
  - Source of `agent-test-runner.js` does NOT contain `allowDangerouslySkipPermissions`

No unit test for the actual agent call (that would require a live API call). The `sim-test content` command itself is the integration test.

## Future Use Cases

The `runAgentCheck` framework enables future agent-in-the-loop tests:
- Prompt quality validation (does the system prompt follow conventions?)
- Artifact realism checks (do mock CloudWatch logs look realistic?)
- Difficulty calibration (compare difficulty ratings across sims)
- Narrative consistency (do story beats align with the narrative arc?)

Each new check just needs a prompt builder function and a call to `runAgentCheck`.
