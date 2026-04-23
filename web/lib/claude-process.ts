import { query } from '@anthropic-ai/claude-agent-sdk';
import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { buildPrompt } from './prompt-builder.js';
import * as paths from './paths.js';
import { sessions, persistSession, createGameSession, updateGameSession, endSession } from './claude-session.js';
import { parseEvents, parseAgentMessages, logTurn, collectMessages, withRetry, COLLECT_TIMEOUT_MS } from './claude-parse.js';
import type { ParsedEvent, Usage } from './claude-parse.js';
import { logEvent } from './logger.js';
import { MODEL_CONFIG, type EffortLevel } from '../../scripts/model-config.js';
import { PLAY_AGENT_POLICY } from './agent-policies.js';
import { buildClassifierPrompt } from './classifier-prompt.js';

// Play uses Sonnet at medium effort for latency. Per-stage model and
// effort live in scripts/model-config.json.
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
    gameSessionUpdate.status = 'post-processing';
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

export {
  endSession,
  parseEvents,
  parseAgentMessages,
  logTurn,
  collectMessages,
  withRetry,
  COLLECT_TIMEOUT_MS
};
