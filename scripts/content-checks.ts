import fs from 'node:fs';
import path from 'node:path';

import type { AgentCheckResult } from './agent-test-runner';

const ROOT = path.resolve(__dirname, '..');
const SIMS_DIR = path.join(ROOT, 'sims');
const REGISTRY_PATH = path.join(SIMS_DIR, 'registry.json');

interface RegistryEntry {
  id: string;
  [key: string]: unknown;
}

interface Registry {
  sims: RegistryEntry[];
}

/**
 * Build a validation prompt for a specific sim.
 * Reads manifest, story, resolution, artifacts, and registry entry.
 * Returns a prompt string for the agent to evaluate.
 */
function buildContentPrompt(simId: string): string {
  const simDir = path.join(SIMS_DIR, simId);
  if (!fs.existsSync(simDir)) {
    throw new Error(`Sim not found: ${simId}`);
  }

  const manifestPath = path.join(simDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found for sim: ${simId}`);
  }

  // Read all sim files
  const manifest = fs.readFileSync(manifestPath, 'utf8');
  const story = fs.existsSync(path.join(simDir, 'story.md'))
    ? fs.readFileSync(path.join(simDir, 'story.md'), 'utf8')
    : '(no story.md)';
  const resolution = fs.existsSync(path.join(simDir, 'resolution.md'))
    ? fs.readFileSync(path.join(simDir, 'resolution.md'), 'utf8')
    : '(no resolution.md)';

  // Read artifacts
  const artifactsDir = path.join(simDir, 'artifacts');
  let artifactsText = '';
  if (fs.existsSync(artifactsDir)) {
    const files = fs.readdirSync(artifactsDir).sort();
    for (const file of files) {
      const filePath = path.join(artifactsDir, file);
      const stat = fs.statSync(filePath);
      if (stat.isFile() && stat.size < 50000) {
        const content = fs.readFileSync(filePath, 'utf8');
        artifactsText += `\n### ${file}\n\`\`\`\n${content}\n\`\`\`\n`;
      } else if (stat.isFile()) {
        artifactsText += `\n### ${file}\n(file too large, ${stat.size} bytes)\n`;
      }
    }
  }
  if (!artifactsText) artifactsText = '(no artifacts)';

  // Read registry entry
  const registry: Registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  const registryEntry = registry.sims.find((s: RegistryEntry) => s.id === simId);
  const registryText = registryEntry
    ? JSON.stringify(registryEntry, null, 2)
    : '(not found in registry)';

  return `You are a QA reviewer for AWS incident simulation packages.

Below is the complete content of simulation "${simId}". Review it and validate each dimension listed below. Return a JSON object with your findings.

## Dimensions to validate

1. summary: Does the summary in the registry and manifest accurately describe what happens in the story? Check for factual errors (wrong time of day, wrong service, wrong symptom, wrong behavior).
2. title: Does the title fit the narrative arc and incident type?
3. difficulty: Given the number of services involved, complexity of the root cause, and investigation depth required, does the difficulty rating (1-5) seem appropriate? (1=single service/obvious fix, 5=multi-service/deep investigation)
4. services: Do the listed services match what actually appears in the artifacts and story? Are any missing or extraneous?
5. tags: Are the tags relevant to the actual incident mechanism?
6. category: Does the category (networking, performance, security, etc.) match the primary failure domain?
7. learning_objectives: Do they match what the sim actually teaches based on the resolution and SOP steps?

## Registry Entry

\`\`\`json
${registryText}
\`\`\`

## manifest.json

\`\`\`json
${manifest}
\`\`\`

## story.md

${story}

## resolution.md

${resolution}

## Artifacts

${artifactsText}

## Response Format

Return ONLY a JSON block (no other text):
\`\`\`json
{
  "pass": true,
  "findings": [
    { "dimension": "summary", "pass": true, "detail": "explanation" },
    { "dimension": "title", "pass": true, "detail": "explanation" },
    { "dimension": "difficulty", "pass": true, "detail": "explanation" },
    { "dimension": "services", "pass": true, "detail": "explanation" },
    { "dimension": "tags", "pass": true, "detail": "explanation" },
    { "dimension": "category", "pass": true, "detail": "explanation" },
    { "dimension": "learning_objectives", "pass": true, "detail": "explanation" }
  ]
}
\`\`\`

Set "pass" at the top level to false if ANY dimension fails. Include all 7 dimensions even if they pass.`;
}

/**
 * Run a content validation check on a sim.
 * Calls the agent test runner with the built prompt.
 */
async function runContentCheck(simId: string): Promise<AgentCheckResult> {
  const { runAgentCheck } = await import('./agent-test-runner');
  const prompt = buildContentPrompt(simId);
  return runAgentCheck({ prompt });
}

export { buildContentPrompt, runContentCheck };
