import { query } from '@anthropic-ai/claude-agent-sdk';
import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk';
import path from 'node:path';
import fs from 'node:fs';
import * as paths from '../web/lib/paths.js';
import { buildClassifierPrompt } from '../web/lib/classifier-prompt.js';
import { POST_SESSION_POLICY } from '../web/lib/agent-policies.js';
import { collectMessages, parseAgentMessages } from '../web/lib/claude-parse.js';
import { logEvent } from '../web/lib/logger.js';
import { parseClassificationJsonl } from '../web/lib/classification-schema.js';
import {
  updateProfileFromClassification,
  renderVaultUpdates,
  applyVaultUpdates,
} from '../web/lib/post-session-renderer.js';
import type { PlayerProfile, Progression } from '../web/lib/post-session-renderer.js';
import { MODEL_CONFIG, type EffortLevel } from './model-config.js';
import { runConsolidator, shouldRunConsolidator } from './consolidator.js';
import jsYaml from 'js-yaml';

interface QueryOptions {
  cwd: string;
  allowedTools?: string[];
  model: string;
  systemPrompt?: string;
  permissionMode?: string;
  canUseTool?: CanUseTool;
  maxTurns: number;
  resume?: string;
  maxBudgetUsd?: number;
  effort?: EffortLevel;
}

// Post-session does many file reads + writes (profile, catalog, session status,
// and 3+ vault notes). Opus at medium effort routinely runs past the default
// 120s narrator-turn timeout. 5 minutes is a generous headroom.
const POST_SESSION_TIMEOUT_MS = 300000;

export async function runPostSessionAgent(
  simId: string
): Promise<{ success: boolean; tier1_duration_ms: number; tier2_duration_ms: number }> {
  const prompt = buildClassifierPrompt(simId);

  const queryOptions: QueryOptions = {
    cwd: paths.ROOT,
    ...POST_SESSION_POLICY(simId),
    model: MODEL_CONFIG.post_session.model,
    maxTurns: 30
  };
  if (MODEL_CONFIG.post_session.effort) queryOptions.effort = MODEL_CONFIG.post_session.effort;

  try {
    const metricsConfig = JSON.parse(fs.readFileSync(path.join(paths.ROOT, 'scripts', 'metrics.config.json'), 'utf8')) as {
      budgets?: { post_session_usd?: number };
    };
    const budget = metricsConfig.budgets?.post_session_usd;
    if (budget) queryOptions.maxBudgetUsd = budget;
  } catch { /* ignore missing config */ }

  // Tier 1: classifier agent (LLM call, 300s cap).
  const tier1Start = Date.now();
  const messages = await collectMessages(query({
    prompt,
    options: queryOptions as Parameters<typeof query>[0]['options']
  }), POST_SESSION_TIMEOUT_MS);
  const tier1_duration_ms = Date.now() - tier1Start;

  const parsed = parseAgentMessages(messages as Parameters<typeof parseAgentMessages>[0]);

  logEvent(null, {
    level: 'info',
    event: 'post_session_agent_complete',
    sim_id: simId,
    usage: parsed.usage ?? undefined,
    tier1_duration_ms
  });

  if (parsed.resultError) {
    logEvent(null, {
      level: 'error',
      event: 'post_session_agent_error',
      sim_id: simId,
      error: parsed.resultError
    });
    throw new Error(`Post-session agent failed: ${parsed.resultError.subtype}`);
  }

  // Tier 2: deterministic renderer (no LLM calls).
  const tier2Start = Date.now();
  const classificationPath = path.join(paths.sessionDir(simId), 'classification.jsonl');
  const classificationText = fs.readFileSync(classificationPath, 'utf8');
  const classificationRows = parseClassificationJsonl(classificationText);

  const profileText = fs.readFileSync(paths.PROFILE, 'utf8');
  const profile = JSON.parse(profileText) as PlayerProfile;

  const progressionText = fs.readFileSync(
    path.join(paths.ROOT, 'references', 'config', 'progression.yaml'), 'utf8'
  );
  const progression = jsYaml.load(progressionText) as Progression;

  const alreadyCompleted = profile.completed_sims.includes(simId);

  const updatedProfile = updateProfileFromClassification(profile, classificationRows, simId, progression);
  fs.writeFileSync(paths.PROFILE, JSON.stringify(updatedProfile, null, 2), 'utf8');

  const sessionDate = new Date().toISOString().slice(0, 10);

  // Read manifest.fix_criteria and session.investigation_summary (both populated by Tier 1)
  // so the deterministic renderer can emit a diagnostic session note.
  const sessionPath = paths.sessionFile(simId);
  const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8')) as Record<string, unknown>;
  const investigationSummary = typeof session.investigation_summary === 'string'
    ? session.investigation_summary
    : '';

  const manifestPath = paths.manifest(simId);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
    resolution?: { fix_criteria?: Array<{ id: string; description: string; required: boolean }> };
  };
  const fixCriteria = manifest.resolution?.fix_criteria ?? [];

  const rankPath = path.join(paths.VAULT_DIR, 'rank.md');
  const existingRank = fs.existsSync(rankPath) ? fs.readFileSync(rankPath, 'utf8') : '';
  const vaultUpdates = renderVaultUpdates(
    updatedProfile, classificationRows, simId, sessionDate, paths.VAULT_DIR,
    { [rankPath]: existingRank },
    { investigationSummary, fixCriteria }
  );
  applyVaultUpdates(vaultUpdates);

  // D3: every Nth sim, spawn an Opus consolidator to synthesize cross-session
  // patterns into learning/player-vault/insights/. Writes are policy-scoped to
  // insights/, so the deterministic renderer output above is not touched.
  // Errors are swallowed inside runConsolidator; the post-session flow
  // continues regardless.
  if (shouldRunConsolidator(updatedProfile.total_sessions, process.env.CONSOLIDATION_INTERVAL)) {
    await runConsolidator(updatedProfile.total_sessions);
  }

  // Set session status to completed.
  session.status = 'completed';
  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2), 'utf8');

  const tier2_duration_ms = Date.now() - tier2Start;

  logEvent(null, {
    level: 'info',
    event: 'post_session_tier2_complete',
    sim_id: simId,
    tier2_duration_ms
  });

  return { success: true, tier1_duration_ms, tier2_duration_ms };
}
