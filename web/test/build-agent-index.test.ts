'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const INDEX_PATH = path.join(ROOT, 'references', 'registries', 'agent-index.md');
const REFERENCES_DIR = path.join(ROOT, 'references');
const BEGIN_MARKER = '<!-- AGENT_INDEX_REFERENCES_BEGIN -->';
const END_MARKER = '<!-- AGENT_INDEX_REFERENCES_END -->';

function runBuilder() {
  execSync('npx tsx scripts/build-agent-index.ts', { cwd: ROOT, timeout: 60000 });
}

describe('build-agent-index', () => {
  it('rewrites only the block between the markers', () => {
    runBuilder();
    const content = fs.readFileSync(INDEX_PATH, 'utf8');
    assert.ok(content.includes(BEGIN_MARKER), 'begin marker present');
    assert.ok(content.includes(END_MARKER), 'end marker present');
    const begin = content.indexOf(BEGIN_MARKER);
    const end = content.indexOf(END_MARKER);
    assert.ok(begin < end, 'begin precedes end');
  });

  it('lists every file under references/ in the generated block', () => {
    runBuilder();
    const content = fs.readFileSync(INDEX_PATH, 'utf8');
    const block = content.slice(
      content.indexOf(BEGIN_MARKER),
      content.indexOf(END_MARKER)
    );

    function walk(dir: string, out: string[]): void {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full, out);
        } else if (entry.isFile()) {
          out.push(path.relative(ROOT, full));
        }
      }
    }
    const allFiles: string[] = [];
    walk(REFERENCES_DIR, allFiles);

    for (const rel of allFiles) {
      // The agent-index.md file itself does not need to be listed inside its own block.
      if (rel === 'references/registries/agent-index.md') continue;
      assert.ok(
        block.includes(rel),
        `block must mention ${rel}`
      );
    }
  });

  it('is idempotent: running twice produces zero diff', () => {
    runBuilder();
    const first = fs.readFileSync(INDEX_PATH, 'utf8');
    runBuilder();
    const second = fs.readFileSync(INDEX_PATH, 'utf8');
    assert.equal(first, second, 'second run must produce identical content');
  });
});
