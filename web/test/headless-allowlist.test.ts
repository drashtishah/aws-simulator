const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Drift check for Issue #127: every Edit(...) path the
// .claude/settings.json permissions.allow list exposes to headless
// `claude -p --permission-mode acceptEdits` sessions must have a
// matching row in references/registries/headless-edit-allowlist.md.
// The registry row is the audit record: who decided the file is safe,
// when, and why. Drift between these two files means either a path was
// allowlisted without audit or the audit was recorded for a path that
// is no longer allowlisted.
//
// This is intentionally NOT a bidirectional equality check. Registry
// entries for paths not in settings.json are treated as historical
// removals (the file was audited once, then removed from the allow
// list); only the forward direction (allow -> registry) is load-bearing
// because that is the one that prevents silent broadening.

const ROOT = path.resolve(__dirname, '..', '..');
const SETTINGS_PATH = path.join(ROOT, '.claude', 'settings.json');
const REGISTRY_PATH = path.join(ROOT, 'references', 'registries', 'headless-edit-allowlist.md');

function extractEditPaths(allowList: unknown): string[] {
  if (!Array.isArray(allowList)) return [];
  const out: string[] = [];
  for (const entry of allowList) {
    if (typeof entry !== 'string') continue;
    const match = entry.match(/^Edit\((.+)\)$/);
    if (match && match[1]) out.push(match[1]);
  }
  return out;
}

describe('headless edit allowlist drift (Issue #127)', () => {
  it('.claude/settings.json parses', () => {
    assert.ok(fs.existsSync(SETTINGS_PATH), `${SETTINGS_PATH} must exist`);
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    assert.equal(typeof parsed, 'object');
  });

  it('headless-edit-allowlist.md registry exists with a table header', () => {
    assert.ok(fs.existsSync(REGISTRY_PATH), `${REGISTRY_PATH} must exist`);
    const registry = fs.readFileSync(REGISTRY_PATH, 'utf8');
    assert.ok(
      registry.includes('| Path | Kind | Audit date | Reviewer | Rationale |'),
      'registry must contain the standard audit table header',
    );
  });

  it('every Edit(...) path in permissions.allow has a matching registry row', () => {
    const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    const allow = settings.permissions?.allow;
    const editPaths = extractEditPaths(allow);
    const registry = fs.readFileSync(REGISTRY_PATH, 'utf8');

    // Vacuously true when the allow list is empty. This is by design:
    // the test has no opinion about whether any allow list exists, only
    // about whether each entry is justified when one does. When the
    // first entry lands (Issue #127 adds
    // Edit(.claude/hooks/plan-exit-reminder.ts)), this loop becomes the
    // load-bearing drift guard.
    for (const p of editPaths) {
      assert.ok(
        registry.includes('`' + p + '`'),
        `allowlisted Edit path ${p} is missing from ${path.relative(ROOT, REGISTRY_PATH)}; ` +
          'add an audit row before extending the allow list.',
      );
    }
  });

  it('permissions.allow does NOT allowlist enforcement or fs-writing hooks', () => {
    const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    const editPaths = extractEditPaths(settings.permissions?.allow);

    // Hooks excluded per Issue #127 audit: either they enforce an
    // invariant (pre-commit, Stop, SessionStart) or they use fs.write
    // outside stdout. git-discipline-reminder.ts falls in the second
    // category (fs.writeFileSync for a session marker file).
    const forbidden = [
      '.claude/hooks/guard-write.ts',
      '.claude/hooks/log-hook.ts',
      '.claude/hooks/pre-commit-issues.ts',
      '.claude/hooks/pre-commit-ui-tests.ts',
      '.claude/hooks/stop-journal-check.ts',
      '.claude/hooks/git-discipline-reminder.ts',
      '.claude/hooks/emotion-check.ts',
    ];
    for (const p of forbidden) {
      assert.ok(
        !editPaths.includes(p),
        `${p} must NOT be allowlisted: it either enforces an invariant ` +
          'or writes outside stdout.',
      );
    }
  });
});
