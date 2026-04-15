import path from 'node:path';
import * as paths from './paths.js';

const COACHING_PATTERNS_PATH = path.join(
  paths.ROOT, '.claude', 'skills', 'play', 'references', 'coaching-patterns.md'
);
const PROGRESSION_PATH = path.join(paths.ROOT, 'references', 'config', 'progression.yaml');

/**
 * Builds the Tier 1 classifier prompt for the post-session agent.
 * The agent reads the transcript, session metadata, manifest, and coaching
 * patterns, then writes one classification.jsonl row per player turn.
 * It does NOT read or write profile.json, catalog.csv, or the player vault.
 */
export function buildClassifierPrompt(simId: string): string {
  const turnsPath = paths.turnsFile(simId);
  const sessionPath = paths.sessionFile(simId);
  const manifestPath = paths.manifest(simId);
  const outputPath = path.join(paths.sessionDir(simId), 'classification.jsonl');

  return `You are the post-session analysis agent. The play session just ended.

Your job: classify each player turn into a question_type axis and score its effectiveness. Write the results to a JSONL file.

Read:
- Transcript: ${turnsPath}
- Session metadata: ${sessionPath}
- Sim manifest (fix_criteria and learning_objectives only): ${manifestPath}
- Coaching patterns (classification + scoring rules): ${COACHING_PATTERNS_PATH}
- Progression config (axis definitions only): ${PROGRESSION_PATH}

Do NOT read: the player profile, the services catalog, or any file under learning/player-vault/. Those are handled by the deterministic Tier 2 renderer after you finish.

Steps:
1. Read the transcript at ${turnsPath}. Count the total player turns.
2. For each player turn (index 1-based), classify it:
   - question_type: one of gather, diagnose, correlate, impact, trace, fix
   - effectiveness: integer 1-8 (1=off-track, 4=adequate, 8=excellent)
   Follow the classification and scoring rules in coaching-patterns.md.
3. Write one JSON object per line to ${outputPath}. Each line must have exactly these fields:
   {"index": <number>, "question_type": "<type>", "effectiveness": <number>}
   No extra fields. No trailing comma. Valid JSON per line.
4. Self-validation turn: after writing, re-read ${outputPath}. Count lines (excluding blank). Confirm count matches total player turns from step 1. If any line is malformed or count mismatches, overwrite the file with corrected output and re-validate.

Set session status to "completed" in ${sessionPath} after writing classification.jsonl.

Do not write to any other path. Write policy enforced in code.`;
}
