const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const CSV_PATH = path.join(ROOT, 'references', 'path-registry.csv');

function parseCSV() {
  const content = fs.readFileSync(CSV_PATH, 'utf8').trim().replace(/\r\n/g, '\n');
  const lines = content.split('\n');
  const header = lines[0];
  assert.equal(header, 'file,path,line_number', 'CSV header should match expected format');

  return lines.slice(1).map(line => {
    // Handle quoted fields (csv may quote fields with commas)
    const parts = line.match(/(".*?"|[^,]+)/g) || [];
    return {
      file: (parts[0] || '').replace(/"/g, ''),
      path: (parts[1] || '').replace(/"/g, ''),
      line_number: parseInt(parts[2], 10)
    };
  });
}

describe('path-registry', () => {
  it('CSV exists and is non-empty', () => {
    assert.ok(fs.existsSync(CSV_PATH), 'references/path-registry.csv should exist');
    const rows = parseCSV();
    assert.ok(rows.length > 0, 'CSV should have at least one data row');
  });

  it('all concrete paths resolve to real files or directories', () => {
    const rows = parseCSV();
    const failures = [];

    for (const row of rows) {
      // Skip template paths (contain {} or ${}), and glob patterns (contain *)
      if (row.path.includes('{') || row.path.includes('*') || row.path.includes('$')) continue;

      // Skip runtime-generated paths (created by /setup, hooks, or CLI, not present on fresh clone)
      if (row.path.startsWith('learning/logs/')) continue;
      if (row.path.startsWith('learning/vault')) continue;
      if (row.path === 'learning/catalog.csv') continue;
      if (row.path === 'learning/feedback.md') continue;
      if (row.path.startsWith('web/test-results/')) continue;
      if (row.path.startsWith('dist/')) continue;

      const fullPath = path.join(ROOT, row.path);
      if (!fs.existsSync(fullPath)) {
        failures.push(`${row.file}:${row.line_number} references "${row.path}" which does not exist`);
      }
    }

    if (failures.length > 0) {
      assert.fail(
        `${failures.length} broken path reference(s):\n` +
        failures.map(f => '  - ' + f).join('\n')
      );
    }
  });

  it('template paths have valid directory prefixes', () => {
    const rows = parseCSV();
    const failures = [];

    for (const row of rows) {
      if (!row.path.includes('{') && !row.path.includes('$')) continue;

      // Skip runtime-generated directory prefixes
      if (row.path.startsWith('web/test-results/')) continue;
      if (row.path.startsWith('dist/')) continue;
      if (row.path.startsWith('learning/vault')) continue;

      // Extract prefix before the first template variable ($ or {)
      const dollarIdx = row.path.indexOf('$');
      const braceIdx = row.path.indexOf('{');
      const templateIdx = [dollarIdx, braceIdx].filter(i => i >= 0).reduce((a, b) => Math.min(a, b), row.path.length);
      const prefix = row.path.slice(0, templateIdx);

      // The prefix should exist as a directory (e.g., "sims/" from "sims/{id}/manifest.json")
      // or as a file prefix (e.g., "prompt-overlay-" matching "prompt-overlay-medium.md")
      if (prefix) {
        const prefixPath = path.join(ROOT, prefix);
        if (!fs.existsSync(prefixPath)) {
          // Check if any files match the prefix (for file-level templates like "foo-{var}.md")
          const prefixDir = path.dirname(prefixPath);
          const prefixBase = path.basename(prefixPath);
          const hasMatchingFiles = fs.existsSync(prefixDir) &&
            fs.readdirSync(prefixDir).some(f => f.startsWith(prefixBase));
          if (!hasMatchingFiles) {
            failures.push(`${row.file}:${row.line_number} references "${row.path}" but prefix "${prefix}" does not exist`);
          }
        }
      }
    }

    if (failures.length > 0) {
      assert.fail(
        `${failures.length} template path(s) with missing prefix:\n` +
        failures.map(f => '  - ' + f).join('\n')
      );
    }
  });

  it('all source files in the CSV still exist', () => {
    const rows = parseCSV();
    const sourceFiles = [...new Set(rows.map(r => r.file))];
    const missing = sourceFiles.filter(f => !fs.existsSync(path.join(ROOT, f)));

    if (missing.length > 0) {
      assert.fail(
        `${missing.length} source file(s) in CSV no longer exist (regenerate with: npm run extract-paths):\n` +
        missing.map(f => '  - ' + f).join('\n')
      );
    }
  });
});
