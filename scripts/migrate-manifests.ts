import fs from 'node:fs';
import path from 'node:path';

const SIMS_DIR = path.resolve(__dirname, '..', 'sims');

const dirs = fs.readdirSync(SIMS_DIR, { withFileTypes: true })
  .filter(e => e.isDirectory() && /^\d{3}-/.test(e.name))
  .map(e => e.name);

for (const id of dirs) {
  const p = path.join(SIMS_DIR, id, 'manifest.json');
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));

  // Hoist from team.narrator
  const narrator = raw.team?.narrator ?? {};
  raw.glossary = narrator.glossary ?? {};
  raw.system = narrator.system_narration ?? {};

  // Preserve hint text, drop delivery mechanic
  raw.progressive_clues = (narrator.hints ?? []).map((h: { hint: string }) => h.hint);

  // Hoist consoles, preserve capabilities
  raw.consoles = (raw.team?.consoles ?? []).map((c: Record<string, unknown>) => ({
    service: c.service,
    artifacts: c.artifacts,
    capabilities: c.capabilities
  }));

  // Delete
  delete raw.team;

  fs.writeFileSync(p, JSON.stringify(raw, null, 2) + '\n');
  console.log('migrated', id);
}
