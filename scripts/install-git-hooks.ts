#!/usr/bin/env tsx
// Install repo-tracked git hooks from .claude/hooks/ into the common git
// hooks directory.
//
// Why hooks: .git/hooks/ is not versioned by git. Any hook that must run
// for every contributor (Claude or human) has to be installed once per
// clone. In a git worktree .git is a FILE, so the hooks directory is
// resolved via `git rev-parse --git-common-dir` to hit the shared hooks
// dir that all worktrees inherit.
//
// Install: npm run install-git-hooks (wired into package.json postinstall).

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const REPO_ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const GIT_COMMON_DIR = (() => {
  const raw = execSync('git rev-parse --git-common-dir', {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }).trim();
  return path.isAbsolute(raw) ? raw : path.join(REPO_ROOT, raw);
})();
const SRC_DIR = path.join(REPO_ROOT, '.claude', 'hooks');
const DST_DIR = path.join(GIT_COMMON_DIR, 'hooks');

// Git-native hook names we manage from .claude/hooks/ (not the Claude Code
// hooks, which live in .claude/settings.json and run inside Claude sessions).
const GIT_HOOKS: string[] = ['post-commit'];

fs.mkdirSync(DST_DIR, { recursive: true });

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
