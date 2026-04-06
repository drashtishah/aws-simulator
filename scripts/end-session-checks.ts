import fs from 'node:fs';
import path from 'node:path';
import { buildPrompt } from '../web/lib/prompt-builder';

import type { AgentCheckResult } from './agent-test-runner';

const ROOT = path.resolve(__dirname, '..');

/**
 * Build an end-of-session compliance prompt for a sim.
 * Verifies the narrator does not offer another simulation after resolution.
 */
function buildEndSessionPrompt(simId: string): string {
  const manifestPath = path.join(ROOT, 'sims', simId, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Sim not found: ${simId}`);
  }

  const systemPrompt = buildPrompt(simId, 'calm-mentor');

  // Extract end-of-session rules from the system prompt
  const rules: string[] = [];
  if (systemPrompt.includes('Do not offer another simulation')) {
    rules.push('Rule found: "Do not offer another simulation"');
  }
  if (systemPrompt.includes('[SESSION_COMPLETE]')) {
    rules.push('Rule found: "[SESSION_COMPLETE]" marker required');
  }

  return `You are a QA reviewer testing end-of-session compliance for an AWS incident simulation narrator.

## Context

After a player resolves an incident and completes the debrief, the narrator must:
1. NOT offer to play another simulation
2. End with [SESSION_COMPLETE]
3. Not add substantive content after [SESSION_COMPLETE]

## Rules Found in System Prompt

${rules.join('\n')}

## System Prompt (end-of-session sections)

${systemPrompt.slice(-3000)}

## Dimensions to validate

1. no_play_another: System prompt contains rules prohibiting "ready for another?", "shall we try?", "would you like to play another?", or any variation
2. session_complete_present: System prompt requires [SESSION_COMPLETE] as final output marker
3. no_post_complete: System prompt instructs narrator to not continue conversation after [SESSION_COMPLETE]

## Response Format

Return ONLY a JSON block:
\`\`\`json
{
  "pass": true,
  "findings": [
    { "dimension": "no_play_another", "pass": true, "detail": "explanation" },
    { "dimension": "session_complete_present", "pass": true, "detail": "explanation" },
    { "dimension": "no_post_complete", "pass": true, "detail": "explanation" }
  ]
}
\`\`\`

Set "pass" at the top level to false if ANY dimension fails.`;
}

/**
 * Run end-of-session compliance check.
 */
async function runEndSessionCheck(simId: string): Promise<AgentCheckResult> {
  const { runAgentCheck } = await import('./agent-test-runner');
  const prompt = buildEndSessionPrompt(simId);
  return runAgentCheck({ prompt });
}

export { buildEndSessionPrompt, runEndSessionCheck };
