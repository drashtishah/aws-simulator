#!/usr/bin/env npx ts-node
// lint-workflow-secrets.ts: Enforce two rules on .github/workflows/**/*.yml
//   1. secrets.GITHUB_TOKEN is forbidden (use secrets.GH_PAT; GITHUB_TOKEN
//      pushes do not re-trigger CI, causing silent auto-merge stalls).
//   2. Every secrets.<NAME> reference must be a configured repo secret.
//      Requires GH_TOKEN env; skips existence check if unavailable.

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(__dirname, '..');
const WORKFLOW_DIR = path.join(ROOT, '.github', 'workflows');
const FORBIDDEN = new Set(['GITHUB_TOKEN']);

// ${{ secrets.NAME }} — capture NAME
const SECRET_REF = /\$\{\{[\s-]*secrets\.(\w+)[\s-]*\}\}/g;

interface Violation {
  file: string;
  line: number;
  message: string;
}

function listRepoSecrets(): Set<string> | null {
  const token = process.env.GH_TOKEN;
  if (!token) return null;
  try {
    const raw = execSync('gh secret list --json name', {
      env: { ...process.env, GH_TOKEN: token },
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15_000,
    }).toString();
    const parsed: Array<{ name: string }> = JSON.parse(raw);
    return new Set(parsed.map(s => s.name));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`warn: could not list repo secrets (skipping existence check): ${msg}`);
    return null;
  }
}

function scanWorkflows(): Violation[] {
  const repoSecrets = listRepoSecrets();
  if (repoSecrets) {
    console.log(`lint-workflow-secrets: checking against ${repoSecrets.size} configured secrets`);
  } else {
    console.log('lint-workflow-secrets: GH_TOKEN not set, skipping existence check');
  }

  const violations: Violation[] = [];
  const files = fs.readdirSync(WORKFLOW_DIR).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));

  for (const file of files) {
    const filePath = path.join(WORKFLOW_DIR, file);
    const relPath = path.relative(ROOT, filePath);
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      SECRET_REF.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = SECRET_REF.exec(line)) !== null) {
        const name = match[1] ?? '';
        if (!name) continue;

        if (FORBIDDEN.has(name)) {
          violations.push({
            file: relPath,
            line: i + 1,
            message: `secrets.${name} is forbidden; use secrets.GH_PAT (GITHUB_TOKEN pushes do not re-trigger CI)`,
          });
          continue;
        }

        if (repoSecrets && !repoSecrets.has(name)) {
          violations.push({
            file: relPath,
            line: i + 1,
            message: `secrets.${name} is not configured in the repository`,
          });
        }
      }
    }
  }

  return violations;
}

const violations = scanWorkflows();

if (violations.length === 0) {
  console.log('lint-workflow-secrets: ok');
  process.exit(0);
}

for (const v of violations) {
  console.error(`error: ${v.file}:${v.line}: ${v.message}`);
}
process.exit(1);
