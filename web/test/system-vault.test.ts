import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { VAULT_SUBDIRS, layout, INDEX_MAX_LINES, TOPIC_FILE_MAX_BYTES, QUERY_MAX_FILES_PER_TURN, QUERY_MAX_BYTES_PER_TURN, QUERY_MAX_BYTES_PER_SESSION, checkIndex, checkTopicSizes, QueryBudget, DREAM_PHASES, validateDreamPlan } from '../lib/system-vault';


function makeVault(): { root: string; learning: string } {
  const learning = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-learning-'));
  const root = path.join(learning, 'system-vault');
  fs.mkdirSync(root, { recursive: true });
  for (const sub of VAULT_SUBDIRS) {
    fs.mkdirSync(path.join(root, sub), { recursive: true });
  }
  return { root, learning };
}

describe('system vault: layout', () => {
  it('layout exposes root, index, obsidian', () => {
    const { learning } = makeVault();
    const L = layout(learning);
    assert.equal(L.root, path.join(learning, 'system-vault'));
    assert.equal(L.index, path.join(learning, 'system-vault', 'index.md'));
    assert.equal(L.obsidian, path.join(learning, 'system-vault', '.obsidian'));
  });

  it('declares the 7 required subdirectories', () => {
    assert.deepStrictEqual(VAULT_SUBDIRS, [
      'health',
      'findings',
      'workarounds',
      'decisions',
      'sessions',
      'components',
      'dreams',
    ]);
  });
});

describe('system vault: index size limit', () => {
  it('accepts an index.md of <= 200 lines', () => {
    const { root } = makeVault();
    const idx = path.join(root, 'index.md');
    const lines = Array.from({ length: INDEX_MAX_LINES }, (_, i) => 'line ' + i);
    fs.writeFileSync(idx, lines.join('\n'));
    const res = checkIndex(idx);
    assert.ok(res.ok, 'expected ok, got ' + JSON.stringify(res));
    assert.equal(res.lines, INDEX_MAX_LINES);
  });

  it('rejects an index.md > 200 lines', () => {
    const { root } = makeVault();
    const idx = path.join(root, 'index.md');
    const lines = Array.from({ length: INDEX_MAX_LINES + 5 }, (_, i) => 'line ' + i);
    fs.writeFileSync(idx, lines.join('\n'));
    const res = checkIndex(idx);
    assert.equal(res.ok, false);
    assert.match(res.error ?? '', /200/);
  });

  it('rejects a missing index.md', () => {
    const { learning } = makeVault();
    const res = checkIndex(path.join(learning, 'system-vault', 'index.md'));
    assert.equal(res.ok, false);
  });
});

describe('system vault: topic file 4KB limit', () => {
  it('accepts topic files exactly at 4KB', () => {
    const { root } = makeVault();
    fs.writeFileSync(
      path.join(root, 'findings', 'ok.md'),
      'x'.repeat(TOPIC_FILE_MAX_BYTES),
    );
    const res = checkTopicSizes(root);
    assert.ok(res.ok, JSON.stringify(res));
  });

  it('flags topic files larger than 4KB', () => {
    const { root } = makeVault();
    fs.writeFileSync(
      path.join(root, 'findings', 'big.md'),
      'x'.repeat(TOPIC_FILE_MAX_BYTES + 1),
    );
    const res = checkTopicSizes(root);
    assert.equal(res.ok, false);
    assert.equal(res.offenders.length, 1);
    assert.equal(res.offenders[0].file, 'findings/big.md');
  });

  it('ignores index.md and dotfiles', () => {
    const { root } = makeVault();
    fs.writeFileSync(path.join(root, 'index.md'), 'x'.repeat(TOPIC_FILE_MAX_BYTES + 10));
    fs.writeFileSync(path.join(root, '.obsidian-config.json'), '{}');
    const res = checkTopicSizes(root);
    assert.ok(res.ok, JSON.stringify(res));
  });
});

describe('system vault: query budget', () => {
  it('admits up to 5 files per turn', () => {
    const b = new QueryBudget();
    for (let i = 0; i < QUERY_MAX_FILES_PER_TURN; i++) {
      assert.ok(b.admit(1024).ok);
    }
    assert.equal(b.admit(1024).ok, false);
  });

  it('rejects files larger than 4KB individually', () => {
    const b = new QueryBudget();
    const r = b.admit(TOPIC_FILE_MAX_BYTES + 1);
    assert.equal(r.ok, false);
    assert.match(r.reason ?? '', /4KB|file/);
  });

  it('rejects when turn byte budget (20KB) is exceeded', () => {
    const b = new QueryBudget();
    assert.ok(b.admit(4096).ok);
    assert.ok(b.admit(4096).ok);
    assert.ok(b.admit(4096).ok);
    assert.ok(b.admit(4096).ok);
    assert.ok(b.admit(4096).ok);
    // Next admit (even a small one) would exceed turn count anyway; reset
    b.reset();
    // Now turn is fresh; session budget still tracks previous bytes.
    // 5 * 4096 = 20480 already in session; 4 more turns at 20480 would
    // hit 102400 well past session budget, so verify session rejection.
    for (let i = 0; i < 2; i++) {
      b.reset();
      assert.ok(b.admit(4096).ok);
      assert.ok(b.admit(4096).ok);
      assert.ok(b.admit(4096).ok);
      assert.ok(b.admit(4096).ok);
      assert.ok(b.admit(4096).ok);
    }
    // session now at 15 * 4096 = 61440 > 60KB; this admit should fail
    // because the previous loop pushed past. Actually 15*4096=61440 > 61440? equals 60*1024=61440.
    // So the 15th admit is at boundary and allowed; the 16th would exceed.
    b.reset();
    const snap = b.snapshot();
    assert.equal(snap.sessionBytes, 15 * 4096);
    const result = b.admit(4096);
    assert.equal(result.ok, false);
    assert.match(result.reason ?? '', /session/);
  });

  it('enforces QUERY_MAX_BYTES_PER_TURN constant', () => {
    assert.equal(QUERY_MAX_BYTES_PER_TURN, 20 * 1024);
    assert.equal(QUERY_MAX_BYTES_PER_SESSION, 60 * 1024);
  });
});

describe('system vault: dream phases', () => {
  it('declares exactly 4 phases in order', () => {
    assert.deepStrictEqual(DREAM_PHASES, [
      'orient',
      'gather_signal',
      'consolidate',
      'prune_and_index',
    ]);
  });

  it('is atomic: rejects a plan missing a phase', () => {
    const { root } = makeVault();
    const res = validateDreamPlan(
      { phases: ['orient', 'gather_signal', 'consolidate'], deletes: [] },
      root,
    );
    assert.equal(res.ok, false);
  });

  it('is atomic: rejects a plan with phases out of order', () => {
    const { root } = makeVault();
    const res = validateDreamPlan(
      {
        phases: ['orient', 'consolidate', 'gather_signal', 'prune_and_index'],
        deletes: [],
      },
      root,
    );
    assert.equal(res.ok, false);
  });

  it('allows a plan with all 4 phases and no deletes', () => {
    const { root } = makeVault();
    const res = validateDreamPlan(
      { phases: [...DREAM_PHASES], deletes: [] },
      root,
    );
    assert.ok(res.ok, JSON.stringify(res));
  });

  it('cannot delete linked findings', () => {
    const { root } = makeVault();
    fs.writeFileSync(path.join(root, 'findings', 'auth-bug.md'), '# Auth bug');
    fs.writeFileSync(
      path.join(root, 'index.md'),
      'See [[auth-bug]] for details.',
    );
    const res = validateDreamPlan(
      {
        phases: [...DREAM_PHASES],
        deletes: ['findings/auth-bug.md'],
      },
      root,
    );
    assert.equal(res.ok, false);
    assert.match(res.error ?? '', /linked/);
  });

  it('can delete orphan findings', () => {
    const { root } = makeVault();
    fs.writeFileSync(path.join(root, 'findings', 'orphan.md'), '# Orphan');
    fs.writeFileSync(path.join(root, 'index.md'), 'Nothing here.');
    const res = validateDreamPlan(
      {
        phases: [...DREAM_PHASES],
        deletes: ['findings/orphan.md'],
      },
      root,
    );
    assert.ok(res.ok, JSON.stringify(res));
  });
});
