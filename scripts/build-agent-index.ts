#!/usr/bin/env node
// build-agent-index.ts: Rewrite the "References by category" block inside
// references/registries/agent-index.md.
//
// Walks references/** for every file, groups by immediate subfolder under
// references/, and writes one row per file (path + 1-line description). The
// rest of agent-index.md is left untouched. Idempotent: running twice produces
// zero diff.
//
// Description source: first H1 heading, else first non-empty paragraph, else
// the file name.

import fs from 'node:fs';
import path from 'node:path';

const ROOT: string = path.resolve(__dirname, '..');
const REFERENCES_DIR: string = path.join(ROOT, 'references');
const INDEX_PATH: string = path.join(ROOT, 'references', 'registries', 'agent-index.md');
const BEGIN_MARKER: string = '<!-- AGENT_INDEX_REFERENCES_BEGIN -->';
const END_MARKER: string = '<!-- AGENT_INDEX_REFERENCES_END -->';

interface FileEntry {
  relPath: string;
  description: string;
}

function walkFiles(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full: string = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
}

function describeFile(absPath: string): string {
  const ext: string = path.extname(absPath);
  const fallback: string = path.basename(absPath);
  let raw: string;
  try {
    raw = fs.readFileSync(absPath, 'utf8');
  } catch {
    return fallback;
  }

  if (ext === '.md') {
    const lines: string[] = raw.split('\n');
    for (const line of lines) {
      const m: RegExpMatchArray | null = line.match(/^#\s+(.+)$/);
      if (m) return m[1]!.trim();
    }
    for (const line of lines) {
      const trimmed: string = line.trim();
      if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('<!--')) {
        return trimmed.replace(/[`*_]/g, '').slice(0, 120);
      }
    }
    return fallback;
  }

  if (ext === '.json') {
    try {
      const data: unknown = JSON.parse(raw);
      if (data && typeof data === 'object') {
        const obj = data as Record<string, unknown>;
        if (typeof obj['description'] === 'string') return obj['description'] as string;
        if (typeof obj['title'] === 'string') return obj['title'] as string;
        if (typeof obj['$id'] === 'string') return `JSON schema: ${obj['$id'] as string}`;
      }
    } catch {
      // ignore
    }
    return `JSON data: ${fallback}`;
  }

  if (ext === '.yaml' || ext === '.yml') {
    const firstComment: RegExpMatchArray | null = raw.match(/^#\s*(.+)$/m);
    if (firstComment) return firstComment[1]!.trim();
    return `YAML config: ${fallback}`;
  }

  if (ext === '.csv') {
    const firstLine: string = raw.split('\n')[0] || '';
    return `CSV data with columns: ${firstLine}`;
  }

  // Default: first non-empty line
  for (const line of raw.split('\n')) {
    const t: string = line.trim();
    if (t) return t.slice(0, 120);
  }
  return fallback;
}

function buildBlock(): string {
  const all: string[] = [];
  walkFiles(REFERENCES_DIR, all);

  // Group by first subfolder under references/
  const groups = new Map<string, FileEntry[]>();
  for (const abs of all) {
    const rel: string = path.relative(ROOT, abs);
    // Skip the agent-index file itself; describing itself adds noise.
    if (rel === 'references/registries/agent-index.md') continue;
    const parts: string[] = rel.split(path.sep);
    // parts[0] === 'references'; parts[1] is the subfolder (or the file when
    // a file lives at the top of references/).
    const group: string = parts.length > 2 ? parts[1]! : '(top level)';
    const entry: FileEntry = {
      relPath: rel,
      description: describeFile(abs),
    };
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(entry);
  }

  // Sort groups and entries deterministically
  const sortedGroupNames: string[] = [...groups.keys()].sort();
  const lines: string[] = [];
  lines.push(BEGIN_MARKER);
  lines.push('');
  for (const groupName of sortedGroupNames) {
    const entries: FileEntry[] = groups.get(groupName)!.slice().sort((a, b) => a.relPath.localeCompare(b.relPath));
    lines.push(`### ${groupName}`);
    lines.push('');
    lines.push('| Path | Description |');
    lines.push('|------|-------------|');
    for (const entry of entries) {
      const desc: string = entry.description.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
      lines.push(`| \`${entry.relPath}\` | ${desc} |`);
    }
    lines.push('');
  }
  lines.push(END_MARKER);
  return lines.join('\n');
}

function rewrite(): void {
  const indexContent: string = fs.readFileSync(INDEX_PATH, 'utf8');
  const beginIdx: number = indexContent.indexOf(BEGIN_MARKER);
  const endIdx: number = indexContent.indexOf(END_MARKER);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
    throw new Error(`agent-index.md is missing the marker block (${BEGIN_MARKER} ... ${END_MARKER})`);
  }
  const before: string = indexContent.slice(0, beginIdx);
  const after: string = indexContent.slice(endIdx + END_MARKER.length);
  const newBlock: string = buildBlock();
  const next: string = before + newBlock + after;
  if (next !== indexContent) {
    fs.writeFileSync(INDEX_PATH, next, 'utf8');
    console.log(`Updated ${path.relative(ROOT, INDEX_PATH)}`);
  } else {
    console.log(`No changes to ${path.relative(ROOT, INDEX_PATH)}`);
  }
}

if (require.main === module) {
  rewrite();
}

export { buildBlock, rewrite, describeFile };
