#!/usr/bin/env node
// PreToolUse guard: context-aware file protection.
// Global mode (no --ownership flag): checks NEVER_WRITABLE only.
// Skill mode (--ownership path): also checks skill-scoped ownership.
// Two-layer execution: settings.local.json registers this hook globally (baseline),
// and each SKILL.md registers it again with --ownership for per-skill scoping.

const fs = require('fs');
const path = require('path');

// Files NEVER writable regardless of context
const NEVER_WRITABLE = [
  'references/path-registry.csv',
  'learning/logs/activity.jsonl',
  'package-lock.json'
];

// Directories NEVER writable
const NEVER_WRITABLE_DIRS = [
  'node_modules',
  'web/test-specs'
];

function checkAccess(filePath, ownership, root) {
  // As of Claude Code v2.1.89, file_path arrives as absolute for Write/Edit/Read.
  // path.resolve handles both: relative -> joined with root; absolute -> returned as-is.
  const resolved = path.resolve(root, filePath);

  // Always blocked
  const neverFiles = NEVER_WRITABLE.map(f => path.join(root, f));
  if (neverFiles.some(p => resolved === p)) {
    return { allowed: false, reason: path.basename(resolved) + ' is auto-generated or append-only. Do not edit directly.' };
  }
  const neverDirs = NEVER_WRITABLE_DIRS.map(d => path.join(root, d));
  if (neverDirs.some(p => resolved.startsWith(p + path.sep) || resolved === p)) {
    const matchedDir = NEVER_WRITABLE_DIRS.find(d =>
      resolved.startsWith(path.join(root, d) + path.sep) || resolved === path.join(root, d)
    );
    return { allowed: false, reason: (matchedDir || 'Directory') + '/ is protected. Do not edit directly.' };
  }

  // Always editable (skill files, commands, references)
  const alwaysEditable = [
    path.join(root, '.claude', 'skills'),
    path.join(root, '.claude', 'commands'),
    path.join(root, 'references')
  ];
  if (alwaysEditable.some(d => resolved.startsWith(d + path.sep))) {
    return { allowed: true };
  }

  // If no ownership provided (global mode / dev mode), allow everything else
  if (!ownership) {
    return { allowed: true };
  }

  // Test files not editable during skill execution
  const testDir = path.join(root, 'web', 'test');
  if (resolved.startsWith(testDir + path.sep)) {
    return { allowed: false, reason: 'Test files are not editable during skill execution.' };
  }

  // Check owned files
  const ownedFiles = (ownership.files || []).map(f => path.join(root, f));
  if (ownedFiles.some(p => resolved === p)) {
    return { allowed: true };
  }

  // Check owned directories
  const ownedDirs = (ownership.dirs || []).map(d => path.resolve(root, d));
  if (ownedDirs.some(d => resolved.startsWith(d + path.sep) || resolved === d)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: 'Skill does not own ' + path.relative(root, resolved) +
      '. Allowed: ' + (ownership.files || []).concat(ownership.dirs || []).join(', ')
  };
}

if (require.main === module) {
  let input = '';
  process.stdin.on('data', d => input += d);
  process.stdin.on('end', () => {
    try {
      const data = JSON.parse(input);
      const filePath = data.tool_input && data.tool_input.file_path;
      if (!filePath) process.exit(0);

      const root = process.cwd();

      // Read ownership from --ownership flag if provided
      let ownership = null;
      const ownershipIdx = process.argv.indexOf('--ownership');
      if (ownershipIdx !== -1 && process.argv[ownershipIdx + 1]) {
        const ownershipPath = path.resolve(root, process.argv[ownershipIdx + 1]);
        ownership = JSON.parse(fs.readFileSync(ownershipPath, 'utf8'));
      }

      const result = checkAccess(filePath, ownership, root);
      if (!result.allowed) {
        process.stderr.write('BLOCKED: ' + result.reason);
        process.exit(2);
      }
      process.exit(0);
    } catch {
      process.exit(0); // fail-open on parse errors
    }
  });
}

module.exports = { checkAccess };
