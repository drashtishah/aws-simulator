// sim-test-select: pure helpers for sim-test run selection flags.
// Used by scripts/sim-test.ts to support `run --files <glob>` and
// `run --changed`. Kept as a separate module so it can be unit-tested
// without triggering the CLI entrypoint in sim-test.ts.

import path from 'node:path';

// ---------------------------------------------------------------------------
// Glob matching
// ---------------------------------------------------------------------------

// Converts a subset of glob syntax into a RegExp. Supported tokens:
//   **   any number of path segments (including zero)
//   *    any characters except a forward slash
//   ?    exactly one character except a forward slash
// All other regex metacharacters are escaped to literal matches.
export function globToRegExp(glob: string): RegExp {
  let re = '^';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!;
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
      } else {
        re += '[^/]*';
      }
    } else if (ch === '?') {
      re += '[^/]';
    } else if ('.+^$(){}|[]\\'.includes(ch)) {
      re += '\\' + ch;
    } else {
      re += ch;
    }
  }
  re += '$';
  return new RegExp(re);
}

// Filters a list of relative file paths by a glob pattern.
export function filterByGlob(files: string[], glob: string): string[] {
  const re = globToRegExp(glob);
  return files.filter((f) => re.test(f));
}

// ---------------------------------------------------------------------------
// Changed-file to test-file mapping
// ---------------------------------------------------------------------------

export interface MapChangedOptions {
  hasTest: (relPath: string) => boolean;
  testDir?: string;
}

export interface MapChangedResult {
  tests: string[];
  warnings: string[];
}

// Given a list of changed file paths (relative to repo root), returns the
// set of test files that should run, plus any warnings for changed source
// files that have no co-located test.
//
// Rules:
//   1. If a changed file is itself a test (matches web/test/*.test.ts),
//      include it directly.
//   2. Otherwise, if the file is a code file (.ts/.tsx/.js/.cjs/.mjs),
//      look for web/test/<basename>.test.ts where <basename> is the file's
//      name without extension. If found, include it. If not, warn.
//   3. Non-code files (markdown, json, etc.) are ignored silently.
export function mapChangedToTests(
  changed: string[],
  opts: MapChangedOptions,
): MapChangedResult {
  const testDir = (opts.testDir ?? 'web/test').replace(/\\/g, '/');
  const codeExts = new Set(['.ts', '.tsx', '.js', '.cjs', '.mjs']);
  const tests = new Set<string>();
  const warnings: string[] = [];

  for (const raw of changed) {
    if (!raw) continue;
    const rel = raw.replace(/\\/g, '/');

    // Case 1: already a test file under testDir
    if (rel.startsWith(testDir + '/') && rel.endsWith('.test.ts')) {
      if (opts.hasTest(rel)) {
        tests.add(rel);
      } else {
        warnings.push('changed test file not found on disk: ' + rel);
      }
      continue;
    }

    const ext = path.extname(rel);
    if (!codeExts.has(ext)) continue;

    const base = path.basename(rel, ext);
    // Strip a trailing .test if someone changed a test file outside testDir.
    const stem = base.endsWith('.test') ? base.slice(0, -'.test'.length) : base;
    const candidate = testDir + '/' + stem + '.test.ts';
    if (opts.hasTest(candidate)) {
      tests.add(candidate);
    } else {
      warnings.push(
        'no co-located test for changed file: ' + rel +
          ' (expected ' + candidate + ')',
      );
    }
  }

  return { tests: Array.from(tests).sort(), warnings };
}
