#!/usr/bin/env node
// Parse Stitch HTML into structural contract JSON files.
// This file is NEVER_WRITABLE. Run via: sim-test design extract

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DESIGN_DIR = path.join(ROOT, 'design');
const STITCH_DIR = path.join(DESIGN_DIR, 'stitch-screens');
const CONTRACTS_DIR = path.join(DESIGN_DIR, 'contracts');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Simple HTML element extractor (no external parser needed).
// Finds elements with id or class attributes and builds a contract skeleton.
function extractElements(html) {
  const elements = [];
  const idPattern = /id=["']([^"']+)["']/g;
  let match;
  while ((match = idPattern.exec(html)) !== null) {
    elements.push({ selector: '#' + match[1], required: true });
  }
  return elements;
}

function extractAria(html) {
  const aria = [];
  const rolePattern = /id=["']([^"']+)["'][^>]*role=["']([^"']+)["']/g;
  let match;
  while ((match = rolePattern.exec(html)) !== null) {
    aria.push({ selector: '#' + match[1], role: match[2] });
  }
  return aria;
}

function main() {
  ensureDir(CONTRACTS_DIR);

  if (!fs.existsSync(STITCH_DIR)) {
    console.log('No Stitch HTML files found in design/stitch-screens/');
    console.log('Use Stitch MCP get_screen_code to pull design HTML first.');
    return;
  }

  const htmlFiles = fs.readdirSync(STITCH_DIR).filter(f => f.endsWith('.html'));
  if (htmlFiles.length === 0) {
    console.log('No .html files in design/stitch-screens/');
    return;
  }

  for (const file of htmlFiles) {
    const name = path.basename(file, '.html');
    const html = fs.readFileSync(path.join(STITCH_DIR, file), 'utf8');
    const contract = {
      name: name,
      elements: extractElements(html),
      aria: extractAria(html)
    };
    const outPath = path.join(CONTRACTS_DIR, name + '.json');
    fs.writeFileSync(outPath, JSON.stringify(contract, null, 2) + '\n');
    console.log('  ' + name + '.json: ' + contract.elements.length + ' elements, ' + contract.aria.length + ' ARIA roles');
  }

  console.log('Contracts extracted: ' + htmlFiles.length + ' files');
}

main();
