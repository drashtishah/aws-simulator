const fs = require('fs');
const path = require('path');
const paths = require('./paths');

/**
 * Build a fully populated system prompt for a simulation.
 * Replicates SKILL.md Steps 5-7: load sim package, read template, populate.
 */
function buildPrompt(simId, themeId) {
  // 1. Read the template from agent-prompts.md (between triple-backtick fences)
  const templatePath = paths.AGENT_PROMPTS;
  const templateFile = fs.readFileSync(templatePath, 'utf8');
  const fenceMatch = templateFile.match(/```\n([\s\S]*?)\n```/);
  if (!fenceMatch) {
    throw new Error('Could not extract template from agent-prompts.md');
  }
  let prompt = fenceMatch[1];

  // 2. Read manifest
  const manifestPath = paths.manifest(simId);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Sim "${simId}" not found: ${manifestPath}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  // 3. Read story.md
  const storyPath = paths.story(simId);
  const story = fs.readFileSync(storyPath, 'utf8');

  // 4. Read artifact files
  const artifactsDir = paths.simDir(simId);
  const contextTxt = readArtifact(artifactsDir, 'artifacts/context.txt');
  const archHint = readArtifact(artifactsDir, 'artifacts/architecture-hint.txt');
  const archResolution = readArtifact(artifactsDir, 'artifacts/architecture-resolution.txt');

  // 5. Read theme files
  const basePath = paths.THEME_BASE;
  if (!fs.existsSync(basePath)) {
    throw new Error('themes/_base.md not found');
  }
  const baseContent = stripFrontmatter(fs.readFileSync(basePath, 'utf8'));

  const themePath = paths.theme(themeId);
  if (!fs.existsSync(themePath)) {
    throw new Error(`Theme "${themeId}" not found: ${themePath}`);
  }
  const themeContent = stripFrontmatter(fs.readFileSync(themePath, 'utf8'));

  // 6. Perform substitutions

  // Narrator personality
  prompt = prompt.replace(
    '{narrator.personality}',
    JSON.stringify(manifest.team.narrator.personality)
  );

  // Company fields
  prompt = prompt.replace('{company.name}', manifest.company.name);
  prompt = prompt.replace('{company.industry}', manifest.company.industry);
  prompt = prompt.replace('{company.size}', manifest.company.size);

  // Story
  prompt = prompt.replace('{story.md contents -- full file including Opening, story beats, and Resolution}', story);

  // Artifacts
  prompt = prompt.replace('{artifacts/context.txt contents}', contextTxt);
  prompt = prompt.replace('{artifacts/architecture-hint.txt contents}', archHint);
  prompt = prompt.replace('{artifacts/architecture-resolution.txt contents}', archResolution);

  // Fix criteria loop
  const fixCriteriaBlock = manifest.resolution.fix_criteria.map(c => {
    const reqLabel = c.required ? 'required' : 'optional';
    return `- [${reqLabel}] ${c.id}: ${c.description}`;
  }).join('\n');
  prompt = prompt.replace(
    /\{For each fix_criteria in manifest\.resolution\.fix_criteria:\}\n[\s\S]*?\{End for\}/,
    fixCriteriaBlock
  );

  // Hints loop
  const hintsBlock = manifest.team.narrator.hints.map((h, i) => {
    const text = h.hint || h.text || '';
    const services = (h.relevant_services || []).join(', ');
    const skip = (h.skip_if_queried || []).join(', ');
    return `${i + 1}. ${text} [services: ${services}] [skip if queried: ${skip}]`;
  }).join('\n');
  prompt = prompt.replace(
    /\{For each hint in manifest\.team\.narrator\.hints:\}\n[\s\S]*?\{End for\}/,
    hintsBlock
  );

  // Max hints
  prompt = prompt.replace(
    '{narrator.max_hints_before_nudge}',
    String(manifest.team.narrator.max_hints_before_nudge)
  );
  // Second occurrence
  prompt = prompt.replace(
    '{narrator.max_hints_before_nudge}',
    String(manifest.team.narrator.max_hints_before_nudge)
  );

  // Story beats loop
  const beatsBlock = manifest.team.narrator.story_beats.map(b => {
    if (b.section) {
      return `- Trigger: ${b.trigger} --> Deliver the ${b.section} section`;
    }
    if (b.facts) {
      return `- Trigger: ${b.trigger} --> ${b.facts.join('; ')}`;
    }
    return `- Trigger: ${b.trigger} --> ${b.message || ''}`;
  }).join('\n');
  prompt = prompt.replace(
    /\{For each beat in manifest\.team\.narrator\.story_beats:\}\n[\s\S]*?\{End for\}/,
    beatsBlock
  );

  // Narrative arc
  const arc = manifest.team.narrator.narrative_arc;
  if (arc) {
    prompt = prompt.replace('{narrative_arc.call}', arc.call || '');
    prompt = prompt.replace('{narrative_arc.threshold}', arc.threshold || '');
    prompt = prompt.replace('{narrative_arc.trials}', arc.trials || '');
    prompt = prompt.replace('{narrative_arc.revelation}', arc.revelation || '');
    prompt = prompt.replace('{narrative_arc.return}', arc.return || '');
  }

  // Theme base and voice
  prompt = prompt.replace('{theme.base}', baseContent);
  prompt = prompt.replace('{theme.voice}', themeContent);

  // Glossary loop
  const glossary = manifest.team.narrator.glossary || {};
  const glossaryBlock = Object.entries(glossary).map(([term, def]) => {
    return `- **${term}**: ${def}`;
  }).join('\n');
  prompt = prompt.replace(
    /\{For each term, definition in narrator\.glossary:\}\n[\s\S]*?\{End for\}/,
    glossaryBlock
  );

  // System narration
  const sysNarr = manifest.team.narrator.system_narration;
  if (sysNarr) {
    prompt = prompt.replace('{system_narration.data_flow}', sysNarr.data_flow || '');

    const componentsBlock = (sysNarr.components || []).map(c => {
      const connections = (c.connections || []).join(', ');
      return `### ${c.name}\nRole: ${c.role}\nConnects to: ${connections}\nIf this breaks: ${c.failure_impact}`;
    }).join('\n\n');
    prompt = prompt.replace(
      /\{For each component in system_narration\.components:\}\n[\s\S]*?\{End for\}/,
      componentsBlock
    );

    prompt = prompt.replace('{system_narration.what_broke}', sysNarr.what_broke || '');
  }

  // Console data expansion
  const consoles = manifest.team.consoles || [];
  const consolesBlock = consoles.map(c => {
    const caps = (c.capabilities || []).map(cap => `- ${cap}`).join('\n');
    const artifacts = (c.artifacts || []).map(artPath => {
      const content = readArtifact(artifactsDir, artPath);
      return `--- ${artPath} ---\n${content}\n--- end ---`;
    }).join('\n\n');
    return `### ${c.service} Console\n\nCapabilities:\n${caps}\n\n${artifacts}`;
  }).join('\n\n');
  prompt = prompt.replace(
    /\{For each console in manifest\.team\.consoles:\}\n[\s\S]*?\{End for\}/,
    consolesBlock
  );

  // Sim ID
  prompt = prompt.replace(/\{sim_id\}/g, manifest.id);

  // 7. Append web-specific behavioral instructions
  prompt += `\n\n## Web Session Rules
- Auto-save session state after every significant interaction to learning/sessions/${manifest.id}/session.json
- When switching to Console Mode, prefix your response with [CONSOLE_START] and end with [CONSOLE_END]
- When delivering coaching analysis, prefix with [COACHING_START] and end with [COACHING_END]
- When coaching analysis is delivered, output [SESSION_COMPLETE] as the final line. Do NOT update profile.json, catalog.csv, or vault files. The server handles post-session updates separately.
- Do not use Markdown headers in responses (use bold text and line breaks instead)`;

  // Validate: check for unresolved placeholders
  const unresolved = prompt.match(/\{[a-z_]+\.[a-z_]+\}/g);
  if (unresolved) {
    const unique = [...new Set(unresolved)];
    console.warn(`PROMPT_PLACEHOLDER_UNRESOLVED: ${unique.join(', ')}`);
  }

  return prompt;
}

function readArtifact(simDir, relativePath) {
  const fullPath = path.join(simDir, relativePath);
  try {
    return fs.readFileSync(fullPath, 'utf8');
  } catch {
    console.warn(`ARTIFACT_MISSING: ${fullPath}`);
    return `[Missing artifact: ${relativePath}]`;
  }
}

function stripFrontmatter(content) {
  const match = content.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
  return match ? match[1].trim() : content.trim();
}

module.exports = { buildPrompt };
