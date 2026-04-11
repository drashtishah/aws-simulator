/**
 * Pure validator for doc Issue bodies.
 *
 * Enforces the 6 hard requirements from
 * .claude/skills/doc/references/issue-template.md so that every
 * Issue filed by doc is copy-paste-ready for a downstream /fix
 * plan with no extra research.
 *
 * Used by:
 * - .claude/skills/doc/SKILL.md coordinator (inline before gh issue create)
 * - web/test/doc-issue-format.test.ts (CI gate)
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const REQUIRED_SECTIONS = [
  '## Finding',
  '## Bucket and metric',
  '## Evidence',
  '## Current behavior',
  '## Expected behavior',
  '## Suggested approach',
  '## Verification',
  '## Review excerpts',
  '## Labels',
  '## Linked context',
];

const REVIEW_LABELS = [
  'Challenger lens',
  'Defender lens',
  'Steelman pass',
];

// Match an absolute path ending in one of the allowed extensions plus :line.
// Absolute means starts with `/`. Allowed extensions: ts, md, json, jsonl, js.
const ABSOLUTE_PATH_LINE = /(^|[\s`(])(\/[^\s`)]+\.(ts|md|json|jsonl|js)):(\d+)/;
const ANY_PATH_LINE = /([^\s`)]+\.(ts|md|json|jsonl|js)):(\d+)/;

// A numbered step that names some path-like token.
const NUMBERED_STEP_WITH_PATH = /^\s*\d+\.\s.*[\/\.][\w\-\/.]+\.(ts|md|json|jsonl|js|sh|yaml|yml)/m;

const FENCED_CODE_BLOCK = /```[\s\S]*?```/;

function sliceSection(body: string, heading: string): string {
  const idx = body.indexOf(heading);
  if (idx === -1) return '';
  const rest = body.slice(idx + heading.length);
  // Stop at the next ## heading.
  const next = rest.search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next);
}

export function validateDocIssue(body: string): ValidationResult {
  const errors: string[] = [];

  // Rule 6: length 600 to 4000.
  if (body.length < 600) {
    errors.push(`body too short: ${body.length} chars (min 600)`);
  }
  if (body.length > 4000) {
    errors.push(`body too long: ${body.length} chars (max 4000)`);
  }

  // Rule 1: all required sections present.
  for (const section of REQUIRED_SECTIONS) {
    if (!body.includes(section)) {
      errors.push(`missing required section: ${section}`);
    }
  }

  // Rule 2: Evidence has at least 1 absolute path:line.
  const evidence = sliceSection(body, '## Evidence');
  if (evidence) {
    const absMatch = evidence.match(ABSOLUTE_PATH_LINE);
    if (!absMatch) {
      // If a non-absolute path:line is present, give a more specific error.
      const anyMatch = evidence.match(ANY_PATH_LINE);
      if (anyMatch) {
        errors.push(
          `Evidence has path:line but it is not absolute: "${anyMatch[0]}". Absolute paths only (must start with /).`,
        );
      } else {
        errors.push(
          'Evidence section needs at least 1 path:line citation matching .(ts|md|json|jsonl|js):<line>',
        );
      }
    }
  }

  // Rule 3: Suggested approach has at least 1 numbered step naming a path.
  const suggested = sliceSection(body, '## Suggested approach');
  if (suggested && !NUMBERED_STEP_WITH_PATH.test(suggested)) {
    errors.push(
      'Suggested approach needs at least 1 numbered step that names a file path',
    );
  }

  // Rule 4: Verification has at least 1 fenced code block.
  const verification = sliceSection(body, '## Verification');
  if (verification && !FENCED_CODE_BLOCK.test(verification)) {
    errors.push('Verification section needs at least 1 fenced code block');
  }

  // Rule 5: Review excerpts has all 3 bullet labels.
  const review = sliceSection(body, '## Review excerpts');
  if (review) {
    const found = REVIEW_LABELS.filter((label) => review.includes(label));
    if (found.length < 3) {
      errors.push(
        `Review excerpts needs all 3 bullet labels (Challenger lens, Defender lens, Steelman pass); found ${found.length}`,
      );
    }
  }

  return { valid: errors.length === 0, errors };
}
