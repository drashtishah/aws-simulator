'use strict';

/**
 * classify.ts
 *
 * Pure, I/O-free path classifier for the code-health scorer.
 *
 * Given a repo-relative path, returns the bucket it belongs to, or null if
 * the path is intentionally excluded from scoring (currently: .claude/plans).
 *
 * The completeness invariant in code-health.ts asserts that every entry
 * returned by `git ls-files` is either explicitly listed in `healthignore`
 * (with a reason) OR returns a non-null bucket here. Any unclassified path
 * fails the scorer loud.
 *
 * NEVER read the filesystem from this module. NEVER throw. The only output
 * is a bucket name string or null.
 */

export type Bucket =
  | 'code'
  | 'test'
  | 'skill'
  | 'command'
  | 'hook'
  | 'sim'
  | 'reference'
  | 'registry'
  | 'config'
  | 'memory_link';

export const BUCKETS: Bucket[] = [
  'code',
  'test',
  'skill',
  'command',
  'hook',
  'sim',
  'reference',
  'registry',
  'config',
  'memory_link',
];

/** Plans are explicitly excluded from health scoring, per feedback_no_plan_scoring. */
const EXCLUDED_PREFIXES: string[] = [
  '.claude/plans/',
];

function normalize(p: string): string {
  let n = p.replace(/\\/g, '/');
  if (n.startsWith('./')) n = n.slice(2);
  return n;
}

/**
 * Classify a repo-relative path into one of the BUCKETS, or null if excluded.
 *
 * Rules are evaluated in order; first match wins. Order matters because
 * directories overlap (e.g. .claude/hooks/*.ts is both "a hook" and "code").
 * The plan defines hooks as their own bucket, so hook beats code.
 */
export function classify(rawPath: string): Bucket | null {
  if (!rawPath || typeof rawPath !== 'string') return null;
  const p = normalize(rawPath);

  for (const prefix of EXCLUDED_PREFIXES) {
    if (p.startsWith(prefix)) return null;
  }

  if (p.startsWith('web/test/')) return 'test';
  if (p.startsWith('web/test-specs/')) return 'test';

  if (p.startsWith('.claude/hooks/')) return 'hook';
  if (p.startsWith('.claude/skills/')) return 'skill';
  if (p.startsWith('.claude/commands/')) return 'command';

  if (p.startsWith('sims/')) return 'sim';

  if (p.startsWith('references/registries/')) return 'registry';
  if (p.startsWith('references/')) return 'reference';

  if (
    p.startsWith('learning/') ||
    p.startsWith('docs/') ||
    p.startsWith('themes/') ||
    p === 'CLAUDE.md' ||
    p === 'README.md'
  ) {
    return 'memory_link';
  }

  if (p.startsWith('web/lib/')) return 'code';
  if (p.startsWith('web/public/')) return 'code';
  if (p === 'web/server.ts') return 'code';
  if (
    p.startsWith('scripts/') &&
    (p.endsWith('.ts') || p.endsWith('.js') || p.endsWith('.py'))
  ) {
    return 'code';
  }

  if (
    p.startsWith('.claude/scheduled-jobs/') ||
    p.startsWith('.claude/state/') ||
    p === '.claude/settings.json' ||
    p === '.claude/settings.local.json' ||
    p === '.mcp.json' ||
    p === '.gitignore' ||
    p === 'mypy.ini' ||
    p === 'package.json' ||
    p === 'package-lock.json' ||
    p === 'tsconfig.json' ||
    p === 'tsconfig.frontend.json' ||
    (p.startsWith('scripts/') && p.endsWith('.json'))
  ) {
    return 'config';
  }

  return null;
}

/** Convenience: deterministic equal bucket weights. */
export function defaultBucketWeights(): Record<Bucket, number> {
  const w: Partial<Record<Bucket, number>> = {};
  const each = 1 / BUCKETS.length;
  for (const b of BUCKETS) w[b] = each;
  return w as Record<Bucket, number>;
}

// CommonJS interop so existing test files using require() can import this.
module.exports = { classify, BUCKETS, defaultBucketWeights };
module.exports.classify = classify;
module.exports.BUCKETS = BUCKETS;
module.exports.defaultBucketWeights = defaultBucketWeights;
