const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

// --- paths.js changes ---

describe('paths: session directory structure', () => {
  const paths = require('../lib/paths');

  it('sessionFile returns {id}/session.json path', () => {
    const result = paths.sessionFile('001-ec2-unreachable');
    assert.ok(result.endsWith(path.join('001-ec2-unreachable', 'session.json')));
  });

  it('transcriptFile returns {id}/transcript.jsonl path', () => {
    const result = paths.transcriptFile('001-ec2-unreachable');
    assert.ok(result.endsWith(path.join('001-ec2-unreachable', 'transcript.jsonl')));
  });

  it('sessionDir returns sessions/{id} path', () => {
    const result = paths.sessionDir('001-ec2-unreachable');
    assert.ok(result.endsWith(path.join('sessions', '001-ec2-unreachable')));
  });
});

// --- transcript.js ---

describe('transcript module', () => {
  let tmpDir;
  let transcript;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-transcript-'));
    const paths = require('../lib/paths');
    transcript = require('../lib/transcript');
    transcript._setSessionsDir(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete require.cache[require.resolve('../lib/transcript')];
  });

  it('appendTurn creates directory and writes JSONL', () => {
    transcript.appendTurn('001-test', {
      turn: 1,
      player: 'Show me EC2 status',
      narrator: 'The instance is running.',
      mode: 'narrator'
    });

    const file = path.join(tmpDir, '001-test', 'transcript.jsonl');
    assert.ok(fs.existsSync(file), 'transcript file should exist');

    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);

    const entry = JSON.parse(lines[0]);
    assert.equal(entry.turn, 1);
    assert.equal(entry.player, 'Show me EC2 status');
    assert.equal(entry.narrator, 'The instance is running.');
    assert.equal(entry.mode, 'narrator');
    assert.ok(entry.ts, 'should have timestamp');
  });

  it('appendTurn appends multiple turns', () => {
    transcript.appendTurn('002-test', { turn: 1, player: 'Q1', narrator: 'A1', mode: 'narrator' });
    transcript.appendTurn('002-test', { turn: 2, player: 'Q2', console: 'data', mode: 'console', service: 'ec2' });

    const file = path.join(tmpDir, '002-test', 'transcript.jsonl');
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    assert.equal(lines.length, 2);

    const entry2 = JSON.parse(lines[1]);
    assert.equal(entry2.turn, 2);
    assert.equal(entry2.console, 'data');
    assert.equal(entry2.service, 'ec2');
    assert.equal(entry2.mode, 'console');
  });

  it('readTranscript returns parsed entries', () => {
    transcript.appendTurn('003-test', { turn: 1, player: 'Q', narrator: 'A', mode: 'narrator' });
    transcript.appendTurn('003-test', { turn: 2, player: 'Q2', narrator: 'A2', mode: 'narrator' });

    const entries = transcript.readTranscript('003-test');
    assert.equal(entries.length, 2);
    assert.equal(entries[0].turn, 1);
    assert.equal(entries[1].turn, 2);
  });

  it('readTranscript returns empty array for missing sim', () => {
    const entries = transcript.readTranscript('nonexistent');
    assert.deepEqual(entries, []);
  });

  it('hasTranscript returns true when file exists', () => {
    transcript.appendTurn('004-test', { turn: 1, player: 'Q', narrator: 'A', mode: 'narrator' });
    assert.equal(transcript.hasTranscript('004-test'), true);
  });

  it('hasTranscript returns false when file missing', () => {
    assert.equal(transcript.hasTranscript('nonexistent'), false);
  });

  it('appendTurn sets null for missing optional fields', () => {
    transcript.appendTurn('005-test', { turn: 0, narrator: 'Opening narration', mode: 'narrator' });

    const entries = transcript.readTranscript('005-test');
    assert.equal(entries[0].player, null);
    assert.equal(entries[0].console, null);
    assert.equal(entries[0].coaching, null);
    assert.equal(entries[0].service, null);
  });
});
