#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';

export const VALID_SECTIONS: string[] = [
  'Scope',
  'Files to read',
  'Files to change',
  'Files NOT to touch',
  'Tests',
  'Verification command',
  'Risks / open questions',
  'Decomposition (only if split occurred)',
];

/**
 * Replaces the content of one ### section in a plan body string.
 * Throws if the section header is not found.
 * Uses a fence-aware line tokenizer so ### inside code fences are not
 * treated as section anchors.
 */
export function patchBody(body: string, section: string, newContent: string): string {
  const header = `### ${section}`;
  const lines = body.split('\n');
  let inFence = false;
  let pos = 0;
  let headerEnd = -1;   // byte position immediately after the header line text
  let nextStart = -1;   // byte position of the next out-of-fence ### line

  for (const line of lines) {
    if (/^(`{3,}|~{3,})/.test(line)) {
      inFence = !inFence;
    }
    if (!inFence) {
      if (headerEnd === -1 && line === header) {
        headerEnd = pos + line.length;
      } else if (headerEnd !== -1 && line.startsWith('### ')) {
        nextStart = pos;
        break;
      }
    }
    pos += line.length + 1; // +1 for the \n separator
  }

  if (headerEnd === -1) {
    throw new Error(`Section not found: "${header}"`);
  }
  if (nextStart === -1) {
    return body.slice(0, headerEnd) + '\n' + newContent + '\n';
  }
  return (
    body.slice(0, headerEnd) +
    '\n' +
    newContent +
    '\n' +
    body.slice(nextStart)
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

const isMain = process.argv[1]?.endsWith('patch-plan.ts') || process.argv[1]?.endsWith('patch-plan');
if (isMain) {
  main();
}
