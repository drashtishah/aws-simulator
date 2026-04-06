const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const INDEX_PATH = path.join(ROOT, 'references', 'agent-index.md');
const SKILLS_DIR = path.join(ROOT, '.claude', 'skills');
const SETTINGS_PATH = path.join(ROOT, '.claude', 'settings.local.json');

describe('agent-index generator', () => {
  before(() => {
    execSync('npx tsx scripts/generate-agent-index.ts', { cwd: ROOT, timeout: 60000 });
  });

  it('generates references/agent-index.md', () => {
    assert.ok(fs.existsSync(INDEX_PATH), 'agent-index.md should exist');
  });

  it('includes a row for every skill with a SKILL.md', () => {
    const content = fs.readFileSync(INDEX_PATH, 'utf8');
    const skillDirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .filter(d => fs.existsSync(path.join(SKILLS_DIR, d.name, 'SKILL.md')))
      .map(d => d.name);

    for (const dir of skillDirs) {
      const pattern = new RegExp(`\\|.*/${dir}/SKILL\\.md.*\\|`);
      assert.match(content, pattern, `Missing skill row for ${dir}`);
    }
  });

  it('includes a row for every unique hook script in settings.local.json', () => {
    const content = fs.readFileSync(INDEX_PATH, 'utf8');
    const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    const hooks = settings.hooks || {};
    const uniqueScripts = new Set();

    for (const entries of Object.values(hooks)) {
      for (const entry of entries) {
        for (const hook of (entry.hooks || [])) {
          const cmd = hook.command || '';
          const match = cmd.match(/node\s+(.+?)$/);
          if (match) uniqueScripts.add(match[1].trim());
        }
      }
    }

    for (const script of uniqueScripts) {
      assert.ok(
        content.includes(script),
        `Missing hook row for ${script}`
      );
    }
  });

  it('index is under 200 lines', () => {
    const content = fs.readFileSync(INDEX_PATH, 'utf8');
    const lineCount = content.split('\n').length;
    assert.ok(lineCount <= 200, `Index has ${lineCount} lines, expected <= 200`);
  });

  it('all concrete file paths referenced in the index exist on disk', () => {
    const content = fs.readFileSync(INDEX_PATH, 'utf8');
    // Extract backtick-wrapped paths that look like file paths (contain / or .)
    const pathMatches = content.match(/`([^`]+)`/g) || [];
    const missing = [];

    for (const raw of pathMatches) {
      const p = raw.replace(/`/g, '');
      // Skip npm commands, matchers, non-path strings
      if (p.startsWith('npm ')) continue;
      if (!p.includes('/') && !p.includes('.')) continue;
      // Skip glob patterns
      if (p.includes('*')) continue;
      // Skip matcher patterns like "Edit|Write"
      if (p.includes('|')) continue;

      const resolved = path.resolve(ROOT, p);
      if (!fs.existsSync(resolved)) {
        missing.push(p);
      }
    }

    assert.deepStrictEqual(missing, [], `Paths not found on disk: ${missing.join(', ')}`);
  });
});
