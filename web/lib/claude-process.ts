import { query } from '@anthropic-ai/claude-agent-sdk';
import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { buildPrompt } from './prompt-builder.js';
import * as paths from './paths.js';
import { sessions, persistSession, createGameSession, updateGameSession, endSession } from './claude-session.js';
import { parseEvents, parseAgentMessages, logTurn, collectMessages, withRetry, COLLECT_TIMEOUT_MS } from './claude-parse.js';
import type { ParsedEvent, Usage } from './claude-parse.js';
import { logEvent, generateFixManifest } from './logger.js';
import { MODEL_CONFIG, type EffortLevel } from '../../scripts/model-config.js';
import { PLAY_AGENT_POLICY, POST_SESSION_POLICY } from './agent-policies.js';
import { buildClassifierPrompt } from './classifier-prompt.js';
import { parseClassificationJsonl } from './classification-schema.js';
import {
  updateProfileFromClassification,
  updateCatalogFromClassification,
  renderVaultUpdates,
  applyVaultUpdates,
} from './post-session-renderer.js';
import type { PlayerProfile, CatalogRow, Progression } from './post-session-renderer.js';
import jsYaml from 'js-yaml';

// Play uses Sonnet-medium with progressive disclosure of artifacts (see
// prompt-builder). Manifest, story, and resolution stay in context so the
// narrator can guide and verify the player's fix without leaking. Rollback
// to Opus is a one-line change in scripts/model-config.json; no code revert
// needed. Per-stage effort lives in scripts/model-config.json.
export const PLAY_SESSION_MODEL = MODEL_CONFIG.play.model;
export const POST_SESSION_MODEL = MODEL_CONFIG.post_session.model;

interface StartSessionOptions {
  resume?: boolean;
  resumeMessage?: string;
}

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

interface SessionResult {
  sessionId: string;
  events: ParsedEvent[];
  sessionComplete: boolean;
}

interface MessageResult {
  events: ParsedEvent[];
  sessionComplete: boolean;
}

export async function startSession(simId: string, themeId: string, options: StartSessionOptions = {}): Promise<SessionResult> {
  for (const [id] of sessions) {
    await endSession(id);
  }

  const modelKey = 'sonnet';
  const modelId = PLAY_SESSION_MODEL;

  const sessionId = crypto.randomUUID();

  const promptText = buildPrompt(simId, themeId);

  const sessionData = {
    claudeSessionId: null as string | null,
    simId,
    themeId,
    model: modelKey,
    modelId,
    startedAt: new Date(),
    turnCount: 0,
    systemPrompt: promptText
  };
  sessions.set(sessionId, sessionData);
  persistSession(sessionId, sessionData);
  createGameSession(simId);

  logEvent(sessionId, {
    level: 'info',
    event: 'session_start',
    sim_id: simId,
    theme: themeId,
    model_requested: modelKey
  });

  // Fresh start: render the author-written opening.md instantly and defer
  // the Claude session to the first sendMessage. Mirrors streamSession.
  if (!options.resume) {
    const opening = fs.readFileSync(paths.opening(simId), 'utf8').trim();
    return {
      sessionId,
      events: [{ type: 'text', content: opening }],
      sessionComplete: false
    };
  }

  // Resume path: ask Claude to re-orient from narrator-notes.md.
  const stdinMessage = options.resumeMessage
    ?? `Resume the in-progress session. Read learning/sessions/${simId}/narrator-notes.md for where you left off.`;

  const queryOptions: QueryOptions = {
    cwd: paths.ROOT,
    ...PLAY_AGENT_POLICY(simId),
    model: modelId,
    systemPrompt: promptText,
    maxTurns: 50
  };
  if (MODEL_CONFIG.play.effort) queryOptions.effort = MODEL_CONFIG.play.effort;

  const messages = await collectMessages(query({
    prompt: stdinMessage,
    options: queryOptions as Parameters<typeof query>[0]['options']
  }));

  const parsed = parseAgentMessages(messages as Parameters<typeof parseAgentMessages>[0]);
  const { events, sessionComplete } = parseEvents(parsed.fullText);

  sessionData.claudeSessionId = parsed.claudeSessionId;
  persistSession(sessionId, sessionData);

  if (parsed.claudeModel && parsed.claudeModel !== modelKey && !parsed.claudeModel.includes(modelKey)) {
    logEvent(sessionId, {
      level: 'warn',
      event: 'MODEL_MISMATCH',
      model_requested: modelKey,
      model_actual: parsed.claudeModel
    });
  }

  return {
    sessionId,
    events,
    sessionComplete
  };
}

export async function sendMessage(sessionId: string, message: string): Promise<MessageResult> {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error('SESSION_LOST: No active session with that ID');
  }

  session.turnCount++;
  const turnNumber = session.turnCount;
  persistSession(sessionId, session);

  const queryOptions: QueryOptions = {
    cwd: paths.ROOT,
    ...PLAY_AGENT_POLICY(session.simId),
    model: session.modelId,
    maxTurns: 50
  };
  if (MODEL_CONFIG.play.effort) queryOptions.effort = MODEL_CONFIG.play.effort;

  if (session.claudeSessionId) {
    queryOptions.resume = session.claudeSessionId;
  } else {
    queryOptions.systemPrompt = session.systemPrompt;
  }

  let messages: unknown[];
  try {
    messages = await collectMessages(query({
      prompt: message,
      options: queryOptions as Parameters<typeof query>[0]['options']
    }));
  } catch (err: unknown) {
    const errObj = err as { message?: string };
    if (errObj.message && (errObj.message.includes('unknown session') || errObj.message.includes('SESSION_LOST'))) {
      logEvent(sessionId, {
        level: 'warn',
        event: 'retry',
        reason: 'SESSION_LOST',
        detail: 'Retrying with fresh system prompt'
      });

      const retryOptions: QueryOptions = {
        cwd: paths.ROOT,
        ...PLAY_AGENT_POLICY(session.simId),
        model: session.modelId,
        systemPrompt: session.systemPrompt,
        maxTurns: 50
      };
      if (MODEL_CONFIG.play.effort) retryOptions.effort = MODEL_CONFIG.play.effort;

      messages = await collectMessages(query({
        prompt: message,
        options: retryOptions as Parameters<typeof query>[0]['options']
      }));

      const retryParsed = parseAgentMessages(messages as Parameters<typeof parseAgentMessages>[0]);
      if (retryParsed.claudeSessionId) {
        session.claudeSessionId = retryParsed.claudeSessionId;
      }
    } else {
      throw err;
    }
  }

  const parsed = parseAgentMessages(messages as Parameters<typeof parseAgentMessages>[0]);
  const { events, sessionComplete } = parseEvents(parsed.fullText);

  if (parsed.resultError) {
    logEvent(sessionId, {
      level: 'warn',
      event: 'AGENT_RESULT_ERROR',
      subtype: parsed.resultError.subtype,
      error: parsed.resultError.error
    });
  }

  if (parsed.claudeSessionId && parsed.claudeSessionId !== session.claudeSessionId) {
    session.claudeSessionId = parsed.claudeSessionId;
  }

  logTurn(session.simId, turnNumber, message, parsed.fullText ?? '', parsed.usage);

  const gameSessionUpdate: Record<string, unknown> = { turnCount: turnNumber };
  if (sessionComplete) {
    gameSessionUpdate.status = 'completed';
  }
  updateGameSession(session.simId, gameSessionUpdate);

  logEvent(sessionId, {
    level: 'info',
    event: 'turn',
    direction: 'out',
    usage: parsed.usage ?? undefined
  });

  if (sessionComplete) {
    logEvent(sessionId, {
      level: 'info',
      event: 'session_end',
      outcome: 'success'
    });
  }

  return {
    events,
    sessionComplete
  };
}

export function buildPostSessionPrompt(simId: string): string {
  return buildClassifierPrompt(simId);
}

// Post-session does many file reads + writes (profile, catalog, session status,
// and 3+ vault notes). Opus at medium effort routinely runs past the default
// 120s narrator-turn timeout. 5 minutes is a generous headroom.
const POST_SESSION_TIMEOUT_MS = 300000;

export async function runPostSessionAgent(
  simId: string
): Promise<{ success: boolean; tier1_duration_ms: number; tier2_duration_ms: number }> {
  const prompt = buildPostSessionPrompt(simId);

  const queryOptions: QueryOptions = {
    cwd: paths.ROOT,
    ...POST_SESSION_POLICY(simId),
    model: POST_SESSION_MODEL,
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

  const catalogText = fs.readFileSync(paths.CATALOG, 'utf8');
  const catalogRows = parseCatalogCsv(catalogText);
  const updatedCatalog = updateCatalogFromClassification(catalogRows, classificationRows, simId, alreadyCompleted);
  fs.writeFileSync(paths.CATALOG, serializeCatalogCsv(updatedCatalog), 'utf8');

  const sessionDate = new Date().toISOString().slice(0, 10);
  const vaultUpdates = renderVaultUpdates(
    updatedProfile, classificationRows, simId, sessionDate, paths.VAULT_DIR
  );
  applyVaultUpdates(vaultUpdates);

  // Set session status to completed.
  const sessionPath = paths.sessionFile(simId);
  const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8')) as Record<string, unknown>;
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

function parseCatalogCsv(text: string): CatalogRow[] {
  const lines = text.trim().split('\n');
  if (lines.length <= 1) return []; // header only or empty
  return lines.slice(1).map(line => {
    const [service, sims_completed, knowledge_score, last_practiced] = line.split(',');
    return {
      service: service ?? '',
      sims_completed: parseInt(sims_completed ?? '0', 10),
      knowledge_score: parseFloat(knowledge_score ?? '0'),
      last_practiced: last_practiced ?? '',
    };
  });
}

function serializeCatalogCsv(rows: CatalogRow[]): string {
  const header = 'service,sims_completed,knowledge_score,last_practiced';
  const lines = rows.map(r =>
    `${r.service},${r.sims_completed},${r.knowledge_score.toFixed(2)},${r.last_practiced}`
  );
  return [header, ...lines].join('\n') + '\n';
}

export {
  endSession,
  parseEvents,
  parseAgentMessages,
  logTurn,
  collectMessages,
  withRetry,
  COLLECT_TIMEOUT_MS
};
