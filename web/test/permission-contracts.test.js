// Permission contracts test suite
// Validates security invariants across tool whitelists, hook wiring, and guard-write rules.
// See: https://github.com/drashti-shah/aws-simulator/issues/24
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { globSync } = require('fs');

const ROOT = path.resolve(__dirname, '..', '..');

// --- web app tool whitelist ---

describe('web app tool whitelist', () => {
  const source = fs.readFileSync(
    path.join(ROOT, 'web', 'lib', 'claude-process.js'), 'utf8'
  );
  const lines = source.split('\n');

  it('has exactly 7 allowedTools occurrences, each restricted to Read and Write', () => {
    const matches = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('allowedTools:')) {
        matches.push({ lineNumber: i + 1, text: lines[i] });
      }
    }
    assert.equal(matches.length, 7,
      'expected exactly 7 allowedTools declarations, found ' + matches.length);
    for (const m of matches) {
      assert.ok(
        m.text.includes("'Read'") && m.text.includes("'Write'"),
        'allowedTools on line ' + m.lineNumber + ' must include Read and Write'
      );
      // Ensure no other tools are listed beyond Read and Write
      const bracketContent = m.text.match(/\[([^\]]+)\]/);
      assert.ok(bracketContent, 'allowedTools on line ' + m.lineNumber + ' should be an array');
      const items = bracketContent[1].split(',').map(s => s.trim().replace(/'/g, ''));
      assert.deepStrictEqual(items.sort(), ['Read', 'Write'],
        'allowedTools on line ' + m.lineNumber + ' must contain only Read and Write');
    }
  });

  it('has exactly 7 permissionMode occurrences, each set to bypassPermissions', () => {
    const matches = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('permissionMode:')) {
        matches.push({ lineNumber: i + 1, text: lines[i] });
      }
    }
    assert.equal(matches.length, 7,
      'expected exactly 7 permissionMode declarations, found ' + matches.length);
    for (const m of matches) {
      assert.ok(
        m.text.includes("'bypassPermissions'"),
        'permissionMode on line ' + m.lineNumber + ' must be bypassPermissions'
      );
    }
  });

  it('does not contain dangerouslyDisableSandbox', () => {
    assert.ok(
      !source.includes('dangerouslyDisableSandbox'),
      'source must not contain dangerouslyDisableSandbox'
    );
  });

  it('does not contain allowDangerouslySkipPermissions', () => {
    assert.ok(
      !source.includes('allowDangerouslySkipPermissions'),
      'source must not contain allowDangerouslySkipPermissions'
    );
  });
});

// --- settings.local.json hook integrity ---

describe('settings.local.json hook integrity', () => {
  const settingsPath = path.join(ROOT, '.claude', 'settings.local.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const hooks = settings.hooks;

  it('every hook command references a script that exists on disk', () => {
    assert.ok(hooks, 'settings must have a hooks object');
    for (const [eventType, entries] of Object.entries(hooks)) {
      for (const entry of entries) {
        const hookList = entry.hooks || [];
        for (const hook of hookList) {
          if (hook.type === 'command' && hook.command) {
            // Extract script path from commands like "node .claude/hooks/guard-write.js"
            const match = hook.command.match(/node\s+(.+\.js)/);
            assert.ok(match,
              'hook command in ' + eventType + ' should reference a .js file: ' + hook.command);
            const scriptPath = path.join(ROOT, match[1]);
            assert.ok(fs.existsSync(scriptPath),
              'script ' + match[1] + ' referenced by ' + eventType + ' hook must exist on disk');
          }
        }
      }
    }
  });

  it('PreToolUse has Edit|Write matcher with guard-write.js', () => {
    const preToolUse = hooks.PreToolUse;
    assert.ok(preToolUse, 'PreToolUse hooks must exist');
    const guardEntry = preToolUse.find(entry =>
      entry.matcher && entry.matcher.includes('Edit') && entry.matcher.includes('Write') &&
      entry.hooks.some(h => h.command && h.command.includes('guard-write.js'))
    );
    assert.ok(guardEntry,
      'PreToolUse must have an Edit|Write matcher with guard-write.js');
  });

  it('PreToolUse has Bash matcher with pre-commit-issues.js', () => {
    const preToolUse = hooks.PreToolUse;
    assert.ok(preToolUse, 'PreToolUse hooks must exist');
    const bashEntry = preToolUse.find(entry =>
      entry.matcher === 'Bash' &&
      entry.hooks.some(h => h.command && h.command.includes('pre-commit-issues.js'))
    );
    assert.ok(bashEntry,
      'PreToolUse must have a Bash matcher with pre-commit-issues.js');
  });

  it('PostToolUse has Edit|Write|Bash|Agent matcher with log-hook.js', () => {
    const postToolUse = hooks.PostToolUse;
    assert.ok(postToolUse, 'PostToolUse hooks must exist');
    const logEntry = postToolUse.find(entry => {
      if (!entry.matcher) return false;
      const parts = entry.matcher.split('|');
      return ['Edit', 'Write', 'Bash', 'Agent'].every(t => parts.includes(t)) &&
        entry.hooks.some(h => h.command && h.command.includes('log-hook.js'));
    });
    assert.ok(logEntry,
      'PostToolUse must have an Edit|Write|Bash|Agent matcher with log-hook.js');
  });
});

// --- guard-write contract ---

describe('guard-write contract', () => {
  const guardSource = fs.readFileSync(
    path.join(ROOT, '.claude', 'hooks', 'guard-write.js'), 'utf8'
  );

  function extractArrayValues(source, varName) {
    const regex = new RegExp('const ' + varName + '\\s*=\\s*\\[([^\\]]+)\\]');
    const match = source.match(regex);
    assert.ok(match, varName + ' array must exist in guard-write.js');
    return match[1]
      .split(',')
      .map(s => s.trim().replace(/'/g, '').replace(/"/g, ''))
      .filter(s => s.length > 0);
  }

  it('NEVER_WRITABLE includes critical protected files', () => {
    const values = extractArrayValues(guardSource, 'NEVER_WRITABLE');
    const required = [
      'references/path-registry.csv',
      'learning/logs/activity.jsonl',
      'package-lock.json',
      'scripts/sim-test.js'
    ];
    for (const file of required) {
      assert.ok(values.includes(file),
        'NEVER_WRITABLE must include ' + file);
    }
  });

  it('NEVER_WRITABLE_DIRS includes critical protected directories', () => {
    const values = extractArrayValues(guardSource, 'NEVER_WRITABLE_DIRS');
    const required = ['node_modules', 'web/test-specs'];
    for (const dir of required) {
      assert.ok(values.includes(dir),
        'NEVER_WRITABLE_DIRS must include ' + dir);
    }
  });

  it('no ownership.json files entry conflicts with NEVER_WRITABLE or NEVER_WRITABLE_DIRS', () => {
    const neverFiles = extractArrayValues(guardSource, 'NEVER_WRITABLE');
    const neverDirs = extractArrayValues(guardSource, 'NEVER_WRITABLE_DIRS');

    // Find all ownership.json files under .claude/skills/
    const skillsDir = path.join(ROOT, '.claude', 'skills');
    const ownershipFiles = [];
    if (fs.existsSync(skillsDir)) {
      const walkDir = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walkDir(fullPath);
          } else if (entry.name === 'ownership.json') {
            ownershipFiles.push(fullPath);
          }
        }
      };
      walkDir(skillsDir);
    }

    for (const ownershipPath of ownershipFiles) {
      const ownership = JSON.parse(fs.readFileSync(ownershipPath, 'utf8'));
      const label = path.relative(ROOT, ownershipPath);

      for (const file of (ownership.files || [])) {
        assert.ok(!neverFiles.includes(file),
          label + ' declares file ' + file + ' which is in NEVER_WRITABLE');
      }
      for (const dir of (ownership.dirs || [])) {
        assert.ok(!neverDirs.includes(dir),
          label + ' declares dir ' + dir + ' which is in NEVER_WRITABLE_DIRS');
      }
    }
  });
});
