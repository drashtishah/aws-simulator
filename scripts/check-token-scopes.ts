#!/usr/bin/env npx ts-node
// check-token-scopes.ts: Verify GH_TOKEN has the OAuth scopes this repo's
// automation requires. Required scopes live in references/config/required-token-scopes.json
// so they can be updated without touching this script.
//
// Classic PATs: GitHub returns X-Oauth-Scopes header — full check.
// Fine-grained PATs: header is absent — warn and exit 0 (can't inspect).
// No GH_TOKEN: skip with a note.

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'references', 'config', 'required-token-scopes.json');

interface ScopeConfig {
  required: string[];
  rationale: Record<string, string>;
}

function loadConfig(): ScopeConfig {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  return JSON.parse(raw) as ScopeConfig;
}

function getTokenScopes(): string[] | null {
  const token = process.env.GH_TOKEN;
  if (!token) return null;
  try {
    const headers = execSync('gh api user -i --silent 2>/dev/null || gh api user -i', {
      env: { ...process.env, GH_TOKEN: token },
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15_000,
    }).toString();

    const match = headers.match(/^X-Oauth-Scopes:\s*(.*)$/im);
    if (!match) return []; // fine-grained PAT or no scopes header
    return (match[1] ?? '').split(',').map(s => s.trim()).filter(Boolean);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`GitHub API call failed: ${msg}`);
  }
}

const config = loadConfig();

if (!process.env.GH_TOKEN) {
  console.log('check-token-scopes: GH_TOKEN not set, skipping');
  process.exit(0);
}

let scopes: string[];
try {
  const result = getTokenScopes();
  if (result === null) {
    console.log('check-token-scopes: GH_TOKEN not set, skipping');
    process.exit(0);
  }
  scopes = result;
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`check-token-scopes: error: ${msg}`);
  process.exit(1);
}

if (scopes.length === 0) {
  // Fine-grained PAT — X-Oauth-Scopes header absent. Can't inspect permissions.
  console.warn(
    'check-token-scopes: warn: fine-grained PAT detected (no X-Oauth-Scopes header). ' +
    `Cannot verify required scopes [${config.required.join(', ')}]. ` +
    'Ensure the token has Contents (read/write) and Workflows permissions.'
  );
  process.exit(0);
}

console.log(`check-token-scopes: token has scopes: [${scopes.join(', ')}]`);

const missing = config.required.filter(s => !scopes.includes(s));
if (missing.length > 0) {
  for (const scope of missing) {
    const reason = config.rationale[scope] ?? 'see required-token-scopes.json';
    console.error(`error: GH_PAT is missing scope "${scope}" (${reason})`);
  }
  process.exit(1);
}

console.log(`check-token-scopes: ok (required: [${config.required.join(', ')}])`);
