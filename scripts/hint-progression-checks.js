const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/**
 * Build a hint progression validation prompt for a sim.
 * Given a sequence of unproductive player questions, verify
 * hint ordering and skip logic.
 */
function buildHintProgressionPrompt(simId) {
  const manifestPath = path.join(ROOT, 'sims', simId, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Sim not found: ${simId}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const narrator = manifest.team.narrator;
  const hints = narrator.hints || [];
  const maxHints = narrator.max_hints_before_nudge || 3;

  const hintsText = hints.map((h, i) => {
    const text = h.hint || h.text || '';
    const services = (h.relevant_services || []).join(', ');
    const skip = (h.skip_if_queried || []).join(', ');
    return `${i + 1}. "${text}" [services: ${services}] [skip_if_queried: ${skip}]`;
  }).join('\n');

  return `You are a QA reviewer validating hint progression logic for an AWS incident simulation.

## Simulation: ${simId}
## Title: ${manifest.title}
## Max hints before nudge: ${maxHints}

## Hints (ordered)

${hintsText}

## Hint Rules

1. Hints are delivered one at a time, in order
2. Hints are only offered after 2+ unproductive player questions
3. Before delivering hint N, check: if all services in hint N's skip_if_queried are already in services_queried, skip to hint N+1
4. Hints should feel like natural narrator observations, not a help menu
5. After max_hints_before_nudge hints without progress, suggest a different line of investigation

## Scripted Scenario

Player has queried no services yet. Player sends 3 unproductive questions in sequence:
1. "What happened?"
2. "Can you tell me more?"
3. "I'm not sure what to do"

## Dimensions to validate

1. no_premature_hints: First 2 unproductive questions should get no hints
2. correct_ordering: Hints should be delivered in manifest order (hint 1 first)
3. skip_logic: Hints with skip_if_queried should be skipped when those services are queried
4. natural_delivery: Hints should feel like narrator observations, not a help menu

## Response Format

Return ONLY a JSON block:
\`\`\`json
{
  "pass": true,
  "findings": [
    { "dimension": "no_premature_hints", "pass": true, "detail": "explanation" },
    { "dimension": "correct_ordering", "pass": true, "detail": "explanation" },
    { "dimension": "skip_logic", "pass": true, "detail": "explanation" },
    { "dimension": "natural_delivery", "pass": true, "detail": "explanation" }
  ]
}
\`\`\`

Set "pass" at the top level to false if ANY dimension fails.`;
}

/**
 * Run hint progression check.
 * @param {string} simId
 * @returns {Promise<{ pass: boolean, findings: Array, usage: object|null, error: string|null }>}
 */
async function runHintProgressionCheck(simId) {
  const { runAgentCheck } = require('./agent-test-runner');
  const prompt = buildHintProgressionPrompt(simId);
  return runAgentCheck({ prompt });
}

module.exports = { buildHintProgressionPrompt, runHintProgressionCheck };
