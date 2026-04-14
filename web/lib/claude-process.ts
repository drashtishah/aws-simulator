import { query } from '@anthropic-ai/claude-agent-sdk';
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

// Model split rationale: Sonnet handles interactive play (faster, cheaper,
// already strong enough for narrator + investigation reasoning). Opus handles
// post-session scoring because it does cross-file analysis (session.json +
// manifest + coaching-patterns + progression) and benefits from the deeper
// reasoning. Per-stage model and effort live in scripts/model-config.json.
// Do not flip these without an A/B test on quality. See Issue #107.
export const PLAY_SESSION_MODEL = MODEL_CONFIG.play.model;
export const POST_SESSION_MODEL = MODEL_CONFIG.post_session.model;

interface StartSessionOptions {
  resume?: boolean;
  resumeMessage?: string;
}

interface QueryOptions {
  cwd: string;
  allowedTools: string[];
  model: string;
  systemPrompt?: string;
  permissionMode: string;
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

  const stdinMessage = options.resume
    ? (options.resumeMessage ?? `Resume the in-progress session. Read learning/sessions/${simId}/session.json for session state.`)
    : 'Begin the simulation. Deliver the Opening and Briefing Card.';

  const queryOptions: QueryOptions = {
    cwd: paths.ROOT,
    allowedTools: ['Read', 'Write'],
    model: modelId,
    systemPrompt: promptText,
    permissionMode: 'bypassPermissions',
    maxTurns: 50
  };
  if (MODEL_CONFIG.play.effort) queryOptions.effort = MODEL_CONFIG.play.effort;

  const messages = await collectMessages(query({
    prompt: stdinMessage,
    options: queryOptions as Parameters<typeof query>[0]['options']
  }));

  const parsed = parseAgentMessages(messages as Parameters<typeof parseAgentMessages>[0]);
  const { events, sessionComplete } = parseEvents(parsed.fullText);

  const sessionData = {
    claudeSessionId: parsed.claudeSessionId,
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
    model_requested: modelKey,
    model_actual: parsed.claudeModel ?? 'unknown',
    claude_session_id: parsed.claudeSessionId
  });

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
    allowedTools: ['Read', 'Write'],
    model: session.modelId,
    permissionMode: 'bypassPermissions',
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
        allowedTools: ['Read', 'Write'],
        model: session.modelId,
        systemPrompt: session.systemPrompt,
        permissionMode: 'bypassPermissions',
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
  const sessionFilePath = paths.sessionFile(simId);
  const manifestPath = paths.manifest(simId);
  const profilePath = paths.PROFILE;
  const catalogPath = paths.CATALOG;
  const coachingPatternsPath = path.join(paths.ROOT, '.claude', 'skills', 'play', 'references', 'coaching-patterns.md');
  const progressionPath = path.join(paths.ROOT, 'references', 'config', 'progression.yaml');

  return `You are a post-session analysis agent for the AWS Incident Simulator.

Your job is to perform Steps 15-19 of the play skill: score knowledge, update the learning profile, update the services catalog, and compile vault notes.

Read these files to understand the session and player state:
- Session data: ${sessionFilePath}
- Sim manifest: ${manifestPath}
- Player profile: ${profilePath}
- Services catalog: ${catalogPath}
- Coaching patterns: ${coachingPatternsPath}
- Progression config: ${progressionPath}

Instructions:
1. Read session.json to get the investigation data (question_profile, criteria_met, services_queried, question_quality_scores, debrief data).
2. Read manifest.json for services, fix_criteria, and learning_objectives.
3. Read coaching-patterns.md for scoring rules.
4. Read progression.yaml for rank gates and polygon update rules.
5. Score knowledge per service (cap at +2 per sim per service).
6. Update profile.json: add sim to completed_sims, update skill_polygon with quality-weighted diminishing returns, update question_quality running averages, derive rank, increment total_sessions and sessions_at_current_rank.
7. Update catalog.csv: increment sims_completed, update knowledge_score, set last_practiced.
8. Compile vault notes: create session note, update question quality patterns, update behavioral profile, create/update concept and service notes.
8b. For each service note in the vault, include a "solves" field in the frontmatter: the single question this service exists to answer. Examples: SageMaker solves "How do I run ML models at scale?", Lambda solves "How do I run code in response to events?", Auto Scaling solves "How do I automatically add/remove capacity?", CloudWatch solves "How do I see what is happening?"
9. Set session status to "completed" in session.json.

Do not skip any step. Write all updates to the files listed above.`;
}

export async function runPostSessionAgent(simId: string): Promise<{ success: boolean }> {
  const prompt = buildPostSessionPrompt(simId);

  const queryOptions: QueryOptions = {
    cwd: paths.ROOT,
    allowedTools: ['Read', 'Write'],
    model: POST_SESSION_MODEL,
    permissionMode: 'bypassPermissions',
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

  const messages = await collectMessages(query({
    prompt,
    options: queryOptions as Parameters<typeof query>[0]['options']
  }));

  const parsed = parseAgentMessages(messages as Parameters<typeof parseAgentMessages>[0]);

  logEvent(null, {
    level: 'info',
    event: 'post_session_agent_complete',
    sim_id: simId,
    usage: parsed.usage ?? undefined
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

  return { success: true };
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
