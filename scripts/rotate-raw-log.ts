#!/usr/bin/env npx tsx
import fs from 'node:fs';
import path from 'node:path';

const THRESHOLD_BYTES = 5_000_000;

export function shouldRotate(sizeBytes: number): boolean {
  return sizeBytes >= THRESHOLD_BYTES;
}

export function archiveName(date: Date, dir: string): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = date.getUTCFullYear();
  const mm = pad(date.getUTCMonth() + 1);
  const dd = pad(date.getUTCDate());
  const base = `activity-archive-${yyyy}-${mm}-${dd}.jsonl`;
  if (!fs.existsSync(path.join(dir, base))) return base;
  const hh = pad(date.getUTCHours());
  const min = pad(date.getUTCMinutes());
  return `activity-archive-${yyyy}-${mm}-${dd}-${hh}-${min}.jsonl`;
}

export function rotate(rawJsonlPath: string): void {
  let size: number;
  try { size = fs.statSync(rawJsonlPath).size; } catch { return; }
  if (!shouldRotate(size)) return;
  const dir = path.dirname(rawJsonlPath);
  const dest = path.join(dir, archiveName(new Date(), dir));
  fs.renameSync(rawJsonlPath, dest);
  fs.writeFileSync(rawJsonlPath, '');
}

// CLI entry point
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename ?? __filename)) {
  const rawPath = path.join(process.cwd(), 'learning', 'logs', 'raw.jsonl');
  rotate(rawPath);
}
