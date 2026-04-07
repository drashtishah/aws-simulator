/**
 * Pure validator for fight-team Issue bodies.
 *
 * Enforces the 6 hard requirements from
 * .claude/skills/fight-team/references/issue-template.md so that every
 * Issue filed by fight-team is copy-paste-ready for a downstream /fix
 * plan with no extra research.
 *
 * Used by:
 * - .claude/skills/fight-team/SKILL.md coordinator (inline before gh issue create)
 * - web/test/fight-team-issue-format.test.ts (CI gate)
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
  '## Debate transcript excerpts',
  '## Labels',
  '## Linked context',
];

const DEBATE_LABELS = [
  'Challenger r1',
  'Defender r2 rebuttal',
  'Challenger r2 counter',
  'Steelman r3 by Defender',
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

export function validateFightTeamIssue(body: string): ValidationResult {
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

  // Rule 5: Debate transcript has >= 3 of the 4 bullet labels.
  const debate = sliceSection(body, '## Debate transcript excerpts');
  if (debate) {
    const found = DEBATE_LABELS.filter((label) => debate.includes(label));
    if (found.length < 3) {
      errors.push(
        `Debate transcript needs at least 3 of the 4 bullet labels (Challenger r1, Defender r2 rebuttal, Challenger r2 counter, Steelman r3 by Defender); found ${found.length}`,
      );
    }
  }

  return { valid: errors.length === 0, errors };
}
