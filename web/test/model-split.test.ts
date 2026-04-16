import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as claudeProcess from '../lib/claude-process.ts';
// Asserts the model split is driven by scripts/model-config.json via named
// constants, not inline literals. See Issue #107, #270, #272.

const ROOT = path.join(__dirname, '..', '..');

describe('model split', () => {
  it('PLAY_SESSION_MODEL is claude-opus-4-6', () => {
    assert.equal(claudeProcess.PLAY_SESSION_MODEL, 'claude-opus-4-6');
  });

  it('POST_SESSION_MODEL is claude-opus-4-6', () => {
    assert.equal(claudeProcess.POST_SESSION_MODEL, 'claude-opus-4-6');
  });

  it('model-config.json: play=opus, post_session=opus', () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'model-config.json'), 'utf8'));
    assert.equal(cfg.play.model, 'claude-opus-4-6');
    assert.equal(cfg.post_session.model, 'claude-opus-4-6');
  });
});

describe('no stray model literals in claude-process.ts', () => {
  it('source contains no inline claude model literals (models come from MODEL_CONFIG)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'lib', 'claude-process.ts'),
      'utf8',
    );
    const stray = src.match(/'claude-(opus|sonnet|haiku)-[a-z0-9-]+'/g) ?? [];
    assert.deepEqual(
      stray,
      [],
      'found stray model literals: ' + JSON.stringify(stray),
    );
  });
});
