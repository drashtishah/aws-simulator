const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { loadConfig, axisNames } = require('../lib/progression');

const ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_PATH = path.join(ROOT, 'references', 'progression.yaml');

function readFile(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

// --- 1. CSS class coverage ---

describe('CSS class coverage: app.js classes exist in style.css', () => {
  const appJs = readFile('web/public/app.js');
  const styleCss = readFile('web/public/style.css');

  // Extract class selectors from CSS (e.g. .foo-bar)
  const cssClasses = new Set();
  for (const match of styleCss.matchAll(/\.([a-z][a-z0-9-]*)/g)) {
    cssClasses.add(match[1]);
  }

  // Classes that app.js constructs in HTML strings.
  // We look for class="..." patterns and ' classname' concatenation patterns.
  const appClassRefs = new Set();

  // Pattern 1: class="word word word"
  for (const match of appJs.matchAll(/class="([^"]+)"/g)) {
    for (const cls of match[1].split(/\s+/)) {
      if (cls && !cls.includes("'") && !cls.includes('+')) {
        appClassRefs.add(cls);
      }
    }
  }

  // Pattern 2: ' classname' used in string concatenation (e.g. ' hexagon-dot-fading')
  for (const match of appJs.matchAll(/'\s+([a-z][a-z0-9-]+)'/g)) {
    appClassRefs.add(match[1]);
  }

  // Specific classes the plan identified as critical
  const criticalClasses = [
    'hexagon-dot-fading',
    'hexagon-label-fading',
    'next-rank-title',
    'next-rank-description',
    'next-rank-gaps',
    'next-rank-gap',
    'rank-progression',
    'rank-step',
    'hexagon-grid-ring',
    'hexagon-axis-line',
    'hexagon-polygon',
    'hexagon-dot',
    'hexagon-label',
  ];

  for (const cls of criticalClasses) {
    it('"' + cls + '" exists in style.css', () => {
      assert.ok(cssClasses.has(cls), cls + ' is referenced in app.js but missing from style.css');
    });
  }
});

// --- 2. No deprecated field names in skill references ---

describe('no deprecated field names in skill files', () => {
  const deprecated = ['question_hexagon', 'unlocked_levels'];

  const files = [
    '.claude/skills/play/references/coaching-patterns.md',
    '.claude/skills/play/references/agent-prompts.md',
    '.claude/skills/play/SKILL.md',
    '.claude/skills/setup/SKILL.md',
  ];

  for (const filePath of files) {
    const content = readFile(filePath);
    const basename = path.basename(filePath);

    for (const term of deprecated) {
      it(basename + ' does not reference "' + term + '"', () => {
        assert.ok(
          !content.includes(term),
          basename + ' contains deprecated field "' + term + '"'
        );
      });
    }
  }
});

// --- 3. No stale theme references ---

describe('no stale theme references', () => {
  const staleThemes = ['still-life', 'slow-burn', 'field-notes'];

  const files = [
    'web/public/app.js',
    'web/server.js',
    '.claude/skills/play/SKILL.md',
    'references/web-app-checklist.md',
  ];

  for (const filePath of files) {
    const content = readFile(filePath);
    const basename = path.basename(filePath);

    for (const theme of staleThemes) {
      it(basename + ' does not reference deleted theme "' + theme + '"', () => {
        assert.ok(
          !content.includes(theme),
          basename + ' contains stale theme reference "' + theme + '"'
        );
      });
    }
  }
});

// --- 4. Session state question_profile axes match progression.yaml ---

describe('session state template axes match progression.yaml', () => {
  const config = loadConfig(CONFIG_PATH);
  const configAxes = axisNames(config).sort();

  it('agent-prompts.md question_profile keys match config axes', () => {
    const agentPrompts = readFile('.claude/skills/play/references/agent-prompts.md');

    // Find first question_profile block and extract axis keys.
    // Axes are keys whose values are objects with count/effective: "gather": { "count": 0, ...
    const profileAxes = [];
    const axisPattern = /"([a-z_]+)"\s*:\s*\{\s*"count"/g;
    for (const match of agentPrompts.matchAll(axisPattern)) {
      if (!profileAxes.includes(match[1])) {
        profileAxes.push(match[1]);
      }
    }
    profileAxes.sort();

    assert.ok(profileAxes.length > 0, 'agent-prompts.md must contain question_profile axis entries');
    assert.deepEqual(profileAxes, configAxes,
      'question_profile axes in agent-prompts.md must match progression.yaml axes');
  });
});

// --- 5. App.js fallback axes match progression.yaml ---

describe('app.js fallback axes match progression.yaml', () => {
  const config = loadConfig(CONFIG_PATH);
  const configAxes = axisNames(config).sort();

  it('hardcoded axisNames in loadDashboard fallback match config', () => {
    const appJs = readFile('web/public/app.js');

    // Find the axisNames array in the fallback object
    const match = appJs.match(/axisNames:\s*\[([^\]]+)\]/);
    assert.ok(match, 'app.js must contain a hardcoded axisNames fallback array');

    const fallbackAxes = [];
    for (const m of match[1].matchAll(/'([a-z_]+)'/g)) {
      fallbackAxes.push(m[1]);
    }
    fallbackAxes.sort();

    assert.deepEqual(fallbackAxes, configAxes,
      'app.js fallback axisNames must match progression.yaml axes');
  });
});

// --- 6. Playtest setting wiring ---

describe('playtest setting wiring', () => {
  const indexHtml = readFile('web/public/index.html');
  const appJs = readFile('web/public/app.js');

  it('index.html has playtest select element', () => {
    assert.ok(indexHtml.includes('select-playtest'), 'settings modal should have playtest dropdown');
  });

  it('app.js reads playtest setting', () => {
    assert.ok(appJs.includes("getSetting('playtest'"), 'app.js should read playtest setting');
  });

  it('app.js sends playtest in startSim body', () => {
    assert.ok(appJs.includes('playtest'), 'startSim should include playtest in request body');
  });
});

// --- 7. sim-test CLI commands ---

describe('sim-test CLI commands', () => {
  const simTestJs = readFile('scripts/sim-test.js');

  it('has evals command', () => {
    assert.ok(simTestJs.includes(".command('evals')"), 'sim-test should have evals command');
  });

  it('does not have old eval command', () => {
    assert.ok(!simTestJs.includes(".command('eval')"), 'old eval command should be removed');
  });
});

// --- 8. Dashboard rendering correctness ---

describe('dashboard rendering correctness', () => {
  const appJs = readFile('web/public/app.js');
  const indexHtml = readFile('web/public/index.html');

  it('hexagon SVG viewBox has room for labels beyond the grid', () => {
    const match = indexHtml.match(/id="hexagon-svg"\s+viewBox="([^"]+)"/);
    assert.ok(match, 'hexagon SVG should have viewBox');
    const parts = match[1].split(/\s+/).map(Number);
    const width = parts[2] || parts[0];
    assert.ok(width > 300, 'viewBox width should exceed 300 to fit labels: got ' + width);
  });

  it('highest rank message only shown when nextRank is null', () => {
    const lines = appJs.split('\n');
    const highestRankLines = lines.filter(l => l.includes('highest rank'));
    for (const line of highestRankLines) {
      assert.ok(
        !line.includes('requirements.length'),
        '"highest rank" should not be gated on requirements.length (should only appear when nextRank is null)'
      );
    }
  });
});

// --- 8b. Skill tool references ---

describe('skill tool references', () => {
  const skillDirs = fs.readdirSync(path.join(ROOT, '.claude', 'skills'), { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  const validTools = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'Agent', 'WebSearch', 'WebFetch', 'MCP aws___'];

  for (const skill of skillDirs) {
    const skillPath = path.join(ROOT, '.claude', 'skills', skill, 'SKILL.md');
    if (!fs.existsSync(skillPath)) continue;
    const content = fs.readFileSync(skillPath, 'utf8');

    // Check if skill has a Tool Reference section
    if (!content.includes('## Tool Reference')) continue;

    // Extract the table section
    const tableMatch = content.match(/## Tool Reference\n\n\|[\s\S]*?\n\n/);
    if (!tableMatch) continue;

    const lines = tableMatch[0].split('\n').filter(l => l.startsWith('|') && !l.includes('---') && !l.includes('Step'));

    it(skill + ' SKILL.md tool names are valid', () => {
      for (const line of lines) {
        const cols = line.split('|').map(c => c.trim()).filter(Boolean);
        if (cols.length < 3) continue;
        const toolName = cols[2]; // Tool column
        const isValid = validTools.some(v => toolName.startsWith(v));
        assert.ok(isValid, 'Unknown tool "' + toolName + '" in ' + skill + ' SKILL.md');
      }
    });

    it(skill + ' SKILL.md concrete target paths exist', () => {
      const missing = [];
      for (const line of lines) {
        const cols = line.split('|').map(c => c.trim()).filter(Boolean);
        if (cols.length < 4) continue;
        let target = cols[3].replace(/^`|`$/g, ''); // Target column, strip backticks
        // Skip template paths, runtime paths, commands, and descriptions
        if (target.includes('{') || target.includes('*') || !target.includes('/') || !target.includes('.')) continue;
        if (target.startsWith('learning/') || target.startsWith('web/test-results/')) continue;
        if (target.startsWith('node ') || target.startsWith('npm ') || target.startsWith('gh ')) continue;
        if (/^[A-Z]/.test(target)) continue; // Skip descriptions like "AWS incident patterns"
        const fullPath = path.join(ROOT, target);
        if (!fs.existsSync(fullPath)) {
          missing.push(target);
        }
      }
      assert.equal(missing.length, 0, 'Missing target files: ' + missing.join(', '));
    });
  }
});

// --- 8. Theme IDs hardcoded in source exist on disk ---

describe('hardcoded theme IDs exist as files', () => {
  it('app.js calm-mentor theme file exists', () => {
    const appJs = readFile('web/public/app.js');
    const match = appJs.match(/themeId\s*=\s*'([^']+)'/);
    assert.ok(match, 'app.js must hardcode a themeId');
    const themeFile = path.join(ROOT, 'themes', match[1] + '.md');
    assert.ok(fs.existsSync(themeFile),
      'theme file for "' + match[1] + '" must exist at themes/' + match[1] + '.md');
  });

  it('agent-prompts.md contains mermaid instruction', () => {
    const prompts = readFile('.claude/skills/play/references/agent-prompts.md');
    assert.ok(prompts.toLowerCase().includes('mermaid'),
      'agent-prompts.md should contain mermaid instruction');
  });

  it('index.html includes mermaid.min.js CDN script', () => {
    const html = readFile('web/public/index.html');
    assert.ok(html.includes('mermaid.min.js'),
      'index.html should include mermaid.min.js CDN');
  });

  it('app.js contains mermaid.render call', () => {
    const appJs = readFile('web/public/app.js');
    assert.ok(appJs.includes('mermaid.render'),
      'app.js should contain mermaid.render for diagram support');
  });

  it('style.css contains .mermaid-diagram', () => {
    const css = readFile('web/public/style.css');
    assert.ok(css.includes('.mermaid-diagram'),
      'style.css should contain .mermaid-diagram styles');
  });

  it('index.html includes marked.min.js CDN script', () => {
    const html = readFile('web/public/index.html');
    assert.ok(html.includes('marked.min.js'),
      'index.html should include marked.min.js CDN');
  });

  it('style.css uses white-space: normal for narrator messages', () => {
    const css = readFile('web/public/style.css');
    assert.ok(/\.chat-message\.narrator\s*\{[^}]*white-space:\s*normal/s.test(css),
      'narrator messages should use white-space: normal');
  });

  it('registry summaries share keywords with manifest summaries', () => {
    const registry = JSON.parse(readFile('sims/registry.json'));
    for (const sim of registry.sims) {
      const manifestPath = path.join('sims', sim.id, 'manifest.json');
      const fullPath = path.join(ROOT, manifestPath);
      if (!fs.existsSync(fullPath)) continue;
      const manifest = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      // Extract significant words (4+ chars) from manifest summary
      const manifestWords = (manifest.summary || '').toLowerCase().split(/\W+/).filter(w => w.length >= 4);
      const registrySummary = (sim.summary || '').toLowerCase();
      // At least one keyword from manifest should appear in registry
      const hasOverlap = manifestWords.some(w => registrySummary.includes(w));
      assert.ok(hasOverlap,
        'registry summary for "' + sim.id + '" should share keywords with manifest summary');
    }
  });

  it('app.js contains single-sim enforcement guard', () => {
    const appJs = readFile('web/public/app.js');
    assert.ok(appJs.includes('currentSessionId && !isResume'),
      'app.js should have single-sim enforcement guard in startSim');
  });

  it('index.html does not contain stat-quality or stat-sessions-at-rank', () => {
    const html = readFile('web/public/index.html');
    assert.ok(!html.includes('stat-quality'),
      'index.html should not contain stat-quality card');
    assert.ok(!html.includes('stat-sessions-at-rank'),
      'index.html should not contain stat-sessions-at-rank card');
  });

  it('chat-input:focus uses accent-primary not accent-blue', () => {
    const css = readFile('web/public/style.css');
    assert.ok(!/\.chat-input:focus\s*\{[^}]*accent-blue/.test(css),
      'chat-input:focus should not use accent-blue');
  });

  it('index.html does not contain model selector', () => {
    const html = readFile('web/public/index.html');
    assert.ok(!html.includes('id="select-model"'),
      'index.html should not contain model selector (id="select-model")');
  });

  it('server.js fallback theme file exists', () => {
    const serverJs = readFile('web/server.js');
    // Match patterns like: themeId || 'calm-mentor'
    const matches = serverJs.matchAll(/themeId\s*\|\|\s*'([^']+)'/g);
    for (const match of matches) {
      const themeFile = path.join(ROOT, 'themes', match[1] + '.md');
      assert.ok(fs.existsSync(themeFile),
        'theme file for fallback "' + match[1] + '" must exist at themes/' + match[1] + '.md');
    }
  });
});
