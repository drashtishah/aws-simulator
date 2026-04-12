#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';

export const VALID_SECTIONS: string[] = [
  'Scope',
  'Files to read',
  'Files to change',
  'Tests',
  'Verification command',
  'Risks / open questions',
];

/**
 * Replaces the content of one ### section in a plan body string.
 * Throws if the section header is not found.
 */
export function patchBody(body: string, section: string, newContent: string): string {
  const header = `### ${section}`;
  const headerIndex = body.indexOf(header);
  if (headerIndex === -1) {
    throw new Error(`Section not found: "${header}"`);
  }
  const afterHeader = headerIndex + header.length;
  const nextHeaderIndex = body.indexOf('\n### ', afterHeader);
  if (nextHeaderIndex === -1) {
    return body.slice(0, afterHeader) + '\n' + newContent + '\n';
  }
  return (
    body.slice(0, afterHeader) +
    '\n' +
    newContent +
    '\n' +
    body.slice(nextHeaderIndex + 1)
  );
}

function parseArgs(): { issue: number; section: string } {
  const args = process.argv.slice(2);
  let issue: number | undefined;
  let section: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const next = args[i + 1];
    if (args[i] === '--issue' && next !== undefined) {
      i++;
      issue = parseInt(next, 10);
    } else if (args[i] === '--section' && next !== undefined) {
      i++;
      section = next;
    }
  }
  if (!issue || !section) {
    console.error('Usage: patch-plan.ts --issue <n> --section "<name>"');
    process.exit(1);
  }
  return { issue, section };
}

function main(): void {
  const { issue, section } = parseArgs();

  if (!VALID_SECTIONS.includes(section)) {
    console.error(
      `Unknown section: "${section}". Valid sections: ${VALID_SECTIONS.join(', ')}`
    );
    process.exit(1);
  }

  const newContent = readFileSync(0, 'utf8').trim();

  const body = execSync(
    `gh issue view ${issue} --json body -q .body`,
    { encoding: 'utf8' }
  ).trim();

  let patched: string;
  try {
    patched = patchBody(body, section, newContent);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  const tmpFile = '/tmp/patched-plan.md';
  writeFileSync(tmpFile, patched, 'utf8');
  execSync(`gh issue edit ${issue} --body-file ${tmpFile}`);
  console.log(`Patched section "${section}" in issue #${issue}`);
}

if (process.argv[1] && process.argv[1].endsWith('patch-plan.ts')) {
  main();
}
