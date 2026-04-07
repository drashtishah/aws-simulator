const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SETTINGS_PATH = path.join(ROOT, '.claude', 'settings.json');

// Hooks introduced by PR-Pre that MUST carry explicit allowed_tools.
// Keyed by a substring match against the hook command string.
// PostCommit is NOT a valid Claude Code hook event (tracked as a pending
// item; system-vault-compile on commit must become either a real git
// post-commit hook or a PostToolUse hook filtered on git commit).
//
// Empty after Commit 1 of fluffy-hugging-wilkes plan: the dream-check
// SessionStart hook was a dangling reference to a script that never
// existed. Commit 8 of the same plan re-populates this array with the
// new Stop:stop-journal-check hook entry.
const REQUIRED_HOOKS: Array<{ event: string; commandMatch: string }> = [];

function loadSettings(): any {
  assert.ok(fs.existsSync(SETTINGS_PATH), `${SETTINGS_PATH} must exist`);
  return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
}

function* iterHookEntries(settings: any): Generator<{ event: string; entry: any; hook: any }> {
  const hooks = settings.hooks || {};
  for (const event of Object.keys(hooks)) {
    for (const entry of hooks[event] || []) {
      for (const h of entry.hooks || []) {
        yield { event, entry, hook: h };
      }
    }
  }
}

describe('hook permissions (PR-Pre)', () => {
  it('.claude/settings.json exists and parses', () => {
    const s = loadSettings();
    assert.ok(typeof s === 'object');
    assert.ok(s.hooks, 'settings.hooks must exist');
  });

  it('every hook command entry has a non-empty allowed_tools array', () => {
    const s = loadSettings();
    for (const { event, hook } of iterHookEntries(s)) {
      assert.ok(
        Array.isArray(hook.allowed_tools),
        `${event}: hook ${hook.command} must declare allowed_tools array`,
      );
      assert.ok(
        hook.allowed_tools.length > 0,
        `${event}: hook ${hook.command} allowed_tools must be non-empty`,
      );
    }
    // Commit 8 of fluffy-hugging-wilkes will re-add the count > 0 assertion
    // once the new Stop hook is wired in. Until then, an empty hooks block
    // is the intended state.
  });

  it('no hook grants wildcard tool access', () => {
    const s = loadSettings();
    for (const { event, hook } of iterHookEntries(s)) {
      for (const tool of hook.allowed_tools || []) {
        assert.notEqual(tool, '*', `${event}: wildcard tool forbidden in ${hook.command}`);
      }
    }
  });

  it('no hook command contains --dangerously-skip-permissions', () => {
    const s = loadSettings();
    const raw = JSON.stringify(s);
    assert.ok(
      !raw.includes('dangerously-skip-permissions'),
      'settings.json must not contain --dangerously-skip-permissions',
    );
  });

  it('every hook entry declares cwd and timeout', () => {
    const s = loadSettings();
    for (const { event, hook } of iterHookEntries(s)) {
      assert.ok(typeof hook.cwd === 'string' && hook.cwd.length > 0, `${event}: cwd required`);
      assert.ok(typeof hook.timeout === 'number' && hook.timeout > 0, `${event}: timeout required`);
    }
  });

  it('required PR-Pre hooks are present with matching commands', () => {
    const s = loadSettings();
    for (const req of REQUIRED_HOOKS) {
      let found = false;
      for (const { event, hook } of iterHookEntries(s)) {
        if (event === req.event && (hook.command || '').includes(req.commandMatch)) {
          found = true;
          break;
        }
      }
      assert.ok(found, `missing required hook ${req.event}:${req.commandMatch}`);
    }
  });
});
