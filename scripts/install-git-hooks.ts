#!/usr/bin/env tsx
// Install repo-tracked git hooks from .claude/hooks/ into .git/hooks/.
//
// Why: .git/hooks/ is not versioned by git. Any hook that must run for
// every contributor (Claude or human) has to be installed once per clone.
// This script is idempotent and safe to re-run.
//
// Install: npm run install-git-hooks (added to package.json postinstall).

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const REPO_ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const SRC_DIR = path.join(REPO_ROOT, '.claude', 'hooks');
const DST_DIR = path.join(REPO_ROOT, '.git', 'hooks');

// Git-native hook names we manage from .claude/hooks/ (not the Claude Code
// hooks, which live in .claude/settings.json and run inside Claude sessions).
const GIT_HOOKS: string[] = ['post-commit'];

let installed = 0;
for (const name of GIT_HOOKS) {
  const src = path.join(SRC_DIR, name);
  const dst = path.join(DST_DIR, name);

  if (!fs.existsSync(src)) {
    console.error(`skip ${name}: source ${src} not found`);
    continue;
  }

  fs.copyFileSync(src, dst);
  fs.chmodSync(dst, 0o755);
  installed++;
  console.log(`installed ${name} -> ${dst}`);
}

console.log(`install-git-hooks: ${installed}/${GIT_HOOKS.length} hooks installed`);
