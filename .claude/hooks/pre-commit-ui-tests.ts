#!/usr/bin/env npx tsx
// PreToolUse hook for Bash: blocks `git commit` when staged UI files lack a
// passing, fresh agent browser test run.
//
// Reads web/test-results/agent-browser-latest.json (written by
// scripts/agent-browser-summarize.ts after a test agent run).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

interface HookInput {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

interface Artifact {
  status: 'pass' | 'fail';
  committed_at_head: string;
  staged_files_hash: string;
  failed_specs: string[];
  ran_at: string;
}

const ROOT: string = path.resolve(__dirname, '..', '..');
const ARTIFACT: string = path.join(ROOT, 'web', 'test-results', 'agent-browser-latest.json');

function isUiPath(p: string): boolean {
  if (p === 'web/server.ts') return true;
  if (p.startsWith('web/public/')) return true;
  if (p.startsWith('web/lib/') && p.endsWith('.css')) return true;
  if (p.startsWith('web/test-specs/browser/')) return true;
  return false;
}

function stagedUiFiles(): string[] {
  try {
    const out = execSync('git diff --cached --name-only', { cwd: ROOT, encoding: 'utf8' });
    return out.split('\n').filter((l: string) => l.length > 0).filter(isUiPath).sort();
  } catch {
    return [];
  }
}

function hashStagedUiContents(files: string[]): string {
  const h = crypto.createHash('sha256');
  for (const f of files) {
    h.update(f);
    h.update('\0');
    try {
      // Hash the staged (index) version of the file.
      const content = execSync(`git show :${f}`, { cwd: ROOT });
      h.update(content);
    } catch {
      // skip
    }
    h.update('\0');
  }
  return h.digest('hex');
}

function currentHead(): string {
  return execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
}

let hookInput = '';
process.stdin.on('data', (d: Buffer) => hookInput += d);
process.stdin.on('end', () => {
  try {
    const data: HookInput = JSON.parse(hookInput);
    if (data.tool_name !== 'Bash') process.exit(0);
    const cmd: string = (data.tool_input && (data.tool_input.command as string)) || '';
    if (!/\bgit\s+commit\b/.test(cmd)) process.exit(0);

    const forceUi = process.env.PRE_COMMIT_UI_TESTS_FORCE_UI === '1';
    const uiFiles = stagedUiFiles();
    if (uiFiles.length === 0 && !forceUi) process.exit(0);

    if (!fs.existsSync(ARTIFACT)) {
      process.stderr.write(
        'BLOCKED: UI files staged but no recent browser test run. Run `test agent` (or /fix Phase 4 step 11) before committing.\n'
      );
      process.exit(2);
    }

    let artifact: Artifact;
    try {
      artifact = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
    } catch (err) {
      process.stderr.write('BLOCKED: agent-browser-latest.json is unreadable: ' + (err as Error).message + '\n');
      process.exit(2);
    }

    if (artifact.status !== 'pass') {
      const failed = (artifact.failed_specs || []).join(', ') || 'unknown';
      process.stderr.write(
        'BLOCKED: Last browser test run failed: ' + failed + '. Fix and re-run before committing.\n'
      );
      process.exit(2);
    }

    const head = currentHead();
    if (artifact.committed_at_head !== head) {
      const freshHash = forceUi && uiFiles.length === 0
        ? '__force__'
        : hashStagedUiContents(uiFiles);
      if (artifact.staged_files_hash !== freshHash) {
        process.stderr.write(
          'BLOCKED: Browser tests are stale relative to staged UI changes. Re-run `test agent`.\n'
        );
        process.exit(2);
      }
    }

    process.exit(0);
  } catch (err) {
    process.stderr.write('pre-commit-ui-tests hook error: ' + (err as Error).message + '\n');
    process.exit(0);
  }
});
