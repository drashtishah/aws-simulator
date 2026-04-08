// Asserts the Sonnet/Opus model split is hardcoded via named constants,
// not inline literals. See Issue #107. Sonnet drives interactive play,
// Opus runs post-session scoring. Do not flip without an A/B on quality.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const claudeProcess = require('../lib/claude-process.ts');

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
  it('source contains no single-quoted claude-(opus|sonnet)-* literals outside the two constant declarations', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'lib', 'claude-process.ts'),
      'utf8',
    );
    // Strip the two expected declarations.
    const stripped = src
      .replace(/export const PLAY_SESSION_MODEL = 'claude-sonnet-4-6';/g, '')
      .replace(/export const POST_SESSION_MODEL = 'claude-opus-4-6';/g, '');
    const stray = stripped.match(/'claude-(opus|sonnet)-[a-z0-9-]+'/g) ?? [];
    assert.deepEqual(
      stray,
      [],
      'found stray model literals: ' + JSON.stringify(stray),
    );
  });
});
