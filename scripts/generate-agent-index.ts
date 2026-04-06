#!/usr/bin/env node
// Generates references/agent-index.md from workspace metadata.
// Sources: SKILL.md frontmatter, settings.local.json hooks, guard-write.js lists.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const SKILLS_DIR = path.join(ROOT, '.claude', 'skills');
const SETTINGS_PATH = path.join(ROOT, '.claude', 'settings.local.json');
const GUARD_PATH = path.join(ROOT, '.claude', 'hooks', 'guard-write.js');
const OUTPUT_PATH = path.join(ROOT, 'references', 'agent-index.md');

interface SkillEntry {
  name: string;
  trigger: string;
  path: string;
  description: string;
}

interface HookEntry {
  file: string;
  event: string;
  matcher: string;
  purpose: string;
}

interface ProtectedFile {
  path: string;
  type: 'file' | 'directory';
}

interface HookConfig {
  command?: string;
}

interface HookMatcher {
  matcher?: string;
  hooks?: HookConfig[];
}

interface Settings {
  hooks?: Record<string, HookMatcher[]>;
}

const PURPOSE_MAP: Record<string, string> = {
  'guard-write': 'Block writes to protected files and directories',
  'git-discipline-reminder': 'Remind about git workflow before edits',
  'pre-commit-issues': 'Require GitHub Issue before commits',
  'pre-commit-self-audit': 'Self-audit checklist before commits',
  'log-hook': 'Log tool call events to activity.jsonl',
  'plan-exit-reminder': 'Remind about next steps after plan mode'
} as const;

// --- Parse SKILL.md frontmatter ---

function parseSkills(): SkillEntry[] {
  const skillDirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d: fs.Dirent) => d.isDirectory())
    .map((d: fs.Dirent) => d.name)
    .sort();

  const skills: SkillEntry[] = [];
  for (const dir of skillDirs) {
    const skillPath = path.join(SKILLS_DIR, dir, 'SKILL.md');
    if (!fs.existsSync(skillPath)) continue;
    const content = fs.readFileSync(skillPath, 'utf8');
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) continue;

    const fm = match[1]!;
    const name = extractYamlValue(fm, 'name') || dir;
    const desc = extractYamlValue(fm, 'description') || '';
    // Take first sentence for brevity
    const shortDesc = (desc.split(/\.\s/)[0] ?? '').replace(/\s+/g, ' ').trim();
    skills.push({
      name,
      trigger: `/${name}`,
      path: `.claude/skills/${dir}/SKILL.md`,
      description: shortDesc
    });
  }
  return skills;
}

function extractYamlValue(yaml: string, key: string): string | null {
  // Handle multi-line (>) and single-line values
  const multiMatch = yaml.match(new RegExp(`^${key}:\\s*>\\s*\\n([\\s\\S]*?)(?=\\n\\w|$)`, 'm'));
  if (multiMatch) {
    return multiMatch[1]!.replace(/\n\s*/g, ' ').trim();
  }
  const singleMatch = yaml.match(new RegExp(`^${key}:\\s*(.+)`, 'm'));
  if (singleMatch) {
    return singleMatch[1]!.replace(/^["']|["']$/g, '').trim();
  }
  return null;
}

// --- Parse hooks from settings.local.json ---

function parseHooks(): HookEntry[] {
  const settings: Settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  const hooks = settings.hooks || {};
  const seen = new Set<string>();
  const rows: HookEntry[] = [];

  for (const [event, entries] of Object.entries(hooks)) {
    for (const entry of entries) {
      const matcher = entry.matcher || '(all)';
      const hookList = entry.hooks || [];
      for (const hook of hookList) {
        const cmd = hook.command || '';
        // Extract script path from command
        const scriptMatch = cmd.match(/node\s+(.+?)$/);
        if (!scriptMatch) continue;
        const scriptPath = scriptMatch[1]!.trim();
        const key = `${scriptPath}|${event}|${matcher}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const basename = path.basename(scriptPath, '.js');
        const purpose = inferPurpose(basename);
        rows.push({ file: scriptPath, event, matcher, purpose });
      }
    }
  }
  return rows;
}

function inferPurpose(basename: string): string {
  return PURPOSE_MAP[basename] || basename.replace(/-/g, ' ');
}

// --- Parse guard-write.js for protected files ---

function parseGuardWrite(): ProtectedFile[] {
  const content = fs.readFileSync(GUARD_PATH, 'utf8');

  const filesMatch = content.match(/NEVER_WRITABLE\s*=\s*\[([\s\S]*?)\]/);
  const dirsMatch = content.match(/NEVER_WRITABLE_DIRS\s*=\s*\[([\s\S]*?)\]/);

  const files: ProtectedFile[] = [];
  if (filesMatch) {
    const entries = filesMatch[1]!.match(/'([^']+)'/g) ?? [];
    for (const e of entries) {
      files.push({ path: e.replace(/'/g, ''), type: 'file' });
    }
  }
  if (dirsMatch) {
    const entries = dirsMatch[1]!.match(/'([^']+)'/g) ?? [];
    for (const e of entries) {
      files.push({ path: `${e.replace(/'/g, '')}/`, type: 'directory' });
    }
  }
  return files;
}

// --- Generate output ---

function generate(): void {
  const skills = parseSkills();
  const hooks = parseHooks();
  const protectedFiles = parseGuardWrite();

  const lines: string[] = [];
  lines.push('# Agent Index');
  lines.push('');
  lines.push('Quick-reference for navigating this workspace. See `references/workspace-map.md` for full architecture.');
  lines.push('');
  lines.push('## Skills');
  lines.push('');
  lines.push('| Skill | Trigger | SKILL.md |');
  lines.push('|-------|---------|----------|');
  for (const s of skills) {
    lines.push(`| ${s.name} | ${s.trigger} | \`${s.path}\` |`);
  }

  lines.push('');
  lines.push('## Hooks');
  lines.push('');
  lines.push('| Hook File | Event | Matcher | Purpose |');
  lines.push('|-----------|-------|---------|---------|');
  for (const h of hooks) {
    lines.push(`| \`${h.file}\` | ${h.event} | ${h.matcher} | ${h.purpose} |`);
  }

  lines.push('');
  lines.push('## Key References');
  lines.push('');
  lines.push('| Document | Purpose |');
  lines.push('|----------|---------|');
  lines.push('| `references/workspace-map.md` | Workspace architecture |');
  lines.push('| `references/progression.yaml` | Rank and scoring config |');
  lines.push('| `references/testing-system.md` | Testing system reference |');

  lines.push('');
  lines.push('## Data Files');
  lines.push('');
  lines.push('| File | Protected? |');
  lines.push('|------|------------|');
  for (const f of protectedFiles) {
    const label = f.type === 'directory' ? 'Yes (entire directory)' : 'Yes';
    lines.push(`| \`${f.path}\` | ${label} |`);
  }

  lines.push('');
  lines.push('## Tests');
  lines.push('');
  lines.push('| Command | Layer | Description |');
  lines.push('|---------|-------|-------------|');
  lines.push('| `npm test` | 1 | Deterministic unit tests |');
  lines.push('| `npm run test:agent` | 2 | Agent browser specs |');
  lines.push('| `npm run test:personas` | 3 | Persona integration |');
  lines.push('| `npm run test:evals` | 4 | Eval scorecard |');

  lines.push('');

  const output = lines.join('\n');
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, output, 'utf8');

  const lineCount = output.split('\n').length;
  console.log(`Generated ${OUTPUT_PATH} (${lineCount} lines)`);
  if (lineCount > 150) {
    console.warn(`Warning: output exceeds 150 lines (${lineCount})`);
  }
}

generate();
