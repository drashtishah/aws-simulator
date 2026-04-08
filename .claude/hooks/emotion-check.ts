#!/usr/bin/env npx tsx
// .claude/hooks/emotion-check.ts
//
// PostToolUse hook that prompts Claude to write a salience-triggered note
// after long or exciting turns. The rule this reinforces lives in memory
// feedback_note_on_salience.md. Fires at most once every 5 minutes per
// session so it does not spam.
//
// Registered in .claude/settings.json under PostToolUse for Bash and Task
// matchers (the two tools that produce the longest outputs).

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

interface HookInput {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  session_id?: string;
  [key: string]: unknown;
}

let input = '';
process.stdin.on('data', (d: Buffer) => input += d);
process.stdin.on('end', () => {
  try {
    const data: HookInput = JSON.parse(input);
    const sessionId: string | undefined = data.session_id;
    if (!sessionId) process.exit(0);

    // Fire at most once per 5-minute window per session to avoid spam.
    const marker: string = path.join(os.tmpdir(), `claude-salience-check-${sessionId}`);
    if (fs.existsSync(marker)) {
      const mtime = fs.statSync(marker).mtimeMs;
      if (Date.now() - mtime < 5 * 60 * 1000) process.exit(0);
    }
    fs.writeFileSync(marker, '');

    process.stdout.write([
      '',
      '[Salience check]',
      'Did anything in the last few turns register as surprising, interesting,',
      'frustrating, or did you catch yourself being wrong about something?',
      '',
      'If yes, write a note NOW before the moment cools:',
      '  tsx scripts/note.ts --kind finding --topic <slug> --body "..."',
      '  tsx scripts/note.ts --kind negative_result --topic <slug> --body "..."',
      '  tsx scripts/note.ts --kind decision --topic <slug> --body "..."',
      '',
      'If no, continue without writing a note. This is a prompt, not a requirement.',
      'Rule: memory feedback_note_on_salience.md. Any emotion, positive or negative,',
      'is a valid signal. Bodies are now uncapped (Issue #119), so write the full thought.',
      '',
    ].join('\n'));
    process.exit(0);
  } catch {
    process.exit(0);
  }
});
