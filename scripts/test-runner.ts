// test-runner: pure helpers for test run output parsing and
// aggregation. Extracted from scripts/test.ts so they can be unit-tested
// without spawning the CLI (node:test refuses to spawn itself recursively).
//
// Used by scripts/test.ts to detect failed test files and emit a clear
// FAIL <basename>: <N> failure(s) line per file plus a final summary block.
// Group A of plan .claude/plans/replicated-exploring-thompson.md (Issue #92).

import path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedTestOutput {
  passed: number;
  failed: number;
}

export interface FileRunResult {
  file: string;
  passed: number;
  failed: number;
  error: boolean;
}

export interface UnitAggregateResult {
  total: number;
  passed: number;
  failed: number;
  failedFiles: string[];
  hasError: boolean;
}

// ---------------------------------------------------------------------------
// parseTestOutput
// ---------------------------------------------------------------------------

// Parses the pass/fail counters from a node:test (or tsx --test) run.
// Both `# pass N` (node) and `ℹ pass N` (tsx) summary styles are accepted.
// Missing counters default to 0 so a malformed or empty run is treated as
// "no tests detected" by aggregateRuns rather than crashing.
export function parseTestOutput(out: string): ParsedTestOutput {
  const passMatch = out.match(/(?:# pass|ℹ pass) (\d+)/);
  const failMatch = out.match(/(?:# fail|ℹ fail) (\d+)/);
  return {
    passed: passMatch ? parseInt(passMatch[1]!, 10) : 0,
    failed: failMatch ? parseInt(failMatch[1]!, 10) : 0,
  };
}

// ---------------------------------------------------------------------------
// aggregateRuns
// ---------------------------------------------------------------------------

// Folds a list of per-file results into the aggregate `unit` block that
// test run emits. failedFiles holds the basenames of files where
// failed > 0, in the order they appeared, deduplicated. hasError reflects
// the existing "infrastructure error" path: any file whose run produced no
// detectable test output (passed === 0 && failed === 0 && !signal) flips
// hasError true.
export function aggregateRuns(runs: FileRunResult[]): UnitAggregateResult {
  let passed = 0;
  let failed = 0;
  let hasError = false;
  const failedFiles: string[] = [];
  const seen = new Set<string>();

  for (const r of runs) {
    passed += r.passed;
    failed += r.failed;
    if (r.error) hasError = true;
    if (r.failed > 0) {
      const base = path.basename(r.file);
      if (!seen.has(base)) {
        seen.add(base);
        failedFiles.push(base);
      }
    }
  }

  return {
    total: passed + failed,
    passed,
    failed,
    failedFiles,
    hasError,
  };
}

// ---------------------------------------------------------------------------
// formatFailedFilesSummary
// ---------------------------------------------------------------------------

// Formats the final block listing every failed file basename. Returns an
// empty string when nothing failed so the caller can unconditionally append
// it to console output without an extra check.
export function formatFailedFilesSummary(failedFiles: string[]): string {
  if (failedFiles.length === 0) return '';
  const header = 'Failed test files (' + failedFiles.length + '):';
  const lines = failedFiles.map((f) => '  - ' + f);
  return header + '\n' + lines.join('\n') + '\n';
}
