'use strict';

/**
 * graph-metrics.ts (PR-D Layers 3+4)
 *
 * Pure (mostly I/O-free) graph and freshness metrics over the bucketed
 * tracked-file scope produced by scripts/lib/classify.ts. Each function
 * takes its inputs as arguments and returns an array of findings; no
 * direct dependency on code-health.ts. The aggregator wires findings into
 * bucket scores.
 *
 * Stubbed for TDD: implementations land in subsequent commits.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ScopedFile {
  path: string;
  bucket: string;
  abs: string;
}

export interface ProseCluster {
  cluster: string[];
  score: number;
}

export interface DanglingFinding {
  source: string;
  line: number;
  target: string;
}

export interface FreshnessFinding {
  path: string;
  bucket: string;
  reason: string;
  cost: number;
}

export interface OwnershipFinding {
  kind: 'overlap' | 'orphan' | 'cycle' | 'missing';
  detail: string;
  skills: string[];
}

// ---------------------------------------------------------------------------
// proseDuplication: 5-gram shingles + Jaccard >= 0.4 over reference/skill/command
// ---------------------------------------------------------------------------

const PROSE_BUCKETS = new Set(['reference', 'skill', 'command']);
const SHINGLE_N = 5;
const JACCARD_THRESHOLD = 0.4;

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').split(/\s+/).filter(Boolean);
}

function shingles(text: string, n: number = SHINGLE_N): Set<string> {
  const toks = tokenize(text);
  const out = new Set<string>();
  for (let i = 0; i + n <= toks.length; i++) {
    out.add(toks.slice(i, i + n).join(' '));
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

export function proseDuplication(files: ScopedFile[]): ProseCluster[] {
  const eligible = files.filter(f => PROSE_BUCKETS.has(f.bucket) && f.path.endsWith('.md'));
  if (eligible.length < 2) return [];
  const sigs: { path: string; sh: Set<string> }[] = [];
  for (const f of eligible) {
    let body = '';
    try { body = fs.readFileSync(f.abs, 'utf8'); } catch { continue; }
    const sh = shingles(body);
    if (sh.size > 0) sigs.push({ path: f.path, sh });
  }
  // Union-find clustering
  const parent: Record<string, string> = {};
  const find = (x: string): string => {
    if (parent[x] === undefined) parent[x] = x;
    if (parent[x] === x) return x;
    parent[x] = find(parent[x]!);
    return parent[x]!;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (const s of sigs) find(s.path);
  for (let i = 0; i < sigs.length; i++) {
    for (let j = i + 1; j < sigs.length; j++) {
      if (jaccard(sigs[i]!.sh, sigs[j]!.sh) >= JACCARD_THRESHOLD) {
        union(sigs[i]!.path, sigs[j]!.path);
      }
    }
  }
  const groups = new Map<string, string[]>();
  for (const s of sigs) {
    const r = find(s.path);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(s.path);
  }
  const clusters: ProseCluster[] = [];
  for (const members of groups.values()) {
    if (members.length >= 2) {
      members.sort();
      clusters.push({ cluster: members, score: (members.length - 1) * 3 });
    }
  }
  clusters.sort((a, b) => b.score - a.score || a.cluster[0]!.localeCompare(b.cluster[0]!));
  return clusters;
}

// ---------------------------------------------------------------------------
// danglingReferences
// ---------------------------------------------------------------------------

const MD_LINK_RE = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const BACKTICK_PATH_RE = /`([^`\n]+)`/g;

function looksLikePath(s: string): boolean {
  // Heuristic: contains a slash and a filename with extension or known prefix.
  if (!s.includes('/')) return false;
  if (/\s/.test(s)) return false;
  if (s.startsWith('http://') || s.startsWith('https://')) return false;
  if (s.startsWith('#')) return false;
  // Strip anchor
  const noAnchor = s.split('#')[0]!;
  return /\.[a-zA-Z0-9]{1,6}$/.test(noAnchor) || /^(references|web|scripts|sims|learning|docs|themes|\.claude)\//.test(noAnchor);
}

function stripAnchor(s: string): string {
  const i = s.indexOf('#');
  return i >= 0 ? s.slice(0, i) : s;
}

export function danglingReferences(
  files: ScopedFile[],
  allTracked: Set<string>,
  rootDir: string
): DanglingFinding[] {
  const out: DanglingFinding[] = [];
  for (const f of files) {
    if (!f.path.endsWith('.md')) continue;
    let body = '';
    try { body = fs.readFileSync(f.abs, 'utf8'); } catch { continue; }
    const lines = body.split('\n');
    const seen = new Set<string>(); // dedupe per source-target
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li]!;
      const candidates: string[] = [];
      let m: RegExpExecArray | null;
      MD_LINK_RE.lastIndex = 0;
      while ((m = MD_LINK_RE.exec(line)) !== null) candidates.push(m[1]!);
      BACKTICK_PATH_RE.lastIndex = 0;
      while ((m = BACKTICK_PATH_RE.exec(line)) !== null) candidates.push(m[1]!);
      for (const raw of candidates) {
        if (raw.startsWith('http://') || raw.startsWith('https://')) continue;
        if (raw.startsWith('mailto:')) continue;
        if (raw.startsWith('#')) continue; // in-page anchor
        if (!looksLikePath(raw)) continue;
        const target = stripAnchor(raw);
        // Resolve relative to repo root (root-relative convention) or to source dir.
        const candidatesResolved = [target, path.posix.normalize(path.posix.join(path.posix.dirname(f.path), target))];
        let resolved = false;
        for (const cr of candidatesResolved) {
          if (allTracked.has(cr)) { resolved = true; break; }
          // Also accept if it exists on disk under root
          try {
            if (fs.existsSync(path.join(rootDir, cr))) { resolved = true; break; }
          } catch {}
        }
        if (resolved) continue;
        const key = `${target}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ source: f.path, line: li + 1, target });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// activityFreshness
// ---------------------------------------------------------------------------

const FRESH_BUCKETS = new Set(['code', 'skill', 'sim', 'reference']);
const STALE_DAYS = 90;
const FRESHNESS_CAP_PER_BUCKET = -10;

function hasArchivedFrontmatter(absPath: string): boolean {
  try {
    const head = fs.readFileSync(absPath, 'utf8').slice(0, 512);
    if (!head.startsWith('---')) return false;
    const end = head.indexOf('\n---', 3);
    if (end < 0) return false;
    const fm = head.slice(3, end);
    return /(^|\n)\s*archived\s*:\s*true\b/.test(fm);
  } catch { return false; }
}

function loadActivityPaths(rawJsonlPath: string, sinceMs: number): Set<string> {
  const refs = new Set<string>();
  try {
    if (!fs.existsSync(rawJsonlPath)) return refs;
    const body = fs.readFileSync(rawJsonlPath, 'utf8');
    for (const line of body.split('\n')) {
      if (!line.trim()) continue;
      let evt: any;
      try { evt = JSON.parse(line); } catch { continue; }
      const ts = evt.ts ? Date.parse(evt.ts) : (evt.timestamp ? Date.parse(evt.timestamp) : NaN);
      if (!Number.isFinite(ts) || ts < sinceMs) continue;
      // Walk values for path-like strings.
      const stack: any[] = [evt];
      while (stack.length) {
        const v = stack.pop();
        if (typeof v === 'string') {
          if (v.length < 256 && v.includes('/')) refs.add(v);
        } else if (v && typeof v === 'object') {
          for (const k of Object.keys(v)) stack.push(v[k]);
        }
      }
    }
  } catch {}
  return refs;
}

export function activityFreshness(
  files: ScopedFile[],
  rawJsonlPath: string,
  now: number,
  rootDir: string
): FreshnessFinding[] {
  const cutoff = now - STALE_DAYS * 24 * 3600 * 1000;
  const refs = loadActivityPaths(rawJsonlPath, cutoff);
  const perBucketCost: Record<string, number> = {};
  const out: FreshnessFinding[] = [];
  for (const f of files) {
    if (!FRESH_BUCKETS.has(f.bucket)) continue;
    let mtime = 0;
    try { mtime = fs.statSync(f.abs).mtimeMs; } catch { continue; }
    if (mtime >= cutoff) continue;
    if (refs.has(f.path)) continue;
    if (hasArchivedFrontmatter(f.abs)) continue;
    const used = perBucketCost[f.bucket] || 0;
    if (used <= FRESHNESS_CAP_PER_BUCKET) continue; // already capped
    perBucketCost[f.bucket] = used - 1;
    out.push({
      path: f.path,
      bucket: f.bucket,
      reason: 'no git mtime in 90d, no activity reference',
      cost: -1,
    });
  }
  // Mark rootDir referenced for lint, even though unused.
  void rootDir;
  return out;
}

// ---------------------------------------------------------------------------
// skillOwnershipIntegrity
// ---------------------------------------------------------------------------

export function skillOwnershipIntegrity(skillsDir: string): OwnershipFinding[] {
  const out: OwnershipFinding[] = [];
  if (!fs.existsSync(skillsDir)) return out;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(skillsDir, { withFileTypes: true }); } catch { return out; }
  const claims = new Map<string, string[]>(); // dir -> [skill names]
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const op = path.join(skillsDir, e.name, 'ownership.json');
    if (!fs.existsSync(op)) {
      out.push({ kind: 'missing', detail: `skill ${e.name} missing ownership.json`, skills: [e.name] });
      continue;
    }
    let parsed: any;
    try { parsed = JSON.parse(fs.readFileSync(op, 'utf8')); }
    catch (err: any) {
      out.push({ kind: 'orphan', detail: `skill ${e.name} ownership.json invalid: ${err.message}`, skills: [e.name] });
      continue;
    }
    const dirs: string[] = Array.isArray(parsed.dirs) ? parsed.dirs : [];
    for (const d of dirs) {
      const key = d.replace(/\/+$/, '');
      if (!key) continue;
      if (!claims.has(key)) claims.set(key, []);
      claims.get(key)!.push(e.name);
    }
  }
  for (const [dir, owners] of claims) {
    if (owners.length > 1) {
      // System-vault is intentionally claimed by multiple system-vault-* skills + setup.
      if (dir === 'learning/system-vault') continue;
      out.push({
        kind: 'overlap',
        detail: `dir ${dir} claimed by ${owners.join(', ')}`,
        skills: owners,
      });
    }
  }
  return out;
}

/** Wrap a list of findings, preserving order, limited to N. */
export function capFindings<T>(arr: T[], n: number): T[] {
  return arr.slice(0, n);
}

// CommonJS interop for require()-based test files.
module.exports = {
  proseDuplication,
  danglingReferences,
  activityFreshness,
  skillOwnershipIntegrity,
};
