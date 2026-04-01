#!/usr/bin/env node
// Generate design reference files (screenshots, a11y trees) from live app.
// This file is NEVER_WRITABLE. Run via: sim-test design generate

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DESIGN_DIR = path.join(ROOT, 'design');
const SCREENSHOTS_DIR = path.join(DESIGN_DIR, 'screenshots');
const A11Y_DIR = path.join(DESIGN_DIR, 'a11y');
const MANIFEST_PATH = path.join(DESIGN_DIR, 'manifest.json');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function sha256(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function updateManifest() {
  const manifest = { version: 1, generated: new Date().toISOString(), files: {} };

  // Walk design/ for all files except manifest.json itself
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (fullPath !== MANIFEST_PATH) {
        const relPath = path.relative(DESIGN_DIR, fullPath);
        manifest.files[relPath] = sha256(fullPath);
      }
    }
  }
  walk(DESIGN_DIR);

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  console.log('Manifest updated: ' + Object.keys(manifest.files).length + ' files');
}

function main() {
  ensureDir(SCREENSHOTS_DIR);
  ensureDir(A11Y_DIR);

  console.log('Design reference generation requires a running app and Chrome DevTools MCP.');
  console.log('');
  console.log('To capture references manually:');
  console.log('  1. Start the app: npm start');
  console.log('  2. Use Chrome DevTools MCP to navigate and take_screenshot');
  console.log('  3. Save screenshots to design/screenshots/');
  console.log('  4. Save a11y trees to design/a11y/');
  console.log('  5. Run this script again to update the manifest');
  console.log('');

  // Always update the manifest with whatever files exist
  updateManifest();
}

main();
