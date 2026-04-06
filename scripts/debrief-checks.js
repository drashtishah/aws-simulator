const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/**
 * Build a debrief quality validation prompt for a sim.
 * Reads the manifest to understand what the debrief should cover,
 * then asks the agent to validate the three-stage protocol.
 */
function buildDebriefPrompt(simId) {
  const manifestPath = path.join(ROOT, 'sims', simId, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Sim not found: ${simId}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const resolution = manifest.resolution || {};

  return `You are a QA reviewer validating the debrief protocol for an AWS incident simulation.

## Simulation: ${simId}
## Title: ${manifest.title}

## Resolution Data

Root cause: ${resolution.root_cause || 'not specified'}

Fix criteria:
${(resolution.fix_criteria || []).map(c => `- [${c.required ? 'required' : 'optional'}] ${c.id}: ${c.description}`).join('\n')}

Learning objectives:
${(resolution.learning_objectives || []).map(o => `- ${o}`).join('\n')}

Related failure modes:
${(resolution.related_failure_modes || []).map(f => `- ${f}`).join('\n')}

SOP steps:
${(resolution.sop_steps || []).map(s => `- ${s}`).join('\n')}

## Debrief Protocol Rules

Stage 1 (Summary): Keep short. State root cause in one plain-English sentence. Under 300 words.
Stage 2 (Seed questions): Exactly 3 seeds: one concept (from learning_objectives), one how-to (from fix_criteria), one what-else (from related_failure_modes).
Stage 3 (Conversation): Answers draw from correct manifest zones (concepts, remediation, process, failure_modes, practices).

## Dimensions to validate

1. summary_brevity: Stage 1 should be under 300 words with root cause in one sentence
2. seed_quality: Stage 2 should have exactly 3 seeds (concept, how-to, what-else) drawn from correct sources
3. zone_accuracy: Answers should draw from correct manifest zones
4. no_new_info: Debrief should not introduce facts not in the manifest/artifacts
5. voice_continuity: Same literary voice as gameplay (flat affect, short declaratives)

## Response Format

Return ONLY a JSON block:
\`\`\`json
{
  "pass": true,
  "findings": [
    { "dimension": "summary_brevity", "pass": true, "detail": "explanation" },
    { "dimension": "seed_quality", "pass": true, "detail": "explanation" },
    { "dimension": "zone_accuracy", "pass": true, "detail": "explanation" },
    { "dimension": "no_new_info", "pass": true, "detail": "explanation" },
    { "dimension": "voice_continuity", "pass": true, "detail": "explanation" }
  ]
}
\`\`\`

Set "pass" at the top level to false if ANY dimension fails.`;
}

/**
 * Run debrief quality check.
 * @param {string} simId
 * @returns {Promise<{ pass: boolean, findings: Array, usage: object|null, error: string|null }>}
 */
async function runDebriefCheck(simId) {
  const { runAgentCheck } = require('./agent-test-runner');
  const prompt = buildDebriefPrompt(simId);
  return runAgentCheck({ prompt });
}

module.exports = { buildDebriefPrompt, runDebriefCheck };
