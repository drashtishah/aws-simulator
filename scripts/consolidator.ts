import { query } from '@anthropic-ai/claude-agent-sdk';
import * as paths from '../web/lib/paths.js';
import { CONSOLIDATOR_POLICY } from '../web/lib/agent-policies.js';
import { collectMessages } from '../web/lib/claude-parse.js';
import { logEvent } from '../web/lib/logger.js';

// 10-minute cap. The agent scans the whole vault and writes 3 to 8 notes, so
// it needs headroom beyond the 5-minute post-session budget.
const CONSOLIDATOR_TIMEOUT_MS = 600000;

export const CONSOLIDATOR_SYSTEM_PROMPT = `You are the vault consolidator for an AWS incident responder's Obsidian training journal.

You run every N sims to synthesize cross-session patterns that the flat per-service, per-concept, and per-session notes cannot show on their own. The player is the learner; you are the analyst.

Input (read-only):
- learning/player-vault/rank.md : current rank, polygon, and chronological session list.
- learning/player-vault/services/ : one markdown page per AWS service with stats and backlinks.
- learning/player-vault/concepts/ : one markdown page per concept with stats and backlinks.
- learning/player-vault/sessions/ : one markdown page per sim with frontmatter, per-turn table, axis profile, criteria, and gaps.
- learning/player-vault/insights/ : prior consolidator notes (if any). Read these to avoid redundant re-discovery and to update rather than duplicate.

Your job:
- Answer these 6 questions using the vault contents:
  1. How is the player doing overall, across rank, polygon, and question quality?
  2. What kinds of questions does she ask most, and which axes lag?
  3. Which services has she touched only superficially and is likely to misdiagnose on next exposure?
  4. What recurring weakness patterns repeat across sessions?
  5. What is her confidence level per axis, per service, per concept, and where are the sharpest gaps?
  6. Which concepts co-appear and deserve a dedicated deep-dive sim next?

Output format:
- Produce 3 to 8 small Obsidian-native markdown notes inside learning/player-vault/insights/.
- Each note is a single focused insight. One pattern per file.
- Name files by slug, e.g. insights/shallow-networking-coverage.md, insights/gather-axis-overuse.md.
- Each note begins with YAML frontmatter: type: insight, tags (including insight and at least one of pattern, gap, recommendation), created (ISO date).
- Use wiki-links liberally: [[services/ec2]], [[concepts/security-groups]], [[sessions/2026-04-15-foo]]. This is how the insights surface back on existing pages via Obsidian's backlinks panel.
- Keep notes short, evidence-based, and actionable. Cite specific sessions or services that support each claim.

Write scope (enforced by policy):
- You may write ONLY under learning/player-vault/insights/.
- Do not write to learning/player-vault/services/, learning/player-vault/concepts/, learning/player-vault/rank.md, or learning/player-vault/sessions/. Those are deterministic renderer outputs; mutating them will corrupt the next post-session pass.
- You may Read, Glob, and Grep the entire vault freely.

On duplicates:
- If an insights note already exists that covers the same pattern, do not overwrite it. Instead, open it and append a new '## Update <ISO date>' section with new evidence.

You are being invoked after sim #<<N>>. Read the vault at learning/player-vault/ and produce your insight notes now.`;

export function shouldRunConsolidator(totalSessions: number, intervalEnv: string | undefined): boolean {
  const interval = parseInt(intervalEnv || '5', 10);
  if (!Number.isFinite(interval) || interval <= 0) return false;
  return totalSessions > 0 && totalSessions % interval === 0;
}

interface ConsolidatorOptions {
  spawnFn?: typeof query;
}

export async function runConsolidator(n: number, opts?: ConsolidatorOptions): Promise<void> {
  const spawn = opts?.spawnFn ?? query;
  const prompt = CONSOLIDATOR_SYSTEM_PROMPT.replace(/<<N>>/g, String(n));
  const policy = CONSOLIDATOR_POLICY();

  const queryOptions = {
    cwd: paths.ROOT,
    allowedTools: policy.allowedTools,
    permissionMode: policy.permissionMode,
    canUseTool: policy.canUseTool,
    model: 'claude-opus-4-6',
    maxTurns: 30,
  };

  try {
    await collectMessages(
      spawn({
        prompt,
        options: queryOptions as Parameters<typeof query>[0]['options'],
      }),
      CONSOLIDATOR_TIMEOUT_MS
    );
  } catch (err) {
    // Never rethrow. The post-session flow must continue regardless.
    logEvent(null, {
      level: 'error',
      event: 'consolidator_failed',
      sim_number: n,
      error: String(err),
    });
  }
}
