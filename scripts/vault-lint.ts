#!/usr/bin/env node
// vault-lint: enforce learning/system-vault/ size caps and frontmatter schema.
// Invoked by npm test and by the reflector workflow after a write.

import fs from 'node:fs';
import path from 'node:path';

export interface LintResult {
  ok: boolean;
  violations: string[];
  warnings: string[];
  noteCount: number;
}

const KIND_DIRS = ['problems', 'solutions', 'playbooks', 'patterns'] as const;
const SIZE_INDEX_LINES = 120;
const SIZE_NOTE_LINES = 80;
const SIZE_NOTE_BYTES = 3 * 1024;
const SIZE_SUMMARY_CHARS = 160;
const NOTE_COUNT_SOFT = 200;
const NOTE_COUNT_HARD = 400;

const SHARED_REQUIRED = [
  'id',
  'kind',
  'title',
  'tags',
  'created',
  'updated',
  'source_issues',
  'confidence',
  'summary',
];
const KIND_REQUIRED: Record<string, string[]> = {
  problem: ['triggers', 'solutions', 'related_problems', 'severity'],
  solution: ['applies_to', 'preconditions', 'cost'],
  playbook: ['when', 'steps', 'related'],
  pattern: ['principle', 'counter_examples'],
};

function extractFrontmatter(body: string): Record<string, string> | null {
  if (!body.startsWith('---\n')) return null;
  const end = body.indexOf('\n---', 4);
  if (end < 0) return null;
  const block = body.slice(4, end);
  const meta: Record<string, string> = {};
  for (const raw of block.split('\n')) {
    const line = raw.trimEnd();
    if (!line || line.startsWith(' ') || line.startsWith('-')) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    meta[key] = value;
  }
  return meta;
}

function lintIndex(root: string, violations: string[]): void {
  const indexPath = path.join(root, 'index.md');
  if (!fs.existsSync(indexPath)) return;
  const content = fs.readFileSync(indexPath, 'utf8');
  const lineCount = content.split('\n').length;
  if (lineCount > SIZE_INDEX_LINES) {
    violations.push(
      'index.md: ' + lineCount + ' lines exceeds cap of ' + SIZE_INDEX_LINES,
    );
  }
}

function lintNote(root: string, kind: string, file: string, violations: string[]): void {
  const full = path.join(root, kind + 's', file);
  const content = fs.readFileSync(full, 'utf8');
  const bytes = Buffer.byteLength(content, 'utf8');
  const lineCount = content.split('\n').length;
  const id = path.basename(file, '.md');
  const where = kind + 's/' + file;

  if (lineCount > SIZE_NOTE_LINES) {
    violations.push(where + ': ' + lineCount + ' lines exceeds cap of ' + SIZE_NOTE_LINES);
  }
  if (bytes > SIZE_NOTE_BYTES) {
    violations.push(where + ': ' + bytes + ' bytes exceeds 3KB cap');
  }

  const meta = extractFrontmatter(content);
  if (!meta) {
    violations.push(where + ': missing or malformed frontmatter block');
    return;
  }
  const required = [...SHARED_REQUIRED, ...(KIND_REQUIRED[kind] ?? [])];
  for (const field of required) {
    if (!(field in meta) || meta[field] === '') {
      violations.push(where + ': missing required frontmatter field `' + field + '`');
    }
  }
  if (meta.summary && meta.summary.length > SIZE_SUMMARY_CHARS) {
    violations.push(
      where + ': summary is ' + meta.summary.length + ' chars, exceeds ' + SIZE_SUMMARY_CHARS,
    );
  }
  if (meta.kind && meta.kind !== kind) {
    violations.push(where + ': kind `' + meta.kind + '` does not match directory `' + kind + '`');
  }
  if (meta.id && meta.id !== id) {
    violations.push(where + ': id `' + meta.id + '` does not match filename `' + id + '`');
  }
}

export function lintVault(root: string): LintResult {
  const violations: string[] = [];
  const warnings: string[] = [];
  let noteCount = 0;

  if (!fs.existsSync(root)) {
    return { ok: true, violations, warnings, noteCount };
  }

  lintIndex(root, violations);

  for (const kind of KIND_DIRS) {
    const dir = path.join(root, kind);
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md') && !f.startsWith('_'));
    noteCount += files.length;
    for (const file of files) {
      const singular = kind.slice(0, -1);
      lintNote(root, singular, file, violations);
    }
  }

  if (noteCount > NOTE_COUNT_HARD) {
    violations.push(
      'total notes: ' + noteCount + ' exceeds hard cap of ' + NOTE_COUNT_HARD,
    );
  } else if (noteCount > NOTE_COUNT_SOFT) {
    warnings.push(
      'total notes: ' + noteCount + ' exceeds soft cap of ' + NOTE_COUNT_SOFT + '; consolidation recommended',
    );
  }

  return { ok: violations.length === 0, violations, warnings, noteCount };
}

function main(): void {
  const root = process.argv[2] ?? path.resolve(__dirname, '..', 'learning', 'system-vault');
  const result = lintVault(root);
  for (const w of result.warnings) {
    console.warn('warn: ' + w);
  }
  for (const v of result.violations) {
    console.error('FAIL: ' + v);
  }
  if (!result.ok) {
    console.error('vault-lint: ' + result.violations.length + ' violation(s)');
    process.exit(1);
  }
  console.log('vault-lint: ok (' + result.noteCount + ' note(s))');
}

if (require.main === module) {
  main();
}
