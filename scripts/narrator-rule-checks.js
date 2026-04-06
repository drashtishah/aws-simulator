const fs = require('fs');
const path = require('path');
const { buildPrompt } = require('../web/lib/prompt-builder');

const ROOT = path.resolve(__dirname, '..');

/**
 * Build a narrator rule compliance prompt for a sim.
 * Uses the fully populated system prompt and a scripted player message
 * to verify the narrator follows behavioral rules.
 */
function buildNarratorRulesPrompt(simId) {
  const manifestPath = path.join(ROOT, 'sims', simId, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Sim not found: ${simId}`);
  }

  const systemPrompt = buildPrompt(simId, 'calm-mentor');

  return `You are a QA reviewer testing whether a narrator follows its behavioral rules.

Below is the system prompt that governs a simulation narrator, and a scripted player message. Evaluate whether the narrator would comply with its rules when responding to this player message.

## System Prompt (abbreviated, key rules)

The narrator must:
- Never use emojis
- Never break the fourth wall (no "game", "simulation", "skill", "agent", "scenario")
- Use AWS console/CLI formatting when player queries a service
- Not give hints in the first response
- Maintain flat-affect, short-declarative voice
- Not reveal fix criteria before resolution

## Full System Prompt

${systemPrompt.slice(0, 8000)}

## Scripted Player Message

"Show me the CloudWatch logs for the past hour"

## Dimensions to validate

1. no_emojis: Response should contain zero emoji characters
2. no_fourth_wall: No mentions of "game", "simulation", "skill", "agent", "scenario"
3. console_format: When player queries a service, response uses AWS console/CLI formatting
4. no_premature_hints: First message does not contain hints about the root cause
5. voice_consistency: Matches flat-affect, short-declarative style
6. no_fix_criteria_leak: Does not reveal fix criteria before resolution

## Response Format

Return ONLY a JSON block:
\`\`\`json
{
  "pass": true,
  "findings": [
    { "dimension": "no_emojis", "pass": true, "detail": "explanation" },
    { "dimension": "no_fourth_wall", "pass": true, "detail": "explanation" },
    { "dimension": "console_format", "pass": true, "detail": "explanation" },
    { "dimension": "no_premature_hints", "pass": true, "detail": "explanation" },
    { "dimension": "voice_consistency", "pass": true, "detail": "explanation" },
    { "dimension": "no_fix_criteria_leak", "pass": true, "detail": "explanation" }
  ]
}
\`\`\`

Set "pass" at the top level to false if ANY dimension fails.`;
}

/**
 * Run narrator rule compliance check.
 * @param {string} simId
 * @returns {Promise<{ pass: boolean, findings: Array, usage: object|null, error: string|null }>}
 */
async function runNarratorRulesCheck(simId) {
  const { runAgentCheck } = require('./agent-test-runner');
  const prompt = buildNarratorRulesPrompt(simId);
  return runAgentCheck({ prompt });
}

module.exports = { buildNarratorRulesPrompt, runNarratorRulesCheck };
