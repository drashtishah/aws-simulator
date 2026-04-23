#!/usr/bin/env npx tsx
// Checks NEVER_WRITABLE and NEVER_WRITABLE_DIRS; run globally via settings.local.json.

import path from 'node:path';

interface HookInput {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  [key: string]: unknown;
}

interface AccessResult {
  allowed: boolean;
  reason?: string;
}

// Files NEVER writable regardless of context
const NEVER_WRITABLE: string[] = [
  'references/registries/path-registry.csv',
  'learning/logs/raw.jsonl',
  'learning/logs/activity.jsonl',
  'learning/logs/system.jsonl',
  'package-lock.json'
];

// Directories NEVER writable (blocks Write/Edit even in skill mode).
// Vaults are here per Issue #171: reflector writes system-vault from GHA
// where this hook does not fire, so local sessions are universally blocked.
// Setup seeds the initial scaffold via Bash (mkdir + cp), which bypasses
// this PreToolUse matcher since it only guards Edit|Write.
const NEVER_WRITABLE_DIRS: string[] = [
  'node_modules',
  'web/test-specs',
  'learning/system-vault',
  'learning/player-vault'
];

function checkAccess(filePath: string, root: string): AccessResult {
  // As of Claude Code v2.1.89, file_path arrives as absolute for Write/Edit/Read.
  // path.resolve handles both: relative -> joined with root; absolute -> returned as-is.
  const resolved: string = path.resolve(root, filePath);

  // Always blocked
  const neverFiles: string[] = NEVER_WRITABLE.map(f => path.join(root, f));
  if (neverFiles.some(p => resolved === p)) {
    return { allowed: false, reason: path.basename(resolved) + ' is auto-generated or append-only. Do not edit directly.' };
  }
  const neverDirs: string[] = NEVER_WRITABLE_DIRS.map(d => path.join(root, d));
  if (neverDirs.some(p => resolved.startsWith(p + path.sep) || resolved === p)) {
    const matchedDir: string | undefined = NEVER_WRITABLE_DIRS.find(d =>
      resolved.startsWith(path.join(root, d) + path.sep) || resolved === path.join(root, d)
    );
    return { allowed: false, reason: (matchedDir || 'Directory') + '/ is protected. Do not edit directly.' };
  }

  // Always editable (skill files, commands, references)
  const alwaysEditable: string[] = [
    path.join(root, '.claude', 'skills'),
    path.join(root, '.claude', 'commands'),
    path.join(root, 'references')
  ];
  if (alwaysEditable.some(d => resolved.startsWith(d + path.sep))) {
    return { allowed: true };
  }

  return { allowed: true };
}

// Main execution
let input = '';
process.stdin.on('data', (d: Buffer) => input += d);
process.stdin.on('end', () => {
  try {
    const data: HookInput = JSON.parse(input);
    const filePath = data.tool_input && (data.tool_input.file_path as string);
    if (!filePath) process.exit(0);

    const root: string = process.cwd();

    const result: AccessResult = checkAccess(filePath, root);
    if (!result.allowed) {
      process.stderr.write('BLOCKED: ' + result.reason);
      process.exit(2);
    }
    process.exit(0);
  } catch {
    process.exit(0); // fail-open on parse errors
  }
});

export { checkAccess };
