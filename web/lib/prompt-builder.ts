import fs from 'node:fs';
import path from 'node:path';
import * as paths from './paths.js';
import { stripFrontmatter } from './frontmatter.js';

interface Narrator {
  personality: string;
  hints: Array<{ hint?: string; text?: string; relevant_services?: string[]; skip_if_queried?: string[] }>;
  max_hints_before_nudge: number;
  story_beats: Array<{ trigger: string; section?: string; facts?: string[]; message?: string }>;
  narrative_arc?: { call?: string; threshold?: string; trials?: string; revelation?: string; return?: string };
  glossary?: Record<string, string>;
  system_narration?: {
    data_flow?: string;
    components?: Array<{ name: string; role: string; connections?: string[]; failure_impact: string }>;
    what_broke?: string;
  };
}

interface Console {
  service: string;
  capabilities?: string[];
  artifacts?: string[];
}

interface Manifest {
  id: string;
  company: { name: string; industry: string; size: string };
  team: { narrator: Narrator; consoles?: Console[] };
  resolution: { fix_criteria: Array<{ required: boolean; id: string; description: string }> };
  services?: Array<{ id: string }>;
}

function buildPrompt(simId: string, themeId: string): string {
  const templatePath = paths.AGENT_PROMPTS;
  const templateFile = fs.readFileSync(templatePath, 'utf8');
  const fenceMatch = templateFile.match(/```\n([\s\S]*?)\n```/);
  if (!fenceMatch) {
    throw new Error('Could not extract template from agent-prompts.md');
  }
  let prompt = fenceMatch[1]!;

  const manifestPath = paths.manifest(simId);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Sim "${simId}" not found: ${manifestPath}`);
  }
  const manifest: Manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const storyPath = paths.story(simId);
  const story = fs.readFileSync(storyPath, 'utf8');

  const artifactsDir = paths.simDir(simId);
  const contextTxt = readArtifact(artifactsDir, 'artifacts/context.txt');
  const archHint = readArtifact(artifactsDir, 'artifacts/architecture-hint.txt');
  const archResolution = readArtifact(artifactsDir, 'artifacts/architecture-resolution.txt');

  const basePath = paths.THEME_BASE;
  if (!fs.existsSync(basePath)) {
    throw new Error('themes/_base.md not found');
  }
  const { body: baseContent } = stripFrontmatter(fs.readFileSync(basePath, 'utf8'));

  const themePath = paths.theme(themeId);
  if (!fs.existsSync(themePath)) {
    throw new Error(`Theme "${themeId}" not found: ${themePath}`);
  }
  const { body: themeContent } = stripFrontmatter(fs.readFileSync(themePath, 'utf8'));

  prompt = prompt.replace(
    '{narrator.personality}',
    JSON.stringify(manifest.team.narrator.personality)
  );

  prompt = prompt.replace('{company.name}', manifest.company.name);
  prompt = prompt.replace('{company.industry}', manifest.company.industry);
  prompt = prompt.replace('{company.size}', manifest.company.size);

  prompt = prompt.replace('{story.md contents -- full file including Opening, story beats, and Resolution}', story);

  prompt = prompt.replace('{artifacts/context.txt contents}', contextTxt);
  prompt = prompt.replace('{artifacts/architecture-hint.txt contents}', archHint);
  prompt = prompt.replace('{artifacts/architecture-resolution.txt contents}', archResolution);

  const fixCriteriaBlock = manifest.resolution.fix_criteria.map(c => {
    const reqLabel = c.required ? 'required' : 'optional';
    return `- [${reqLabel}] ${c.id}: ${c.description}`;
  }).join('\n');
  prompt = prompt.replace(
    /\{For each fix_criteria in manifest\.resolution\.fix_criteria:\}\n[\s\S]*?\{End for\}/,
    fixCriteriaBlock
  );

  const hintsBlock = manifest.team.narrator.hints.map((h, i) => {
    const text = h.hint ?? h.text ?? '';
    const services = (h.relevant_services ?? []).join(', ');
    const skip = (h.skip_if_queried ?? []).join(', ');
    return `${i + 1}. ${text} [services: ${services}] [skip if queried: ${skip}]`;
  }).join('\n');
  prompt = prompt.replace(
    /\{For each hint in manifest\.team\.narrator\.hints:\}\n[\s\S]*?\{End for\}/,
    hintsBlock
  );

  prompt = prompt.replace(
    '{narrator.max_hints_before_nudge}',
    String(manifest.team.narrator.max_hints_before_nudge)
  );
  prompt = prompt.replace(
    '{narrator.max_hints_before_nudge}',
    String(manifest.team.narrator.max_hints_before_nudge)
  );

  const beatsBlock = manifest.team.narrator.story_beats.map(b => {
    if (b.section) {
      return `- Trigger: ${b.trigger} --> Deliver the ${b.section} section`;
    }
    if (b.facts) {
      return `- Trigger: ${b.trigger} --> ${b.facts.join('; ')}`;
    }
    return `- Trigger: ${b.trigger} --> ${b.message ?? ''}`;
  }).join('\n');
  prompt = prompt.replace(
    /\{For each beat in manifest\.team\.narrator\.story_beats:\}\n[\s\S]*?\{End for\}/,
    beatsBlock
  );

  const arc = manifest.team.narrator.narrative_arc;
  if (arc) {
    prompt = prompt.replace('{narrative_arc.call}', arc.call ?? '');
    prompt = prompt.replace('{narrative_arc.threshold}', arc.threshold ?? '');
    prompt = prompt.replace('{narrative_arc.trials}', arc.trials ?? '');
    prompt = prompt.replace('{narrative_arc.revelation}', arc.revelation ?? '');
    prompt = prompt.replace('{narrative_arc.return}', arc.return ?? '');
  }

  prompt = prompt.replace('{theme.base}', baseContent);
  prompt = prompt.replace('{theme.voice}', themeContent);

  const glossary = manifest.team.narrator.glossary ?? {};
  const glossaryBlock = Object.entries(glossary).map(([term, def]) => {
    return `- **${term}**: ${def}`;
  }).join('\n');
  prompt = prompt.replace(
    /\{For each term, definition in narrator\.glossary:\}\n[\s\S]*?\{End for\}/,
    glossaryBlock
  );

  const sysNarr = manifest.team.narrator.system_narration;
  if (sysNarr) {
    prompt = prompt.replace('{system_narration.data_flow}', sysNarr.data_flow ?? '');

    const componentsBlock = (sysNarr.components ?? []).map(c => {
      const connections = (c.connections ?? []).join(', ');
      return `### ${c.name}\nRole: ${c.role}\nConnects to: ${connections}\nIf this breaks: ${c.failure_impact}`;
    }).join('\n\n');
    prompt = prompt.replace(
      /\{For each component in system_narration\.components:\}\n[\s\S]*?\{End for\}/,
      componentsBlock
    );

    prompt = prompt.replace('{system_narration.what_broke}', sysNarr.what_broke ?? '');
  }

  const consoles = manifest.team.consoles ?? [];
  const consolesBlock = consoles.map(c => {
    const caps = (c.capabilities ?? []).map(cap => `- ${cap}`).join('\n');
    const artifacts = (c.artifacts ?? []).map(artPath => {
      const content = readArtifact(artifactsDir, artPath);
      return `--- ${artPath} ---\n${content}\n--- end ---`;
    }).join('\n\n');
    return `### ${c.service} Console\n\nCapabilities:\n${caps}\n\n${artifacts}`;
  }).join('\n\n');
  prompt = prompt.replace(
    /\{For each console in manifest\.team\.consoles:\}\n[\s\S]*?\{End for\}/,
    consolesBlock
  );

  prompt = prompt.replace(/\{sim_id\}/g, manifest.id);

  prompt += `\n\n## Web Session Rules
- Auto-save session state after every significant interaction to learning/sessions/${manifest.id}/session.json
- When switching to Console Mode, prefix your response with [CONSOLE_START] and end with [CONSOLE_END]
- When delivering coaching analysis, prefix with [COACHING_START] and end with [COACHING_END]
- When coaching analysis is delivered, output [SESSION_COMPLETE] as the final line. Do NOT update profile.json, catalog.csv, or vault files. The server handles post-session updates separately.
- After delivering coaching analysis and [SESSION_COMPLETE], do not continue the conversation. Do not offer another simulation. The server handles session completion.
- Do not use Markdown headers in responses (use bold text and line breaks instead)`;

  prompt += buildPlayerContext(manifest);

  const unresolved = prompt.match(/\{[a-z_]+\.[a-z_]+\}/g);
  if (unresolved) {
    const unique = [...new Set(unresolved)];
    console.warn(`PROMPT_PLACEHOLDER_UNRESOLVED: ${unique.join(', ')}`);
  }

  return prompt;
}

function buildPlayerContext(manifest: Manifest): string {
  try {
    const profilePath = paths.PROFILE;
    if (!fs.existsSync(profilePath)) return '';

    const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8')) as Record<string, unknown>;
    const sections: string[] = [];

    sections.push('## Player Context');
    sections.push(`Rank: ${(profile.rank_title as string) ?? 'unranked'} | Sessions: ${(profile.total_sessions as number) ?? 0}`);

    if (profile.skill_polygon) {
      const poly = profile.skill_polygon as Record<string, number>;
      sections.push(`Skill polygon: gather=${poly.gather ?? 0}, diagnose=${poly.diagnose ?? 0}, correlate=${poly.correlate ?? 0}, impact=${poly.impact ?? 0}, trace=${poly.trace ?? 0}, fix=${poly.fix ?? 0}`);
    }

    if (profile.question_quality) {
      const qq = profile.question_quality as Record<string, number>;
      sections.push(`Question quality (running avg): overall=${qq.overall ?? 0}, specificity=${qq.specificity ?? 0}, relevance=${qq.relevance ?? 0}`);
    }

    const behavioralPath = path.join(paths.ROOT, 'learning', 'vault', 'patterns', 'behavioral-profile.md');
    if (fs.existsSync(behavioralPath)) {
      const behavioral = fs.readFileSync(behavioralPath, 'utf8');
      const bodyStart = behavioral.indexOf('---', 4);
      if (bodyStart > 0) {
        const body = behavioral.slice(bodyStart + 3).trim();
        if (body.length > 0 && body.length < 2000) {
          sections.push(`\nBehavioral profile:\n${body}`);
        }
      }
    }

    if (manifest.services) {
      const catalogPath = paths.CATALOG;
      if (fs.existsSync(catalogPath)) {
        const catalog = fs.readFileSync(catalogPath, 'utf8');
        const lines = catalog.split('\n');
        const relevant: string[] = [];
        for (const service of manifest.services) {
          const row = lines.find(l => l.startsWith(service.id + ',') || l.includes(',' + service.id + ','));
          if (row) relevant.push(`  - ${service.id}: ${row}`);
        }
        if (relevant.length > 0) {
          sections.push(`\nService familiarity (this sim):\n${relevant.join('\n')}`);
        }
      }
    }

    sections.push('\nAdapt pacing accordingly: if the player has high familiarity with a service, keep console responses concise. If behavioral profile shows they tend to rush to fixes, let the investigation develop naturally without acceleration. Do not reference this data directly to the player. Do not mention rank, scores, or profile data.');

    return '\n\n' + sections.join('\n');
  } catch {
    return '';
  }
}

function readArtifact(simDir: string, relativePath: string): string {
  const fullPath = path.join(simDir, relativePath);
  try {
    return fs.readFileSync(fullPath, 'utf8');
  } catch {
    console.warn(`ARTIFACT_MISSING: ${fullPath}`);
    return `[Missing artifact: ${relativePath}]`;
  }
}

export { buildPrompt };
