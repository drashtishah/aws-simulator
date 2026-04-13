#!/usr/bin/env npx tsx
// PreToolUse hook for ExitPlanMode: injects Karpathy behavioral guidelines
// as additional context so the plan is checked before finalization.

import fs from 'node:fs';
import path from 'node:path';

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const guidelinesPath = path.join(root, 'references', 'guidelines', 'karpathy.md');

try {
  const content = fs.readFileSync(guidelinesPath, 'utf8');

  const output = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext:
        'BEFORE FINALIZING THIS PLAN, verify it against Karpathy guidelines:\n\n' +
        content +
        '\n\nCheck: Does the plan follow simplicity first? Are changes surgical? ' +
        'Are success criteria verifiable? Any speculative features or unnecessary abstractions?'
    }
  });

  process.stdout.write(output);
} catch {
  // Guidelines file missing; skip silently.
}
process.exit(0);
