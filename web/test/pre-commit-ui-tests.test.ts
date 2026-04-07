const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync, execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const HOOK = path.join(ROOT, '.claude', 'hooks', 'pre-commit-ui-tests.ts');
const ARTIFACT = path.join(ROOT, 'web', 'test-results', 'agent-browser-latest.json');

function runHook(payload: object) {
  return spawnSync('npx', ['tsx', HOOK], {
    cwd: ROOT,
    input: JSON.stringify(payload),
    encoding: 'utf8'
  });
}

function bashPayload(command: string) {
  return { tool_name: 'Bash', tool_input: { command } };
}

let savedArtifact: string | null = null;

before(() => {
  if (fs.existsSync(ARTIFACT)) {
    savedArtifact = fs.readFileSync(ARTIFACT, 'utf8');
  }
});

after(() => {
  if (savedArtifact !== null) {
    fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
    fs.writeFileSync(ARTIFACT, savedArtifact);
  } else if (fs.existsSync(ARTIFACT)) {
    fs.unlinkSync(ARTIFACT);
  }
});

function clearArtifact() {
  if (fs.existsSync(ARTIFACT)) fs.unlinkSync(ARTIFACT);
}

function writeArtifact(obj: object) {
  fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
  fs.writeFileSync(ARTIFACT, JSON.stringify(obj));
}

function currentHead(): string {
  return execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
}

// We can't easily mutate `git diff --cached`. Instead, the hook reads staged
// files via git; in CI/dev there are typically no staged UI files. We test
// the no-UI-staged path and the artifact-validation paths by injecting an
// env override the hook honors for testing: PRE_COMMIT_UI_TESTS_FORCE_UI=1.

describe('pre-commit-ui-tests hook', () => {
  it('exits 0 when command is not git commit', () => {
    const r = runHook(bashPayload('npm test'));
    assert.equal(r.status, 0);
  });

  it('exits 0 when git commit but no UI files staged', () => {
    // Real git diff --cached on the test environment should not include UI files.
    const r = runHook(bashPayload('git commit -m "test"'));
    assert.equal(r.status, 0, r.stderr);
  });

  it('exits 2 when UI files staged and no artifact exists', () => {
    clearArtifact();
    const r = spawnSync('npx', ['tsx', HOOK], {
      cwd: ROOT,
      input: JSON.stringify(bashPayload('git commit -m "x"')),
      encoding: 'utf8',
      env: { ...process.env, PRE_COMMIT_UI_TESTS_FORCE_UI: '1' }
    });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /no recent browser test run/i);
  });

  it('exits 2 when artifact status is fail', () => {
    writeArtifact({
      status: 'fail',
      committed_at_head: currentHead(),
      staged_files_hash: 'whatever',
      failed_specs: ['home', 'session'],
      ran_at: new Date().toISOString()
    });
    const r = spawnSync('npx', ['tsx', HOOK], {
      cwd: ROOT,
      input: JSON.stringify(bashPayload('git commit -m "x"')),
      encoding: 'utf8',
      env: { ...process.env, PRE_COMMIT_UI_TESTS_FORCE_UI: '1' }
    });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /failed/i);
    assert.match(r.stderr, /home/);
  });

  it('exits 2 when artifact is stale (HEAD differs and hash differs)', () => {
    writeArtifact({
      status: 'pass',
      committed_at_head: '0000000000000000000000000000000000000000',
      staged_files_hash: 'deadbeef',
      failed_specs: [],
      ran_at: new Date().toISOString()
    });
    const r = spawnSync('npx', ['tsx', HOOK], {
      cwd: ROOT,
      input: JSON.stringify(bashPayload('git commit -m "x"')),
      encoding: 'utf8',
      env: { ...process.env, PRE_COMMIT_UI_TESTS_FORCE_UI: '1' }
    });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /stale/i);
  });

  it('exits 0 when artifact is fresh and status is pass', () => {
    // Compute the real hash by running summarizer.
    const summarize = spawnSync('npx', ['tsx', path.join(ROOT, 'scripts', 'agent-browser-summarize.ts'), '--status', 'pass'], {
      cwd: ROOT,
      encoding: 'utf8'
    });
    assert.equal(summarize.status, 0, summarize.stderr);
    const r = spawnSync('npx', ['tsx', HOOK], {
      cwd: ROOT,
      input: JSON.stringify(bashPayload('git commit -m "x"')),
      encoding: 'utf8',
      env: { ...process.env, PRE_COMMIT_UI_TESTS_FORCE_UI: '1' }
    });
    assert.equal(r.status, 0, r.stderr);
  });
});
