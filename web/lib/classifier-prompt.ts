import path from 'node:path';
import * as paths from './paths.js';

const COACHING_PATTERNS_PATH = path.join(
  paths.ROOT, '.claude', 'skills', 'play', 'references', 'coaching-patterns.md'
);
const PROGRESSION_PATH = path.join(paths.ROOT, 'references', 'config', 'progression.yaml');
const VERIFIER_PATH = path.join(paths.ROOT, 'scripts', 'verify-classification.ts');

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

Do NOT read: the player profile, the services catalog, or vault notes. Those are handled by the deterministic Tier 2 renderer after you finish.

Steps:
1. Read the transcript at ${turnsPath}. Count the total player turns.
2. For each player turn (index 1-based), classify it on eight fields:
   - question_type: one of gather, diagnose, correlate, impact, trace, fix
   - effectiveness: integer 1-8 (1=off-track, 4=adequate, 8=excellent)
   - services: array of AWS service slugs the turn engaged. Draw from manifest.services and manifest.tags; normalize to lowercase kebab-case (e.g. "ec2", "vpc", "security-groups", "cloudformation"). Empty array [] only when the turn is purely meta (e.g. "debrief please") and touches no service.
   - concepts: array of concept slugs the turn exercised. Source in priority order: (a) manifest.resolution.learning_objectives paraphrased to kebab-case slugs, (b) manifest.glossary keys lowercased and hyphenated, (c) concepts the player or narrator named in prose (e.g. "default-deny", "stateful-firewall", "infrastructure-as-code"). Empty array [] if the turn surfaced no new concept.
   - beats: array of narrative beat ids the turn fired. Two sources: (a) manifest.resolution.fix_criteria[].id when the player satisfied that criterion in this turn (e.g. "identify_security_group", "propose_fix"), (b) short kebab-case slugs for root-cause reveals listed in manifest.resolution.root_cause or system.what_broke (e.g. "hardening-sprint-revealed"). Empty array [] if no beat fired.
   - uncertainty: boolean. true when the player's message in this turn expresses confusion, admits not knowing a term, uses a concept wrong, or asks a clarifying question about terminology ("what does X mean", "i don't know what X is", "isn't X the same as Y"). false otherwise.
   - note: short string (<= 120 chars), narrator-side observation of what the player did or where they struggled. Examples: "named both firewall layers", "spotted missing 443 rule", "asked about IaC unprompted", "confused by SSH-from-VPC scoping". Empty string "" only for meta turns with nothing to observe.
   Follow the classification and scoring rules in coaching-patterns.md.
3. Write one JSON object per line to ${outputPath}. Each line must have EXACTLY these eight fields, no more, no fewer:
   {"index": <number>, "question_type": "<type>", "effectiveness": <number>, "services": [<strings>], "concepts": [<strings>], "beats": [<strings>], "uncertainty": <boolean>, "note": "<string>"}
   Arrays may be empty but must be present. No trailing comma. Valid JSON per line.
4. Self-validation: after writing, run the verifier with Bash:
     npx tsx ${VERIFIER_PATH} ${simId}
   Exit 0 means valid; stdout shows "OK: classification.jsonl valid: N rows matching N turns".
   Non-zero means invalid; stderr lists one or more "FAIL:" lines. Common failures:
     - row count mismatch (you wrote too many or too few lines)
     - duplicate or missing index
     - effectiveness out of range 1-8
     - missing or wrong-typed field (schema error)
     - note too short for a non-meta turn (must be >= 10 chars when the turn touched any service/concept/beat)
   If the verifier fails, fix the offending rows in ${outputPath} and re-run the verifier. Repeat until it exits 0. Do not proceed to step 5 until the verifier passes.

5. After the verifier passes, update ${sessionPath} with the session-level rollup:
- investigation_summary: 1-3 sentences of prose naming the path the player took, what they got right, and where they hesitated. No spoilers from resolution.md beyond what the player uncovered.
- story_beats_fired: deduplicated union of every beats array from classification.jsonl.
- services_queried: deduplicated union of every services array from classification.jsonl.
- question_profile: for each axis (gather/diagnose/correlate/impact/trace/fix), set count = number of turns with that question_type, and effective = number of those turns with effectiveness >= 5.

Do not write to any other path. Write policy enforced in code.`;
}
