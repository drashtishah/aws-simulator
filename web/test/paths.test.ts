import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'path';
import paths from '../lib/paths';

describe('paths', () => {
  describe('static paths', () => {
    it('ROOT resolves to project root', () => {
      assert.ok(paths.ROOT.endsWith('aws-simulator') || paths.ROOT.includes('aws-simulator'));
    });

    it('SESSIONS_DIR is under LEARNING_DIR', () => {
      assert.ok(paths.SESSIONS_DIR.startsWith(paths.LEARNING_DIR));
    });

    it('REGISTRY points to sims/registry.json', () => {
      assert.ok(paths.REGISTRY.endsWith(path.join('sims', 'registry.json')));
    });

    it('PROFILE points to learning/profile.json', () => {
      assert.ok(paths.PROFILE.endsWith(path.join('learning', 'profile.json')));
    });

    it('NOTES_LOG_FILE points to learning/logs/notes.jsonl', () => {
      assert.ok(paths.NOTES_LOG_FILE.endsWith(path.join('learning', 'logs', 'notes.jsonl')));
    });
  });

  describe('dynamic helpers', () => {
    it('simDir returns sims/{id}', () => {
      assert.ok(paths.simDir('001').endsWith(path.join('sims', '001')));
    });

    it('manifest returns sims/{id}/manifest.json', () => {
      assert.ok(paths.manifest('001').endsWith(path.join('sims', '001', 'manifest.json')));
    });

    it('story returns sims/{id}/story.md', () => {
      assert.ok(paths.story('001').endsWith(path.join('sims', '001', 'story.md')));
    });

    it('theme returns themes/{id}.md', () => {
      assert.ok(paths.theme('calm-mentor').endsWith(path.join('themes', 'calm-mentor.md')));
    });

    it('sessionFile returns sessions/{id}/session.json', () => {
      assert.ok(paths.sessionFile('abc').endsWith(path.join('sessions', 'abc', 'session.json')));
    });

    it('transcriptFile returns sessions/{id}/transcript.jsonl', () => {
      assert.ok(paths.transcriptFile('abc').endsWith(path.join('sessions', 'abc', 'transcript.jsonl')));
    });

    it('sessionDir returns sessions/{id}', () => {
      assert.ok(paths.sessionDir('abc').endsWith(path.join('sessions', 'abc')));
    });
  });
});
