#!/usr/bin/env node
// One-time migration: reset profile, convert journal to vault session notes,
// create vault structure, zero catalog knowledge scores.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LEARNING = path.join(ROOT, 'learning');
const PROFILE = path.join(LEARNING, 'profile.json');
const JOURNAL = path.join(LEARNING, 'journal.md');
const CATALOG = path.join(LEARNING, 'catalog.csv');
const VAULT = path.join(LEARNING, 'vault');
const TEMPLATES = path.join(ROOT, 'references', 'vault-templates');
const DEFAULT_PROFILE = path.join(ROOT, 'references', 'default-profile.json');

function today() {
  return new Date().toISOString().split('T')[0];
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyTemplate(src, dest) {
  if (fs.existsSync(dest)) return; // do not overwrite
  const dir = path.dirname(dest);
  ensureDir(dir);
  fs.copyFileSync(src, dest);
}

// Step 1: Backup profile
function backupProfile() {
  if (!fs.existsSync(PROFILE)) return;
  const backup = PROFILE + '.bak';
  fs.copyFileSync(PROFILE, backup);
  console.log('Backed up profile.json to profile.json.bak');
}

// Step 2: Reset profile with new fields
function resetProfile() {
  const template = JSON.parse(fs.readFileSync(DEFAULT_PROFILE, 'utf8'));
  const json = JSON.stringify(template, null, 2).replace(/\{today\}/g, today());
  fs.writeFileSync(PROFILE, json);
  console.log('Reset profile.json to default with vault fields');
}

// Step 3: Parse journal into vault session notes
function migrateJournal() {
  if (!fs.existsSync(JOURNAL)) {
    console.log('No journal.md found, skipping journal migration');
    return;
  }

  const content = fs.readFileSync(JOURNAL, 'utf8');
  const sections = content.split(/^## /m).slice(1); // split on ## headings

  const sessionsDir = path.join(VAULT, 'sessions');
  ensureDir(sessionsDir);

  let count = 0;
  for (const section of sections) {
    const lines = section.split('\n');
    const title = lines[0].trim();

    // Extract metadata from bullet points
    let simId = null;
    let date = null;
    let difficulty = null;
    let category = null;

    for (const line of lines) {
      const simMatch = line.match(/\*\*Sim\*\*:\s*\[\[(.+?)\]\]/);
      if (simMatch) simId = simMatch[1];

      const dateMatch = line.match(/\*\*Date\*\*:\s*(\d{4}-\d{2}-\d{2})/);
      if (dateMatch) date = dateMatch[1];

      const diffMatch = line.match(/\*\*Difficulty\*\*:\s*(\d+)/);
      if (diffMatch) difficulty = parseInt(diffMatch[1], 10);

      const catMatch = line.match(/\*\*Category\*\*:\s*(\w+)/);
      if (catMatch) category = catMatch[1];
    }

    if (!simId) continue;

    const filename = `${simId}.md`;
    const notePath = path.join(sessionsDir, filename);
    if (fs.existsSync(notePath)) continue; // idempotent

    const note = [
      '---',
      'tags:',
      '  - type/session',
      category ? `  - category/${category}` : null,
      '  - rank/responder',
      `date: ${date || today()}`,
      `sim: ${simId}`,
      difficulty !== null ? `difficulty: ${difficulty}` : null,
      'quality_avg: n/a',
      'migrated: true',
      '---',
      '',
      `# ${title}`,
      '',
      '(Migrated from journal.md. Quality data not available for pre-vault sessions.)',
      '',
      '## Original Entry',
      '',
      section.trim(),
    ].filter(l => l !== null).join('\n') + '\n';

    fs.writeFileSync(notePath, note);
    count++;
  }

  console.log(`Migrated ${count} journal entries to vault/sessions/`);

  // Delete journal
  fs.unlinkSync(JOURNAL);
  console.log('Deleted journal.md');
}

// Step 4: Create vault directory structure
function createVault() {
  const dirs = [
    path.join(VAULT, 'sessions'),
    path.join(VAULT, 'concepts'),
    path.join(VAULT, 'patterns'),
    path.join(VAULT, 'services'),
    path.join(VAULT, 'raw'),
  ];

  for (const dir of dirs) {
    ensureDir(dir);
  }

  // Copy templates
  copyTemplate(path.join(TEMPLATES, 'index.md'), path.join(VAULT, 'index.md'));
  copyTemplate(path.join(TEMPLATES, 'patterns', 'behavioral-profile.md'), path.join(VAULT, 'patterns', 'behavioral-profile.md'));
  copyTemplate(path.join(TEMPLATES, 'patterns', 'question-quality.md'), path.join(VAULT, 'patterns', 'question-quality.md'));
  copyTemplate(path.join(TEMPLATES, 'patterns', 'investigation-style.md'), path.join(VAULT, 'patterns', 'investigation-style.md'));

  console.log('Created vault directory structure');
}

// Step 5: Reset catalog knowledge scores
function resetCatalog() {
  if (!fs.existsSync(CATALOG)) {
    console.log('No catalog.csv found, skipping catalog reset');
    return;
  }

  const content = fs.readFileSync(CATALOG, 'utf8');
  const lines = content.split('\n');
  const header = lines[0];

  // Find column indices
  const cols = header.split(',');
  const ksIdx = cols.indexOf('knowledge_score');
  const scIdx = cols.indexOf('sims_completed');
  const lpIdx = cols.indexOf('last_practiced');
  const notesIdx = cols.indexOf('notes');

  if (ksIdx === -1) {
    console.log('catalog.csv has no knowledge_score column, skipping reset');
    return;
  }

  const newLines = [header];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const fields = lines[i].split(',');
    if (ksIdx >= 0) fields[ksIdx] = '0';
    if (scIdx >= 0) fields[scIdx] = '0';
    if (lpIdx >= 0) fields[lpIdx] = '';
    if (notesIdx >= 0) fields[notesIdx] = '';
    newLines.push(fields.join(','));
  }

  fs.writeFileSync(CATALOG, newLines.join('\n') + '\n');
  console.log('Reset catalog.csv knowledge scores to 0');
}

// Main
function main() {
  console.log('=== Learning System Migration ===\n');

  if (!fs.existsSync(LEARNING)) {
    console.log('No learning/ directory found. Run /setup first.');
    process.exit(1);
  }

  backupProfile();
  resetProfile();
  createVault();
  migrateJournal();
  resetCatalog();

  console.log('\nMigration complete. Profile reset to Responder. Vault created.');
  console.log('Old profile backed up to learning/profile.json.bak');
}

main();
