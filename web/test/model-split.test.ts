import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as claudeProcess from '../lib/claude-process.ts';
// Asserts the Sonnet/Opus model split is driven by scripts/model-config.json
// via named constants, not inline literals. See Issue #107. Sonnet drives
// interactive play, Opus runs post-session scoring. Do not flip without an
// A/B on quality.



describe('model split constants', () => {
  it('exports PLAY_SESSION_MODEL as claude-sonnet-4-6', () => {
    assert.equal(claudeProcess.PLAY_SESSION_MODEL, 'claude-sonnet-4-6');
  });

  it('exports POST_SESSION_MODEL as claude-opus-4-6', () => {
    assert.equal(claudeProcess.POST_SESSION_MODEL, 'claude-opus-4-6');
  });

  it('PLAY_SESSION_MODEL and POST_SESSION_MODEL differ (no aliasing)', () => {
    assert.notEqual(claudeProcess.PLAY_SESSION_MODEL, claudeProcess.POST_SESSION_MODEL);
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
