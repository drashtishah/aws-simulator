#!/usr/bin/env node
// PreToolUse guard: context-aware file protection.
// Reads active skill from .claude/state/active-skill.txt (set by skills on start).
// When no skill is active (development mode), only NEVER_WRITABLE files are blocked.

const fs = require('fs');
const path = require('path');

const OWNERSHIP = {
  play: {
    files: ['learning/profile.json', 'learning/catalog.csv', 'learning/journal.md'],
    dirs: ['learning/sessions']
  },
  'create-sim': {
    files: ['sims/registry.json', 'sims/index.md', 'learning/catalog.csv'],
    dirs: ['sims/']
  },
  setup: {
    files: ['learning/profile.json', 'learning/catalog.csv', 'learning/journal.md',
            'learning/feedback.md'],
    dirs: ['learning/sessions']
  },
  feedback: {
    files: ['learning/feedback.md'],
    dirs: ['learning/sessions']
  },
  fix: {
    files: ['learning/feedback.md', 'metrics.config.json'],
    dirs: ['.claude/skills/', 'learning/logs']
  }
};

// Files NEVER writable regardless of context
const NEVER_WRITABLE = [
  'references/path-registry.csv',
  'learning/logs/activity.jsonl',
  'package-lock.json'
];

// Directories NEVER writable
const NEVER_WRITABLE_DIRS = [
  'node_modules'
];

function getActiveSkill(root) {
  try {
    return fs.readFileSync(path.join(root, '.claude', 'state', 'active-skill.txt'), 'utf8').trim();
  } catch {
    return null;
  }
}

function checkAccess(filePath, activeSkill, root) {
  const resolved = path.resolve(root, filePath);

  // Always blocked, no matter what skill is active
  const neverFiles = NEVER_WRITABLE.map(f => path.join(root, f));
  if (neverFiles.some(p => resolved === p)) {
    return { allowed: false, reason: path.basename(resolved) + ' is auto-generated or append-only. Do not edit directly.' };
  }
  const neverDirs = NEVER_WRITABLE_DIRS.map(d => path.join(root, d));
  if (neverDirs.some(p => resolved.startsWith(p + path.sep) || resolved === p)) {
    return { allowed: false, reason: 'node_modules/ is managed by npm. Do not edit directly.' };
  }

  // If no skill is active (development context), allow everything else
  if (!activeSkill) {
    return { allowed: true };
  }

  // Skill is active: check ownership
  const owned = OWNERSHIP[activeSkill];
  if (!owned) {
    return { allowed: true }; // Unknown skill: fall back to dev mode
  }

  // Check owned files
  const ownedFiles = owned.files.map(f => path.join(root, f));
  if (ownedFiles.some(p => resolved === p)) {
    return { allowed: true };
  }

  // Check owned directories
  const ownedDirs = owned.dirs.map(d => path.resolve(root, d));
  if (ownedDirs.some(d => resolved.startsWith(d + path.sep) || resolved === d)) {
    return { allowed: true };
  }

  // Skills can always edit skill files, commands, and references
  const alwaysEditable = [
    path.join(root, '.claude', 'skills'),
    path.join(root, '.claude', 'commands'),
    path.join(root, 'references')
  ];
  if (alwaysEditable.some(d => resolved.startsWith(d + path.sep))) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: 'The ' + activeSkill + ' skill does not own ' + path.relative(root, resolved) +
      '. Allowed: ' + owned.files.concat(owned.dirs).join(', ')
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
      const activeSkill = getActiveSkill(root);
      const result = checkAccess(filePath, activeSkill, root);

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

module.exports = { checkAccess, getActiveSkill };
