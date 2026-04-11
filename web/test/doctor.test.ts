import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkRawLogAppendable, checkSystemVaultPresent, checkScheduledJobs, checkMcpConfig, checkPostCommitHook, checkHealthScoreRecent, checkPathRegistryFresh, checkSimTestSmoke, checkWebServerBoot, checkSkillDanglingRefs, checkPathRegistryHashFresh, formatCheckLine, runAll } from '../../scripts/doctor';
// Tests for scripts/doctor.ts (Group F of plan
// .claude/plans/replicated-exploring-thompson.md, Issue #96).
//
// Each check is a pure function that takes a context object (rootDir +
// optional injectable command runners) and returns { ok, name, detail }.
// Tests build a healthy fixture root in a temp directory, run each check,
// and assert OK; then introduce a single break and assert FAIL with the
// exact actionable path/command in the detail string. The user's
// requirement is that any FAIL must point at the fix.



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

  it('fail with hint to run /setup when index.md missing', () => {
    const root = buildHealthyFixture();
    fs.unlinkSync(path.join(root, 'learning', 'system-vault', 'index.md'));
    try {
      const r = checkSystemVaultPresent({ rootDir: root });
      assert.equal(r.ok, false);
      assert.match(r.detail, /learning\/system-vault\/index\.md/);
      assert.match(r.detail, /\/setup/);
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

// ---------------------------------------------------------------------------
// Integration checks (runIntegration flag) - Issue #105
// ---------------------------------------------------------------------------

describe('doctor integration checks (runIntegration)', () => {
  const okRunner = (_cmd: string, _args: string[], _opts: any) => ({
    status: 0,
    stdout: 'AWS Incident Simulator running at http://127.0.0.1:3200\n',
    stderr: '',
  });
  const failRunner = (_cmd: string, _args: string[], _opts: any) => ({
    status: 1,
    stdout: '',
    stderr: 'boom',
  });
  const silentRunner = (_cmd: string, _args: string[], _opts: any) => ({
    status: 0,
    stdout: 'nothing here',
    stderr: '',
  });

  it('checkSimTestSmoke returns OK when runner exits 0', () => {
    const root = buildHealthyFixture();
    try {
      const r = checkSimTestSmoke({ rootDir: root }, okRunner);
      assert.equal(r.ok, true);
    } finally {
      rmTmpDir(root);
    }
  });

  it('checkSimTestSmoke returns FAIL with test:file hint when non-zero', () => {
    const root = buildHealthyFixture();
    try {
      const r = checkSimTestSmoke({ rootDir: root }, failRunner);
      assert.equal(r.ok, false);
      assert.match(r.detail, /npm run test:file/);
      assert.match(r.detail, /path-registry\.test\.ts/);
    } finally {
      rmTmpDir(root);
    }
  });

  it('checkWebServerBoot returns OK when output contains "running at http://*:3200"', () => {
    const root = buildHealthyFixture();
    try {
      const r = checkWebServerBoot({ rootDir: root }, okRunner);
      assert.equal(r.ok, true);
    } finally {
      rmTmpDir(root);
    }
  });

  it('checkWebServerBoot returns FAIL when output lacks listening line', () => {
    const root = buildHealthyFixture();
    try {
      const r = checkWebServerBoot({ rootDir: root }, silentRunner);
      assert.equal(r.ok, false);
      assert.match(r.detail, /3200|port|npm run dev/i);
    } finally {
      rmTmpDir(root);
    }
  });

  it('checkSkillDanglingRefs returns OK on fixture with valid paths only', () => {
    const root = buildHealthyFixture();
    fs.mkdirSync(path.join(root, '.claude', 'skills', 'foo'), { recursive: true });
    fs.writeFileSync(path.join(root, 'real-file.md'), 'hi');
    fs.writeFileSync(
      path.join(root, '.claude', 'skills', 'foo', 'SKILL.md'),
      'See `real-file.md` and `https://example.com/x` for details.\n',
    );
    try {
      const r = checkSkillDanglingRefs({ rootDir: root });
      assert.equal(r.ok, true, r.detail);
    } finally {
      rmTmpDir(root);
    }
  });

  it('checkSkillDanglingRefs returns FAIL when SKILL.md references non-existent path', () => {
    const root = buildHealthyFixture();
    fs.mkdirSync(path.join(root, '.claude', 'skills', 'foo'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.claude', 'skills', 'foo', 'SKILL.md'),
      'See `references/does/not/exist.md` for details.\n',
    );
    try {
      const r = checkSkillDanglingRefs({ rootDir: root });
      assert.equal(r.ok, false);
      assert.match(r.detail, /does\/not\/exist\.md/);
    } finally {
      rmTmpDir(root);
    }
  });

  it('checkPathRegistryHashFresh returns OK when extractor produces identical hash', () => {
    const root = buildHealthyFixture();
    // no-op runner: doesn't mutate the csv, so hashes match
    const noopRunner = (_cmd: string, _args: string[], _opts: any) => ({
      status: 0, stdout: '', stderr: '',
    });
    try {
      const r = checkPathRegistryHashFresh({ rootDir: root }, noopRunner);
      assert.equal(r.ok, true, r.detail);
    } finally {
      rmTmpDir(root);
    }
  });

  it('checkPathRegistryHashFresh returns FAIL when extractor changes the file', () => {
    const root = buildHealthyFixture();
    const csvPath = path.join(root, 'references', 'registries', 'path-registry.csv');
    const mutatingRunner = (_cmd: string, _args: string[], _opts: any) => {
      fs.writeFileSync(csvPath, 'file,path,line_number\nextra,extra,1\n');
      return { status: 0, stdout: '', stderr: '' };
    };
    try {
      const r = checkPathRegistryHashFresh({ rootDir: root }, mutatingRunner);
      assert.equal(r.ok, false);
      assert.match(r.detail, /stale|extract-paths/);
      // backup must have been restored
      const restored = fs.readFileSync(csvPath, 'utf8');
      assert.equal(restored, 'file,path,line_number\n');
    } finally {
      rmTmpDir(root);
    }
  });

  it('runAll with runIntegration:true returns 11 results using stub runner', () => {
    const root = buildHealthyFixture();
    fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
    const stub = (_cmd: string, _args: string[], _opts: any) => ({
      status: 0, stdout: 'AWS Incident Simulator running at http://127.0.0.1:3200\n', stderr: '',
    });
    try {
      const summary = runAll({ rootDir: root, runIntegration: true, runner: stub });
      assert.equal(summary.results.length, 11, JSON.stringify(summary.results, null, 2));
    } finally {
      rmTmpDir(root);
    }
  });

  it('runAll with runIntegration:false returns 7 results', () => {
    const root = buildHealthyFixture();
    try {
      const summary = runAll({ rootDir: root, runIntegration: false });
      assert.equal(summary.results.length, 7);
    } finally {
      rmTmpDir(root);
    }
  });
});
