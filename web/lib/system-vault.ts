// System vault library (PR-E).
//
// Provides the deterministic primitives used by the system-vault-compile,
// system-vault-query, system-vault-dream, and system-vault-prune skills:
//
// - Vault layout constants (root, subdirs, state files).
// - Size and line budgets used by the skills and enforced by tests.
// - Index file validation (index.md must be <= 200 lines).
// - Topic file size validation (every topic file <= 4KB).
// - Query budget accounting (5 files per turn, 4KB per file, 20KB per turn,
//   60KB per session).
// - Dream phase plan validation (4 phases, atomic, cannot delete findings
//   linked from any other vault file).
// - Log rotation predicate (only-referenced rotation, refuses out-of-window
//   deletes).
//
// The skills (markdown) invoke these behaviors conceptually; the functions
// here give the tests a deterministic target and give any future Node
// consumers a single source of truth for the budgets.

import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export const VAULT_SUBDIRS: readonly string[] = [
  'health',
  'findings',
  'workarounds',
  'decisions',
  'sessions',
  'components',
  'dreams',
];

export interface VaultLayout {
  root: string;
  index: string;
  obsidian: string;
}

export function layout(learningDir: string): VaultLayout {
  const root = path.join(learningDir, 'system-vault');
  return {
    root,
    index: path.join(root, 'index.md'),
    obsidian: path.join(root, '.obsidian'),
  };
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

export const INDEX_MAX_LINES: number = 200;
export const TOPIC_FILE_MAX_BYTES: number = 4 * 1024;
export const QUERY_MAX_FILES_PER_TURN: number = 5;
export const QUERY_MAX_BYTES_PER_FILE: number = 4 * 1024;
export const QUERY_MAX_BYTES_PER_TURN: number = 20 * 1024;
export const QUERY_MAX_BYTES_PER_SESSION: number = 60 * 1024;

// ---------------------------------------------------------------------------
// Index and topic file validation
// ---------------------------------------------------------------------------

export interface IndexCheck {
  ok: boolean;
  lines: number;
  error?: string;
}

export function checkIndex(indexPath: string): IndexCheck {
  if (!fs.existsSync(indexPath)) {
    return { ok: false, lines: 0, error: 'index.md missing' };
  }
  const lines = fs.readFileSync(indexPath, 'utf8').split('\n').length;
  if (lines > INDEX_MAX_LINES) {
    return {
      ok: false,
      lines,
      error: 'index.md has ' + lines + ' lines, max ' + INDEX_MAX_LINES,
    };
  }
  return { ok: true, lines };
}

export interface TopicCheck {
  ok: boolean;
  offenders: Array<{ file: string; bytes: number }>;
}

export function checkTopicSizes(vaultRoot: string): TopicCheck {
  const offenders: Array<{ file: string; bytes: number }> = [];
  if (!fs.existsSync(vaultRoot)) return { ok: true, offenders };
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(p);
        continue;
      }
      if (!entry.name.endsWith('.md')) continue;
      if (path.relative(vaultRoot, p) === 'index.md') continue;
      const bytes = fs.statSync(p).size;
      if (bytes > TOPIC_FILE_MAX_BYTES) {
        offenders.push({ file: path.relative(vaultRoot, p), bytes });
      }
    }
  };
  walk(vaultRoot);
  return { ok: offenders.length === 0, offenders };
}

// ---------------------------------------------------------------------------
// Query budgets
// ---------------------------------------------------------------------------

export class QueryBudget {
  private turnBytes: number = 0;
  private turnFiles: number = 0;
  private sessionBytes: number = 0;

  reset(): void {
    this.turnBytes = 0;
    this.turnFiles = 0;
  }

  admit(fileBytes: number): { ok: boolean; reason?: string } {
    if (fileBytes > QUERY_MAX_BYTES_PER_FILE) {
      return { ok: false, reason: 'file exceeds 4KB' };
    }
    if (this.turnFiles + 1 > QUERY_MAX_FILES_PER_TURN) {
      return { ok: false, reason: 'turn file count exceeded' };
    }
    if (this.turnBytes + fileBytes > QUERY_MAX_BYTES_PER_TURN) {
      return { ok: false, reason: 'turn byte budget exceeded' };
    }
    if (this.sessionBytes + fileBytes > QUERY_MAX_BYTES_PER_SESSION) {
      return { ok: false, reason: 'session byte budget exceeded' };
    }
    this.turnFiles += 1;
    this.turnBytes += fileBytes;
    this.sessionBytes += fileBytes;
    return { ok: true };
  }

  snapshot(): { turnFiles: number; turnBytes: number; sessionBytes: number } {
    return {
      turnFiles: this.turnFiles,
      turnBytes: this.turnBytes,
      sessionBytes: this.sessionBytes,
    };
  }
}

// ---------------------------------------------------------------------------
// Dream phases
// ---------------------------------------------------------------------------

export const DREAM_PHASES: readonly string[] = [
  'orient',
  'gather_signal',
  'consolidate',
  'prune_and_index',
];

export interface DreamPlan {
  phases: string[];
  deletes: string[];
}

export interface DreamValidation {
  ok: boolean;
  error?: string;
}

// Atomic: all four phases required, in order, or the plan is rejected.
// Cannot delete: any markdown file under findings/ that is referenced by
// any other vault file via a `[[wikilink]]` or `(relative/path.md)` link.
export function validateDreamPlan(
  plan: DreamPlan,
  vaultRoot: string,
): DreamValidation {
  if (plan.phases.length !== DREAM_PHASES.length) {
    return { ok: false, error: 'dream plan must have exactly 4 phases' };
  }
  for (let i = 0; i < DREAM_PHASES.length; i++) {
    if (plan.phases[i] !== DREAM_PHASES[i]) {
      return {
        ok: false,
        error: 'dream phase ' + i + ' must be ' + DREAM_PHASES[i],
      };
    }
  }
  const linked = linkedFindings(vaultRoot);
  for (const del of plan.deletes) {
    const norm = del.replace(/^\.\//, '');
    if (norm.startsWith('findings/') && linked.has(norm)) {
      return {
        ok: false,
        error: 'cannot delete linked finding: ' + norm,
      };
    }
  }
  return { ok: true };
}

function linkedFindings(vaultRoot: string): Set<string> {
  const linked = new Set<string>();
  if (!fs.existsSync(vaultRoot)) return linked;
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(p);
      } else if (entry.name.endsWith('.md')) {
        files.push(p);
      }
    }
  };
  walk(vaultRoot);
  // Build set of existing findings names (basename without .md).
  const findingsDir = path.join(vaultRoot, 'findings');
  const findingNames = new Map<string, string>(); // name -> relpath
  if (fs.existsSync(findingsDir)) {
    for (const entry of fs.readdirSync(findingsDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        const base = entry.name.slice(0, -3);
        findingNames.set(base, path.posix.join('findings', entry.name));
      }
    }
  }
  const wikiRe = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
  const mdLinkRe = /\]\(([^)]+\.md)\)/g;
  for (const f of files) {
    // Don't count self-references inside findings directory.
    const rel = path.relative(vaultRoot, f).replace(/\\/g, '/');
    if (rel.startsWith('findings/')) continue;
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(wikiRe)) {
      const target = m[1]!.trim();
      if (findingNames.has(target)) linked.add(findingNames.get(target)!);
    }
    for (const m of text.matchAll(mdLinkRe)) {
      const target = m[1]!.trim().replace(/^\.\//, '');
      if (target.startsWith('findings/') && findingNames.has(path.basename(target, '.md'))) {
        linked.add(target);
      }
    }
  }
  return linked;
}

// ---------------------------------------------------------------------------
// Log rotation: only-referenced rotation, refuses out-of-window deletes.
// ---------------------------------------------------------------------------

export interface RotationRequest {
  archiveName: string; // e.g. raw.jsonl.2026-04-06.gz
  nowIso: string; // current time
  referencedArchives: Set<string>; // archives actually linked from vault
}

export interface RotationDecision {
  allow: boolean;
  reason?: string;
}

// Only archives whose date is >= 7 days old may be deleted, and only if
// no vault file still references them (referencedArchives is the set of
// archive filenames still linked).
export function canRotate(req: RotationRequest): RotationDecision {
  const m = req.archiveName.match(/raw\.jsonl\.(\d{4}-\d{2}-\d{2})\.gz$/);
  if (!m) {
    return { allow: false, reason: 'archive name does not match raw.jsonl.YYYY-MM-DD.gz' };
  }
  if (req.referencedArchives.has(req.archiveName)) {
    return { allow: false, reason: 'archive still referenced by vault' };
  }
  const archiveDate = new Date(m[1]! + 'T00:00:00Z').getTime();
  const now = new Date(req.nowIso).getTime();
  const ageDays = (now - archiveDate) / (1000 * 60 * 60 * 24);
  if (ageDays < 7) {
    return { allow: false, reason: 'archive inside 7-day retention window' };
  }
  if (ageDays > 90) {
    return { allow: false, reason: 'archive outside rotation window (>90 days)' };
  }
  return { allow: true };
}
