// Tests for scripts/doctor.ts (Group F of plan
// .claude/plans/replicated-exploring-thompson.md, Issue #96).
//
// Each check is a pure function that takes a context object (rootDir +
// optional injectable command runners) and returns { ok, name, detail }.
// Tests build a healthy fixture root in a temp directory, run each check,
// and assert OK; then introduce a single break and assert FAIL with the
// exact actionable path/command in the detail string. The user's
// requirement is that any FAIL must point at the fix.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  checkRawLogAppendable,
  checkSystemVaultPresent,
  checkScheduledJobs,
  checkMcpConfig,
  checkPostCommitHook,
  checkHealthScoreRecent,
  checkPathRegistryFresh,
  formatCheckLine,
  runAll,
} = require('../../scripts/doctor');

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-test-'));
}

function rmTmpDir(dir: string): void {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function writeJson(p: string, data: unknown): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function buildHealthyFixture(): string {
  const root = mkTmpDir();

  // raw.jsonl exists and is appendable.
  fs.mkdirSync(path.join(root, 'learning', 'logs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'learning', 'logs', 'raw.jsonl'), '');

  // health-scores.jsonl with a recent entry.
  const recentEntry = JSON.stringify({
    ts: new Date().toISOString(),
    composite: 92.5,
  });
  fs.writeFileSync(path.join(root, 'learning', 'logs', 'health-scores.jsonl'), recentEntry + '\n');

  // system vault index present.
  fs.mkdirSync(path.join(root, 'learning', 'system-vault'), { recursive: true });
  fs.writeFileSync(path.join(root, 'learning', 'system-vault', 'index.md'), '# index\n');

  // scheduled jobs manifest with allowed_tools.
  writeJson(path.join(root, '.claude', 'scheduled-jobs', 'daily-test.json'), {
    name: 'daily-test',
    cron: '0 3 * * *',
    allowed_tools: ['Read', 'Write'],
  });

  // .mcp.json with two servers, one local cmd one remote url.
  writeJson(path.join(root, '.mcp.json'), {
    mcpServers: {
      remote: { url: 'https://example.com/mcp', type: 'http' },
      local: { command: 'node', args: ['--version'] },
    },
  });

  // Post-commit hook installed (matches source).
  fs.mkdirSync(path.join(root, '.claude', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'hooks', 'post-commit'), '#!/bin/sh\necho ok\n');
  fs.mkdirSync(path.join(root, '.git', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.git', 'hooks', 'post-commit'), '#!/bin/sh\necho ok\n');

  // Path registry fresh (no diff against extract_paths output).
  fs.mkdirSync(path.join(root, 'references', 'registries'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'references', 'registries', 'path-registry.csv'),
    'file,path,line_number\n',
  );

  return root;
}

// ---------------------------------------------------------------------------
// Individual check tests
// ---------------------------------------------------------------------------

describe('checkRawLogAppendable', () => {
  it('returns ok=true when raw.jsonl exists', () => {
    const root = buildHealthyFixture();
    try {
      const r = checkRawLogAppendable({ rootDir: root });
      assert.equal(r.ok, true, r.detail);
    } finally {
      rmTmpDir(root);
    }
  });

  it('returns ok=false with the missing path in detail', () => {
    const root = buildHealthyFixture();
    fs.unlinkSync(path.join(root, 'learning', 'logs', 'raw.jsonl'));
    try {
      const r = checkRawLogAppendable({ rootDir: root });
      assert.equal(r.ok, false);
      assert.match(r.detail, /learning\/logs\/raw\.jsonl/);
    } finally {
      rmTmpDir(root);
    }
  });
});

describe('checkSystemVaultPresent', () => {
  it('ok when learning/system-vault/index.md exists', () => {
    const root = buildHealthyFixture();
    try {
      const r = checkSystemVaultPresent({ rootDir: root });
      assert.equal(r.ok, true);
    } finally {
      rmTmpDir(root);
    }
  });

  it('fail with hint to run system-vault-compile when index.md missing', () => {
    const root = buildHealthyFixture();
    fs.unlinkSync(path.join(root, 'learning', 'system-vault', 'index.md'));
    try {
      const r = checkSystemVaultPresent({ rootDir: root });
      assert.equal(r.ok, false);
      assert.match(r.detail, /learning\/system-vault\/index\.md/);
      assert.match(r.detail, /system-vault-compile/);
    } finally {
      rmTmpDir(root);
    }
  });
});

describe('checkScheduledJobs', () => {
  it('ok when every manifest has allowed_tools', () => {
    const root = buildHealthyFixture();
    try {
      const r = checkScheduledJobs({ rootDir: root });
      assert.equal(r.ok, true);
    } finally {
      rmTmpDir(root);
    }
  });

  it('fail when a manifest is missing allowed_tools', () => {
    const root = buildHealthyFixture();
    writeJson(path.join(root, '.claude', 'scheduled-jobs', 'broken.json'), {
      name: 'broken',
      cron: '0 0 * * *',
    });
    try {
      const r = checkScheduledJobs({ rootDir: root });
      assert.equal(r.ok, false);
      assert.match(r.detail, /broken\.json/);
      assert.match(r.detail, /allowed_tools/);
    } finally {
      rmTmpDir(root);
    }
  });

  it('fail when a manifest is unparseable, naming the file', () => {
    const root = buildHealthyFixture();
    fs.writeFileSync(path.join(root, '.claude', 'scheduled-jobs', 'malformed.json'), '{not json');
    try {
      const r = checkScheduledJobs({ rootDir: root });
      assert.equal(r.ok, false);
      assert.match(r.detail, /malformed\.json/);
    } finally {
      rmTmpDir(root);
    }
  });
});

describe('checkMcpConfig', () => {
  it('ok when .mcp.json parses and has mcpServers', () => {
    const root = buildHealthyFixture();
    try {
      const r = checkMcpConfig({ rootDir: root });
      assert.equal(r.ok, true);
    } finally {
      rmTmpDir(root);
    }
  });

  it('fail when .mcp.json is missing, naming the file', () => {
    const root = buildHealthyFixture();
    fs.unlinkSync(path.join(root, '.mcp.json'));
    try {
      const r = checkMcpConfig({ rootDir: root });
      assert.equal(r.ok, false);
      assert.match(r.detail, /\.mcp\.json/);
    } finally {
      rmTmpDir(root);
    }
  });

  it('fail when .mcp.json is malformed', () => {
    const root = buildHealthyFixture();
    fs.writeFileSync(path.join(root, '.mcp.json'), '{not json');
    try {
      const r = checkMcpConfig({ rootDir: root });
      assert.equal(r.ok, false);
      assert.match(r.detail, /\.mcp\.json/);
    } finally {
      rmTmpDir(root);
    }
  });
});

describe('checkPostCommitHook', () => {
  it('ok when .git/hooks/post-commit exists and matches source', () => {
    const root = buildHealthyFixture();
    try {
      const r = checkPostCommitHook({ rootDir: root });
      assert.equal(r.ok, true);
    } finally {
      rmTmpDir(root);
    }
  });

  it('fail when .git/hooks/post-commit is missing, with install hint', () => {
    const root = buildHealthyFixture();
    fs.unlinkSync(path.join(root, '.git', 'hooks', 'post-commit'));
    try {
      const r = checkPostCommitHook({ rootDir: root });
      assert.equal(r.ok, false);
      assert.match(r.detail, /npm run install-git-hooks/);
    } finally {
      rmTmpDir(root);
    }
  });

  it('fail when .git/hooks/post-commit drifted from source', () => {
    const root = buildHealthyFixture();
    fs.writeFileSync(path.join(root, '.git', 'hooks', 'post-commit'), '#!/bin/sh\necho stale\n');
    try {
      const r = checkPostCommitHook({ rootDir: root });
      assert.equal(r.ok, false);
      assert.match(r.detail, /drifted|stale|differs/i);
      assert.match(r.detail, /npm run install-git-hooks/);
    } finally {
      rmTmpDir(root);
    }
  });
});

describe('checkHealthScoreRecent', () => {
  it('ok when latest entry is within 7 days', () => {
    const root = buildHealthyFixture();
    try {
      const r = checkHealthScoreRecent({ rootDir: root });
      assert.equal(r.ok, true);
    } finally {
      rmTmpDir(root);
    }
  });

  it('warn (ok=true with warning detail) when older than 7 days', () => {
    const root = buildHealthyFixture();
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(
      path.join(root, 'learning', 'logs', 'health-scores.jsonl'),
      JSON.stringify({ ts: old, composite: 90 }) + '\n',
    );
    try {
      const r = checkHealthScoreRecent({ rootDir: root });
      // Warn-only per the plan: ok stays true so doctor does not exit non-zero.
      assert.equal(r.ok, true);
      assert.match(r.detail, /stale|days|warn/i);
    } finally {
      rmTmpDir(root);
    }
  });

  it('fail when health-scores.jsonl is missing', () => {
    const root = buildHealthyFixture();
    fs.unlinkSync(path.join(root, 'learning', 'logs', 'health-scores.jsonl'));
    try {
      const r = checkHealthScoreRecent({ rootDir: root });
      assert.equal(r.ok, false);
      assert.match(r.detail, /health-scores\.jsonl/);
      assert.match(r.detail, /npm run health/);
    } finally {
      rmTmpDir(root);
    }
  });
});

describe('checkPathRegistryFresh', () => {
  it('ok when registry exists', () => {
    const root = buildHealthyFixture();
    try {
      const r = checkPathRegistryFresh({ rootDir: root });
      assert.equal(r.ok, true);
    } finally {
      rmTmpDir(root);
    }
  });

  it('fail with regen hint when registry missing', () => {
    const root = buildHealthyFixture();
    fs.unlinkSync(path.join(root, 'references', 'registries', 'path-registry.csv'));
    try {
      const r = checkPathRegistryFresh({ rootDir: root });
      assert.equal(r.ok, false);
      assert.match(r.detail, /path-registry\.csv/);
      assert.match(r.detail, /npm run extract-paths/);
    } finally {
      rmTmpDir(root);
    }
  });
});

// ---------------------------------------------------------------------------
// Output formatting + runAll wiring
// ---------------------------------------------------------------------------

describe('formatCheckLine', () => {
  it('formats an OK line as "OK <name>: <detail>"', () => {
    const line = formatCheckLine({ ok: true, name: 'raw_log', detail: 'present' });
    assert.match(line, /^OK\b/);
    assert.match(line, /raw_log/);
    assert.match(line, /present/);
  });

  it('formats a FAIL line as "FAIL <name>: <detail>"', () => {
    const line = formatCheckLine({ ok: false, name: 'raw_log', detail: 'missing learning/logs/raw.jsonl' });
    assert.match(line, /^FAIL\b/);
    assert.match(line, /raw_log/);
    assert.match(line, /learning\/logs\/raw\.jsonl/);
  });
});

describe('runAll', () => {
  it('returns exitCode 0 when every check is ok', () => {
    const root = buildHealthyFixture();
    try {
      const summary = runAll({ rootDir: root, runIntegration: false });
      assert.equal(summary.exitCode, 0, 'expected exit 0 but got fails: ' +
        JSON.stringify(summary.results.filter((r: { ok: boolean }) => !r.ok), null, 2));
      assert.ok(summary.results.length > 0, 'should run at least one check');
      assert.ok(summary.results.every((r: { ok: boolean }) => r.ok));
    } finally {
      rmTmpDir(root);
    }
  });

  it('returns exitCode 1 when any required check fails', () => {
    const root = buildHealthyFixture();
    fs.unlinkSync(path.join(root, 'learning', 'logs', 'raw.jsonl'));
    try {
      const summary = runAll({ rootDir: root, runIntegration: false });
      assert.equal(summary.exitCode, 1);
      const failed = summary.results.filter((r: { ok: boolean }) => !r.ok);
      assert.ok(failed.length >= 1);
      assert.ok(
        failed.some((r: { detail: string }) => /learning\/logs\/raw\.jsonl/.test(r.detail)),
        'failed checks should mention raw.jsonl',
      );
    } finally {
      rmTmpDir(root);
    }
  });
});
