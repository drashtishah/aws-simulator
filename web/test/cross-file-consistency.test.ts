import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { loadConfig, axisNames } from '../lib/progression';


const ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_PATH = path.join(ROOT, 'references', 'config', 'progression.yaml');

function readFile(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

// --- 0. rank-display.ts module structure ---

describe('rank-display.ts exports expected symbols', () => {
  const exists = fs.existsSync(path.resolve(__dirname, '../../public/rank-display.ts'));
  const src = exists ? readFile('web/public/rank-display.ts') : '';
  for (const fn of ['renderPolygon', 'renderNextRank', 'renderRankProgression', 'formatRankId']) {
    it('exports ' + fn, () => {
      assert.ok(src.includes('export function ' + fn), 'rank-display.ts must export ' + fn);
    });
  }
});

// --- 1. CSS class coverage ---

describe('CSS class coverage: app.ts classes exist in style.css', () => {
  const appJs = readFile('web/public/app.ts') + readFile('web/public/rank-display.ts');
  const styleCss = readFile('web/public/style.css');

  // Extract class selectors from CSS (e.g. .foo-bar)
  const cssClasses = new Set();
  for (const match of styleCss.matchAll(/\.([a-z][a-z0-9-]*)/g)) {
    cssClasses.add(match[1]);
  }

  // Classes that app.ts constructs in HTML strings.
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
      assert.ok(cssClasses.has(cls), cls + ' is referenced in app.ts but missing from style.css');
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
    'web/public/app.ts',
    'web/server.ts',
    '.claude/skills/play/SKILL.md',
    'references/operations/web-app-checklist.md',
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

describe('app.ts fallback axes match progression.yaml', () => {
  const config = loadConfig(CONFIG_PATH);
  const configAxes = axisNames(config).sort();

  it('hardcoded axisNames in loadDashboard fallback match config', () => {
    const appJs = readFile('web/public/app.ts');

    // Find the axisNames array in the fallback object
    const match = appJs.match(/axisNames:\s*\[([^\]]+)\]/);
    assert.ok(match, 'app.ts must contain a hardcoded axisNames fallback array');

    const fallbackAxes = [];
    for (const m of match[1].matchAll(/'([a-z_]+)'/g)) {
      fallbackAxes.push(m[1]);
    }
    fallbackAxes.sort();

    assert.deepEqual(fallbackAxes, configAxes,
      'app.ts fallback axisNames must match progression.yaml axes');
  });
});

// --- 6. Playtest setting wiring ---

describe('playtester mode removed', () => {
  const indexHtml = readFile('web/public/index.html');
  const appJs = readFile('web/public/app.ts');

  it('index.html does not have playtest select element', () => {
    assert.ok(!indexHtml.includes('select-playtest'), 'settings modal should not have playtest dropdown');
  });

  it('app.ts does not read playtest setting', () => {
    assert.ok(!appJs.includes("getSetting('playtest'"), 'app.ts should not read playtest setting');
  });
});

// --- 7. test CLI commands ---

describe('test CLI commands', () => {
  const simTestJs = readFile('scripts/test.ts');

  it('has evals command', () => {
    assert.ok(simTestJs.includes(".command('evals')"), 'test should have evals command');
  });

  it('does not have old eval command', () => {
    assert.ok(!simTestJs.includes(".command('eval')"), 'old eval command should be removed');
  });
});

// --- 8. Dashboard rendering correctness ---

describe('dashboard rendering correctness', () => {
  const appJs = readFile('web/public/app.ts') + readFile('web/public/rank-display.ts');
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
        if (target.startsWith('node ') || target.startsWith('npm ') || target.startsWith('gh ') || target.startsWith('tsx ')) continue;
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
  it('app.ts calm-mentor theme file exists', () => {
    const appJs = readFile('web/public/app.ts');
    const match = appJs.match(/themeId\s*=\s*'([^']+)'/);
    assert.ok(match, 'app.ts must hardcode a themeId');
    const themeFile = path.join(ROOT, 'themes', match[1] + '.md');
    assert.ok(fs.existsSync(themeFile),
      'theme file for "' + match[1] + '" must exist at themes/' + match[1] + '.md');
  });

  it('coaching-patterns.md contains Service Solves Pattern', () => {
    const coaching = readFile('.claude/skills/play/references/coaching-patterns.md');
    assert.ok(coaching.includes('## Service "Solves" Pattern'),
      'coaching-patterns.md should contain Service Solves Pattern section');
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

  it('app.ts contains mermaid.render call', () => {
    const appJs = readFile('web/public/app.ts');
    assert.ok(appJs.includes('mermaid.render'),
      'app.ts should contain mermaid.render for diagram support');
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

  it('app.ts contains single-sim enforcement guard', () => {
    const appJs = readFile('web/public/app.ts');
    assert.ok(appJs.includes('currentSessionId && !isResume'),
      'app.ts should have single-sim enforcement guard in startSim');
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
    const serverJs = readFile('web/server.ts');
    // Match patterns like: themeId || 'calm-mentor'
    const matches = serverJs.matchAll(/themeId\s*\|\|\s*'([^']+)'/g);
    for (const match of matches) {
      const themeFile = path.join(ROOT, 'themes', match[1] + '.md');
      assert.ok(fs.existsSync(themeFile),
        'theme file for fallback "' + match[1] + '" must exist at themes/' + match[1] + '.md');
    }
  });
});

// --- 9. YAML browser spec selector drift ---

describe('YAML browser spec selector drift', () => {
  const specsDir = path.join(ROOT, 'web', 'test-specs', 'browser');
  const specFiles = fs.readdirSync(specsDir).filter(f => f.endsWith('.yaml'));

  const indexHtml = readFile('web/public/index.html');
  const styleCss = readFile('web/public/style.css');
  const appTs = readFile('web/public/app.ts') + readFile('web/public/rank-display.ts');

  // Allowlisted selectors (dynamic content, not in static HTML)
  const allowlist = [
    '.chat-message',
    '.sim-card',
    '.custom-select-option',
  ];

  // Selectors that assert absence (visible: false for removed elements)
  const absenceSelectors = new Set([
    '#legacy-progress-bar',
    '#old-level-display',
  ]);

  function isAllowlisted(selector) {
    // Skip pseudo-selectors
    if (/:focus/.test(selector) || /:first-child/.test(selector) ||
        /:last-child/.test(selector) || /:nth-child/.test(selector) ||
        /:focus-visible/.test(selector)) {
      return true;
    }
    // Skip allowlisted classes and their sub-selectors
    for (const prefix of allowlist) {
      if (selector === prefix || selector.startsWith(prefix + '.') ||
          selector.startsWith(prefix + ':') || selector.startsWith(prefix + ' ') ||
          selector.startsWith(prefix + '[')) {
        return true;
      }
    }
    return false;
  }

  function extractSelectors(obj) {
    const selectors = [];
    if (!obj || typeof obj !== 'object') return selectors;
    if (Array.isArray(obj)) {
      for (const item of obj) {
        selectors.push(...extractSelectors(item));
      }
      return selectors;
    }
    if (typeof obj.selector === 'string') selectors.push(obj.selector);
    if (typeof obj.target === 'string') selectors.push(obj.target);
    for (const val of Object.values(obj)) {
      if (typeof val === 'object' && val !== null) {
        selectors.push(...extractSelectors(val));
      }
    }
    return selectors;
  }

  function splitCompoundSelector(selector) {
    // Split compound selectors like "#view-dashboard #stat-rank-title" or ".topbar .topbar-title-full"
    return selector.trim().split(/\s+/);
  }

  function validateSimpleSelector(sel) {
    // Returns an error message if the selector cannot be found, or null if OK.

    // ID selector: #foo or #foo.bar or #foo[attr]
    const idMatch = sel.match(/^#([a-zA-Z0-9_-]+)/);
    if (idMatch) {
      const id = idMatch[1];
      const pattern = 'id="' + id + '"';
      if (!indexHtml.includes(pattern) && !appTs.includes(pattern)) {
        return 'id="' + id + '" not found in index.html or app.ts';
      }
      return null;
    }

    // Attribute selector: [data-foo='bar'] or [role="dialog"]
    const attrMatch = sel.match(/^\[([a-zA-Z0-9_-]+)/);
    if (attrMatch) {
      const attr = attrMatch[1];
      if (!indexHtml.includes(attr) && !appTs.includes(attr)) {
        return 'attribute "' + attr + '" not found in index.html or app.ts';
      }
      return null;
    }

    // Class selector: .foo or .foo-bar
    const classMatch = sel.match(/^\.([a-zA-Z][a-zA-Z0-9_-]*)/);
    if (classMatch) {
      const cls = classMatch[1];
      if (!indexHtml.includes(cls) && !styleCss.includes(cls) && !appTs.includes(cls)) {
        return 'class "' + cls + '" not found in index.html, style.css, or app.ts';
      }
      return null;
    }

    // Element selectors (h2, text, select) are always OK
    return null;
  }

  it('YAML browser spec selectors match actual DOM', () => {
    const missing = [];

    for (const file of specFiles) {
      const content = fs.readFileSync(path.join(specsDir, file), 'utf8');
      const spec = yaml.load(content);
      const selectors = extractSelectors(spec.steps || []);

      for (const rawSelector of selectors) {
        if (isAllowlisted(rawSelector) || absenceSelectors.has(rawSelector)) continue;

        const parts = splitCompoundSelector(rawSelector);
        for (const part of parts) {
          if (isAllowlisted(part)) continue;

          const error = validateSimpleSelector(part);
          if (error) {
            missing.push(file + ': selector "' + rawSelector + '" (' + error + ')');
          }
        }
      }
    }

    assert.equal(
      missing.length, 0,
      'Selectors in YAML specs reference elements not found in source files:\n  ' +
        missing.join('\n  ')
    );
  });
});
