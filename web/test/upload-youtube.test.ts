import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { readEnvFlag, parseClientSecret, discoverVideos } from '../../scripts/upload-youtube';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-upload-'));

describe('readEnvFlag', () => {
  const envPath = path.join(tmp, '.env');

  it('returns false when file does not exist', () => {
    assert.equal(readEnvFlag('/nonexistent/.env'), false);
  });

  it('returns false when YOUTUBE_UPLOAD=false', () => {
    fs.writeFileSync(envPath, 'YOUTUBE_UPLOAD=false\n');
    assert.equal(readEnvFlag(envPath), false);
  });

  it('returns true when YOUTUBE_UPLOAD=true', () => {
    fs.writeFileSync(envPath, 'YOUTUBE_UPLOAD=true\n');
    assert.equal(readEnvFlag(envPath), true);
  });
});

describe('parseClientSecret', () => {
  it('extracts credentials from installed key', () => {
    const json = JSON.stringify({ installed: { client_id: 'id1', client_secret: 's1' } });
    const result = parseClientSecret(json);
    assert.deepEqual(result, { client_id: 'id1', client_secret: 's1' });
  });

  it('extracts credentials from web key', () => {
    const json = JSON.stringify({ web: { client_id: 'id2', client_secret: 's2' } });
    const result = parseClientSecret(json);
    assert.deepEqual(result, { client_id: 'id2', client_secret: 's2' });
  });

  it('prefers installed over web when both present', () => {
    const json = JSON.stringify({
      installed: { client_id: 'inst', client_secret: 'si' },
      web: { client_id: 'web', client_secret: 'sw' },
    });
    assert.equal(parseClientSecret(json).client_id, 'inst');
  });

  it('throws when neither key is present', () => {
    assert.throws(() => parseClientSecret('{}'), /no installed or web key/);
  });

  it('throws on invalid JSON', () => {
    assert.throws(() => parseClientSecret('not json'));
  });
});

describe('discoverVideos', () => {
  const videoDir = path.join(tmp, 'videos');

  it('returns empty array when directory does not exist', () => {
    assert.deepEqual(discoverVideos('/nonexistent/videos'), []);
  });

  it('returns only .mp4 files', () => {
    fs.mkdirSync(videoDir, { recursive: true });
    fs.writeFileSync(path.join(videoDir, 'session1.mp4'), '');
    fs.writeFileSync(path.join(videoDir, 'session2.mp4'), '');
    fs.writeFileSync(path.join(videoDir, 'notes.txt'), '');
    fs.writeFileSync(path.join(videoDir, 'thumb.png'), '');
    const result = discoverVideos(videoDir);
    assert.deepEqual(result.sort(), ['session1.mp4', 'session2.mp4']);
  });

  it('returns empty array when no .mp4 files exist', () => {
    const emptyDir = path.join(tmp, 'empty');
    fs.mkdirSync(emptyDir, { recursive: true });
    fs.writeFileSync(path.join(emptyDir, 'readme.md'), '');
    assert.deepEqual(discoverVideos(emptyDir), []);
  });
});
