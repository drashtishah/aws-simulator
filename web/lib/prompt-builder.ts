import fs from 'node:fs';
import path from 'node:path';
import * as paths from './paths.js';

export function buildPrompt(simId: string, themeId: string): string {
  const template = fs.readFileSync(paths.AGENT_PROMPTS, 'utf8');

  const match = template.match(/## Template\s*\n\s*```\n([\s\S]*?)\n```/);
  if (!match) throw new Error('agent-prompts.md missing Template fenced block');
  let body = match[1]!;

  const manifestPath = paths.manifest(simId);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Sim "${simId}" not found: ${manifestPath}`);
  }
  const manifest = fs.readFileSync(manifestPath, 'utf8');

  const story = fs.readFileSync(paths.story(simId), 'utf8');

  const resolutionPath = path.join(paths.simDir(simId), 'resolution.md');
  const resolution = fs.existsSync(resolutionPath) ? fs.readFileSync(resolutionPath, 'utf8') : '';

  const artifactsDir = path.join(paths.simDir(simId), 'artifacts');
  const artifactFiles = fs.existsSync(artifactsDir)
    ? fs.readdirSync(artifactsDir).sort()
    : [];
  const artifacts = artifactFiles.map(f => {
    const content = fs.readFileSync(path.join(artifactsDir, f), 'utf8');
    return `### artifacts/${f}\n\n${content}`;
  }).join('\n\n');

  // Block placeholders first; they contain literal {sim_id} that must not be
  // pre-substituted by the global replace below.
  body = body
    .replace('{sims/{sim_id}/manifest.json contents}', manifest)
    .replace('{sims/{sim_id}/story.md contents}', story)
    .replace('{sims/{sim_id}/resolution.md contents}', resolution);

  body = body.replace(
    /\{For each file path in sims\/\{sim_id\}\/artifacts\/:\}[\s\S]*?\{End for\}/,
    artifacts
  );

  body = body
    .replace(/\{sim_id\}/g, simId)
    .replace(/\{theme_id\}/g, themeId);

  return body;
}
