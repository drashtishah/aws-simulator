const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const DESIGN_DIR = path.join(ROOT, 'design');
const MANIFEST_PATH = path.join(DESIGN_DIR, 'manifest.json');

function sha256(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

describe('design integrity', () => {
  it('manifest.json exists and is valid JSON', () => {
    assert.ok(fs.existsSync(MANIFEST_PATH), 'design/manifest.json should exist');
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    assert.ok(manifest.version, 'manifest should have a version field');
    assert.ok(typeof manifest.files === 'object', 'manifest should have a files object');
  });

  it('all files listed in manifest exist on disk', () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    for (const [relPath] of Object.entries(manifest.files)) {
      const fullPath = path.join(DESIGN_DIR, relPath);
      assert.ok(fs.existsSync(fullPath), 'File listed in manifest should exist: ' + relPath);
    }
  });

  it('checksums match for all files in manifest', () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    for (const [relPath, expectedHash] of Object.entries(manifest.files)) {
      const fullPath = path.join(DESIGN_DIR, relPath);
      if (!fs.existsSync(fullPath)) continue; // covered by previous test
      const actualHash = sha256(fullPath);
      assert.equal(actualHash, expectedHash, 'Checksum mismatch for ' + relPath);
    }
  });

  it('thresholds.json exists and has required sections', () => {
    const thresholdsPath = path.join(DESIGN_DIR, 'thresholds.json');
    assert.ok(fs.existsSync(thresholdsPath), 'design/thresholds.json should exist');
    const thresholds = JSON.parse(fs.readFileSync(thresholdsPath, 'utf8'));
    assert.ok(thresholds.similarity, 'thresholds should have similarity section');
    assert.ok(thresholds.a11y, 'thresholds should have a11y section');
  });
});
