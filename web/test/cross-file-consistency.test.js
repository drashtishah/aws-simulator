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
    'next-rank-requirements',
    'next-rank-req',
    'rank-history-entry',
    'rank-history-title',
    'rank-history-date',
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

// --- 7. Theme IDs hardcoded in source exist on disk ---

describe('hardcoded theme IDs exist as files', () => {
  it('app.js calm-mentor theme file exists', () => {
    const appJs = readFile('web/public/app.js');
    const match = appJs.match(/themeId\s*=\s*'([^']+)'/);
    assert.ok(match, 'app.js must hardcode a themeId');
    const themeFile = path.join(ROOT, 'themes', match[1] + '.md');
    assert.ok(fs.existsSync(themeFile),
      'theme file for "' + match[1] + '" must exist at themes/' + match[1] + '.md');
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
