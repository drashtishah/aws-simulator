import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import { scoreReferencesHealth, main } from '../../scripts/code-health';
'use strict';



const ROOT = path.resolve(__dirname, '..', '..');

describe('scoreReferencesHealth', () => {
  it('returns a score between 0 and 100 for the real workspace', () => {
    const result = scoreReferencesHealth(ROOT);
    assert.ok(typeof result.score === 'number', 'score is numeric');
    assert.ok(result.score >= 0 && result.score <= 100, 'score in [0,100]');
    assert.ok(result.sub, 'has sub metrics');
    assert.ok(typeof result.sub.unlisted_files === 'number');
    assert.ok(typeof result.sub.missing_targets === 'number');
    assert.ok(typeof result.sub.stale_files === 'number');
  });

  it('returns 100 minus penalties when given a synthetic root', () => {
    const tmp = path.join(ROOT, 'learning', 'logs', '_refs_health_tmp');
    const refs = path.join(tmp, 'references');
    const reg = path.join(refs, 'registries');
    fs.mkdirSync(reg, { recursive: true });
    try {
      // Create one file that IS listed and one that is NOT
      fs.writeFileSync(path.join(refs, 'listed.md'), '# listed\n');
      fs.writeFileSync(path.join(refs, 'unlisted.md'), '# unlisted\n');
      // Make listed.md ancient (>180 days) by setting mtime
      const oldTime = new Date(Date.now() - 200 * 24 * 3600 * 1000);
      fs.utimesSync(path.join(refs, 'listed.md'), oldTime, oldTime);
      // Index lists listed.md and a missing target
      fs.writeFileSync(
        path.join(reg, 'agent-index.md'),
        '# Agent Index\n\n`references/listed.md`\n`references/does-not-exist.md`\n'
      );

      const result = scoreReferencesHealth(tmp);
      // 1 unlisted (-10), 1 missing target (-10), 1 stale (-5) = 75
      assert.equal(result.sub.unlisted_files, 1);
      assert.equal(result.sub.missing_targets, 1);
      assert.equal(result.sub.stale_files, 1);
      assert.equal(result.score, 75);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('floors the score at 0', () => {
    const tmp = path.join(ROOT, 'learning', 'logs', '_refs_health_tmp2');
    const refs = path.join(tmp, 'references');
    const reg = path.join(refs, 'registries');
    fs.mkdirSync(reg, { recursive: true });
    try {
      // 20 unlisted files = -200 penalty, should floor at 0
      for (let i = 0; i < 20; i++) {
        fs.writeFileSync(path.join(refs, `f${i}.md`), '# x\n');
      }
      fs.writeFileSync(path.join(reg, 'agent-index.md'), '# empty\n');
      const result = scoreReferencesHealth(tmp);
      assert.equal(result.score, 0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('main composite includes references_health', () => {
  it('reports references_health in the scores object', () => {
    // Capture stdout to silence
    const origLog = console.log;
    console.log = () => {};
    try {
      const report = main();
      assert.ok(report.scores.references_health, 'has references_health key');
      assert.ok(typeof report.scores.references_health.score === 'number');
    } finally {
      console.log = origLog;
    }
  });
});
