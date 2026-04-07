#!/usr/bin/env npx tsx
// Summarizes a sim-test agent browser run into web/test-results/agent-browser-latest.json.
// The pre-commit-ui-tests hook reads this artifact to gate UI commits.
//
// Usage:
//   tsx scripts/agent-browser-summarize.ts --status pass
//   tsx scripts/agent-browser-summarize.ts --status fail --failed-specs home,session
//
// Per-spec results are not currently emitted by sim-test agent (the runner is a
// YAML to instruction translator; chrome-devtools calls happen in a downstream
// subagent). The summarizer therefore takes the overall status from CLI args
// and computes git metadata (HEAD, hash of UI files at HEAD) itself.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

const ROOT: string = path.resolve(__dirname, '..');
const ARTIFACT: string = path.join(ROOT, 'web', 'test-results', 'agent-browser-latest.json');

// UI globs (kept in sync with pre-commit-ui-tests.ts)
export const UI_GLOBS: string[] = [
  'web/public/',
  'web/server.ts',
  'web/lib/',
  'web/test-specs/browser/'
];

export function isUiPath(p: string): boolean {
  if (p === 'web/server.ts') return true;
  if (p.startsWith('web/public/')) return true;
  if (p.startsWith('web/lib/') && p.endsWith('.css')) return true;
  if (p.startsWith('web/test-specs/browser/')) return true;
  return false;
}

export function listUiFilesAtHead(): string[] {
  const out = execSync('git ls-tree -r --name-only HEAD', { cwd: ROOT, encoding: 'utf8' });
  return out
    .split('\n')
    .filter((l: string) => l.length > 0)
    .filter(isUiPath)
    .sort();
}

export function hashUiFilesAtHead(): string {
  const files = listUiFilesAtHead();
  const h = crypto.createHash('sha256');
  for (const f of files) {
    h.update(f);
    h.update('\0');
    try {
      const content = execSync(`git show HEAD:${f}`, { cwd: ROOT });
      h.update(content);
    } catch {
      // file may not exist at HEAD (newly added); skip content
    }
    h.update('\0');
  }
  return h.digest('hex');
}

export function currentHead(): string {
  return execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
}

interface Args {
  status: 'pass' | 'fail';
  failedSpecs: string[];
}

function parseArgs(argv: string[]): Args {
  let status: 'pass' | 'fail' = 'pass';
  let failedSpecs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--status') {
      const v = argv[++i];
      if (v !== 'pass' && v !== 'fail') {
        throw new Error('--status must be "pass" or "fail"');
      }
      status = v;
    } else if (argv[i] === '--failed-specs') {
      failedSpecs = (argv[++i] || '').split(',').map(s => s.trim()).filter(s => s.length > 0);
    }
  }
  return { status, failedSpecs };
}

export function buildSummary(args: Args) {
  return {
    status: args.status,
    committed_at_head: currentHead(),
    staged_files_hash: hashUiFilesAtHead(),
    failed_specs: args.failedSpecs,
    ran_at: new Date().toISOString()
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const summary = buildSummary(args);
  fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
  fs.writeFileSync(ARTIFACT, JSON.stringify(summary, null, 2) + '\n');
  console.log(`Wrote ${path.relative(ROOT, ARTIFACT)} (status=${summary.status})`);
}

if (require.main === module) {
  main();
}
