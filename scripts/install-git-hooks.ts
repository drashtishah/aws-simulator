#!/usr/bin/env tsx
// Install repo-tracked git hooks from .claude/hooks/ into the common git
// hooks directory, and seed per-user learning/system-vault/ so `npm run
// doctor` starts green on a fresh clone or worktree.
//
// Why hooks: .git/hooks/ is not versioned by git. Any hook that must run
// for every contributor (Claude or human) has to be installed once per
// clone. In a git worktree .git is a FILE, so the hooks directory is
// resolved via `git rev-parse --git-common-dir` to hit the shared hooks
// dir that all worktrees inherit.
//
// Why vault seed: learning/ is gitignored and per-user. A fresh checkout
// has no learning/system-vault/index.md, which fails doctor's strict
// check. The real vault is populated by the daily-compile-and-rotate
// cron and by /setup; this script writes a minimal stub header so the
// check passes immediately and the cron/setup can flesh it out later.
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

// Seed learning/system-vault/index.md if missing. This satisfies doctor's
// strict check on fresh clones and new worktrees. Real content is written
// by the daily-compile-and-rotate cron and by the system-vault-compile
// skill; this stub is just enough to unblock the check.
const VAULT_DIR = path.join(REPO_ROOT, 'learning', 'system-vault');
const VAULT_INDEX = path.join(VAULT_DIR, 'index.md');
if (!fs.existsSync(VAULT_INDEX)) {
  fs.mkdirSync(VAULT_DIR, { recursive: true });
  fs.writeFileSync(
    VAULT_INDEX,
    [
      '# System Vault',
      '',
      'Per-user, gitignored long-term agent memory.',
      '',
      'This stub was seeded by `npm run install-git-hooks` so',
      '`npm run doctor` starts green on fresh clones and worktrees.',
      'Real content is compiled by the daily-compile-and-rotate cron',
      'and by the system-vault-compile skill.',
      '',
    ].join('\n'),
  );
  console.log(`seeded ${VAULT_INDEX}`);
} else {
  console.log(`vault index already present at ${VAULT_INDEX}`);
}
