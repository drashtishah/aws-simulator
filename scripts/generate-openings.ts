import { query } from '@anthropic-ai/claude-agent-sdk';
import fs from 'node:fs';
import path from 'node:path';
import { MODEL_CONFIG, type EffortLevel } from './model-config';

const ROOT = path.resolve(__dirname, '..');
const SIMS_DIR = path.join(ROOT, 'sims');
const REGISTRY = path.join(SIMS_DIR, 'registry.json');

const MODEL = 'claude-sonnet-4-6';
const EFFORT: EffortLevel = 'medium';

const SYSTEM_PROMPT = `You write the opening beat of an AWS incident simulation. The opening renders to the player instantly when they start a sim, before any agent turn. It sets the scene.

First turn specifically:
- Open the incident in four to eight short lines. Name the company, the time, the symptom on the dashboard or in the pager. One pressure beat (tickets, stakeholder, deadline). Introduce at most one other character. Hand the floor to the player with a concrete prompt.
- Do not emit [SESSION_COMPLETE].

What the opening can contain (symptoms, not causes):
- Company name, industry, time of day, the user-visible failure.
- What the pager, dashboard, support queue, or stakeholders are reporting.
- Pressure beats: deadlines, people waiting, tickets piling up.
- The name of the instance, service, or endpoint that appears to be failing.

What the opening MUST NOT contain (these are the player's to discover):
- What changed, who changed it, or when it changed. No hardening sprints, no deployments, no junior engineers, no accidental deletions.
- Which rule, setting, policy, permission, or config is wrong.
- The name of the service or layer that is actually at fault if different from the surface symptom.
- Any content from resolution.md, manifest.resolution.*, or progressive_clues.
- The fix, the SOP step, or the related failure modes.

Style:
- Short declarative sentences. Concrete details, timestamps, instance names, dashboard readings.
- Never mention simulation, game, product, assistant, or yourself as an agent.
- No emojis. Use commas, periods, or colons instead of '--' as punctuation. Backticks only for file paths and code.

Output only the opener prose. No preamble, no markdown fences, no headings.`;

interface RegistryEntry {
  id: string;
}

interface Registry {
  sims: RegistryEntry[];
}

async function generateOpener(simId: string): Promise<string> {
  const manifestPath = path.join(SIMS_DIR, simId, 'manifest.json');
  const storyPath = path.join(SIMS_DIR, simId, 'story.md');
  const manifest = fs.readFileSync(manifestPath, 'utf8');
  const story = fs.readFileSync(storyPath, 'utf8');

  const userPrompt = `Manifest:\n${manifest}\n\nStory:\n${story}\n\nOutput a 4-8 line opener. Prose only. No preamble.`;

  const iterator = query({
    prompt: userPrompt,
    options: {
      model: MODEL,
      permissionMode: 'bypassPermissions',
      maxTurns: 3,
      systemPrompt: SYSTEM_PROMPT,
      effort: EFFORT,
    } as Parameters<typeof query>[0]['options'],
  });

  let text = '';
  for await (const msg of iterator) {
    const m = msg as { type: string; message?: { content?: { type: string; text?: string }[] } };
    if (m.type === 'assistant' && m.message) {
      for (const block of m.message.content ?? []) {
        if (block.type === 'text') text += block.text ?? '';
      }
    }
  }
  return text.trim() + '\n';
}

async function main(): Promise<void> {
  const registry = JSON.parse(fs.readFileSync(REGISTRY, 'utf8')) as Registry;

  for (const { id } of registry.sims) {
    const outPath = path.join(SIMS_DIR, id, 'opening.md');
    if (fs.existsSync(outPath)) {
      console.log(`skip  ${id}: opening.md exists`);
      continue;
    }
    try {
      const opener = await generateOpener(id);
      fs.writeFileSync(outPath, opener);
      const lineCount = opener.split('\n').filter(Boolean).length;
      console.log(`write ${id}: ${lineCount} lines`);
    } catch (err) {
      console.error(`fail  ${id}: ${(err as Error).message}`);
      process.exitCode = 1;
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
