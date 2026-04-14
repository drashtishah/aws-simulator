import { query } from '@anthropic-ai/claude-agent-sdk';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { buildPrompt } from './prompt-builder.js';
import * as paths from './paths.js';
import { parseEvents, logTurn, COLLECT_TIMEOUT_MS } from './claude-parse.js';
import type { ParsedEvent } from './claude-parse.js';
import { sessions, persistSession, createGameSession, updateGameSession, endSession } from './claude-session.js';
import { logEvent } from './logger.js';
import { MODEL_CONFIG, type EffortLevel } from '../../scripts/model-config.js';

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
  id?: string;
}

interface SDKMsg {
  type: string;
  subtype?: string;
  session_id?: string;
  model?: string;
  message?: { content?: ContentBlock[] };
  usage?: { input_tokens?: number; output_tokens?: number };
  duration_ms?: number;
  is_error?: boolean;
  error?: unknown;
}

interface ToolCall {
  name: string;
  input: unknown;
  id: string;
}

interface Usage {
  input_tokens: number;
  output_tokens: number;
  duration_ms?: number;
}

type StreamEvent =
  | { type: 'session_init'; claudeSessionId: string | null; claudeModel: string | null }
  | { type: 'session'; sessionId: string }
  | { type: 'text'; content: string }
  | { type: 'dropdown'; content: string; label: string; open: boolean }
  | { type: 'complete' }
  | { type: 'done'; sessionComplete?: boolean }
  | { type: '_metadata'; claudeSessionId: string | null; claudeModel: string | null; fullText: string; toolCalls: ToolCall[]; usage: Usage | null; resultError: { subtype?: string; error: unknown } | null; sessionComplete: boolean };

interface QueryOptions {
  cwd: string;
  allowedTools: string[];
  model: string;
  systemPrompt?: string;
  permissionMode: string;
  maxTurns: number;
  resume?: string;
  abortController?: AbortController;
  maxBudgetUsd?: number;
  effort?: EffortLevel;
}

interface StreamSessionOptions {
  resume?: boolean;
  resumeMessage?: string;
}

export async function* streamQuery(
  prompt: string,
  queryOptions: QueryOptions,
  abortController?: AbortController
): AsyncGenerator<StreamEvent | ParsedEvent> {
  if (abortController) {
    queryOptions.abortController = abortController;
  }

  const iterator = query({ prompt, options: queryOptions as Parameters<typeof query>[0]['options'] });
  let claudeSessionId: string | null = null;
  let claudeModel: string | null = null;
  let fullText = '';
  let lastEventIndex = 0;
  let usage: Usage | null = null;
  let resultError: { subtype?: string; error: unknown } | null = null;
  const toolCalls: ToolCall[] = [];

  const timeoutMs = COLLECT_TIMEOUT_MS;
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      if (abortController) abortController.abort();
      reject(new Error(`AGENT_TIMEOUT: Response exceeded ${timeoutMs / 1000} seconds`));
    }, timeoutMs);
    if (timeoutId.unref) timeoutId.unref();
  });

  try {
    for await (const msg of iterator) {
      const m = msg as SDKMsg;
      if (m.type === 'system' && m.subtype === 'init') {
        claudeSessionId = m.session_id ?? null;
        if (m.model) claudeModel = m.model;
        yield { type: 'session_init', claudeSessionId, claudeModel };
      } else if (m.type === 'assistant' && m.message) {
        const content = m.message.content ?? [];
        for (const block of content) {
          if (block.type === 'text') {
            fullText += block.text ?? '';
          } else if (block.type === 'tool_use') {
            toolCalls.push({ name: block.name!, input: block.input, id: block.id! });
          }
        }

        const { events, sessionComplete } = parseEvents(fullText);
        for (let i = lastEventIndex; i < events.length; i++) {
          yield events[i]!;
        }
        lastEventIndex = events.length;

        if (sessionComplete) {
          yield { type: 'complete' };
        }
      } else if (m.type === 'result') {
        const u = m.usage ?? {};
        usage = { input_tokens: u.input_tokens ?? 0, output_tokens: u.output_tokens ?? 0 };
        if (m.duration_ms) usage.duration_ms = m.duration_ms;
        if (m.is_error || (m.subtype && m.subtype.startsWith('error_'))) {
          resultError = { subtype: m.subtype, error: m.error ?? null };
        }
      }
    }
  } finally {
    clearTimeout(timeoutId!);
  }

  yield {
    type: '_metadata',
    claudeSessionId,
    claudeModel,
    fullText,
    toolCalls,
    usage,
    resultError,
    sessionComplete: fullText.includes('[SESSION_COMPLETE]')
  };
}

export async function* streamSession(
  simId: string,
  themeId: string,
  options: StreamSessionOptions = {}
): AsyncGenerator<StreamEvent | ParsedEvent> {
  for (const [id] of sessions) {
    await endSession(id);
  }

  const modelKey = 'sonnet';
  const modelId = MODEL_CONFIG.play.model;
  const sessionId = crypto.randomUUID();
  const promptText = buildPrompt(simId, themeId);
  const abortController = new AbortController();

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

  try {
    const metricsConfig = JSON.parse(fs.readFileSync(path.join(paths.ROOT, 'scripts', 'metrics.config.json'), 'utf8')) as {
      budgets?: { game_session_usd?: number };
    };
    const budget = metricsConfig.budgets?.game_session_usd;
    if (budget) queryOptions.maxBudgetUsd = budget;
  } catch { /* ignore missing config */ }

  const sessionData = {
    claudeSessionId: null as string | null,
    simId,
    themeId,
    model: modelKey,
    modelId,
    startedAt: new Date(),
    turnCount: 0,
    systemPrompt: promptText,
    abortController
  };
  sessions.set(sessionId, sessionData);
  createGameSession(simId);

  yield { type: 'session', sessionId };

  let metadata: (StreamEvent & { type: '_metadata' }) | null = null;
  for await (const event of streamQuery(stdinMessage, queryOptions, abortController)) {
    if (event.type === 'session_init') {
      sessionData.claudeSessionId = (event as { claudeSessionId: string | null }).claudeSessionId;
      persistSession(sessionId, sessionData);
      continue;
    }
    if (event.type === '_metadata') {
      metadata = event as StreamEvent & { type: '_metadata' };
      continue;
    }
    yield event;
  }

  if (metadata) {
    logEvent(sessionId, {
      level: 'info',
      event: 'session_start',
      sim_id: simId,
      theme: themeId,
      model_requested: modelKey,
      model_actual: metadata.claudeModel ?? 'unknown',
      claude_session_id: metadata.claudeSessionId
    });

    if (metadata.resultError) {
      logEvent(sessionId, {
        level: 'warn',
        event: 'AGENT_RESULT_ERROR',
        subtype: metadata.resultError.subtype,
        error: metadata.resultError.error
      });
    }
  }

  yield { type: 'done' };
}

export async function* streamMessage(
  sessionId: string,
  message: string
): AsyncGenerator<StreamEvent | ParsedEvent> {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error('SESSION_LOST: No active session with that ID');
  }

  session.turnCount++;
  const turnNumber = session.turnCount;
  persistSession(sessionId, session);
  const abortController = new AbortController();
  session.abortController = abortController;

  const queryOptions: QueryOptions = {
    cwd: paths.ROOT,
    allowedTools: ['Read', 'Write'],
    model: session.modelId,
    permissionMode: 'bypassPermissions',
    maxTurns: 50
  };
  if (MODEL_CONFIG.play.effort) queryOptions.effort = MODEL_CONFIG.play.effort;

  if (session.claudeSessionId && session.lastTurnHadToolUse) {
    logEvent(sessionId, {
      level: 'warn',
      event: 'RESUME_SKIPPED',
      reason: 'Previous turn had unresolved tool_use blocks'
    });
    queryOptions.systemPrompt = session.systemPrompt;
  } else if (session.claudeSessionId) {
    queryOptions.resume = session.claudeSessionId;
  } else {
    queryOptions.systemPrompt = session.systemPrompt;
  }

  let metadata: (StreamEvent & { type: '_metadata' }) | null = null;
  let sessionComplete = false;

  try {
    for await (const event of streamQuery(message, queryOptions, abortController)) {
      if (event.type === 'session_init') {
        const initEvent = event as { claudeSessionId: string | null };
        if (initEvent.claudeSessionId) session.claudeSessionId = initEvent.claudeSessionId;
        continue;
      }
      if (event.type === '_metadata') {
        metadata = event as StreamEvent & { type: '_metadata' };
        sessionComplete = metadata!.sessionComplete;
        continue;
      }
      if (event.type === 'complete') {
        sessionComplete = true;
      }
      yield event;
    }
  } catch (err: unknown) {
    const errObj = err as { message?: string };
    if (errObj.message && (errObj.message.includes('unknown session') || errObj.message.includes('SESSION_LOST'))) {
      logEvent(sessionId, { level: 'warn', event: 'retry', reason: 'SESSION_LOST', detail: 'Retrying with fresh system prompt' });

      const retryController = new AbortController();
      session.abortController = retryController;
      const retryOptions: QueryOptions = {
        cwd: paths.ROOT,
        allowedTools: ['Read', 'Write'],
        model: session.modelId,
        systemPrompt: session.systemPrompt,
        permissionMode: 'bypassPermissions',
        maxTurns: 50
      };
      if (MODEL_CONFIG.play.effort) retryOptions.effort = MODEL_CONFIG.play.effort;

      for await (const event of streamQuery(message, retryOptions, retryController)) {
        if (event.type === 'session_init') {
          const initEvent = event as { claudeSessionId: string | null };
          if (initEvent.claudeSessionId) session.claudeSessionId = initEvent.claudeSessionId;
          continue;
        }
        if (event.type === '_metadata') {
          metadata = event as StreamEvent & { type: '_metadata' };
          sessionComplete = metadata!.sessionComplete;
          continue;
        }
        if (event.type === 'complete') sessionComplete = true;
        yield event;
      }
    } else {
      throw err;
    }
  }

  if (metadata) {
    session.lastTurnHadToolUse = metadata.toolCalls.length > 0;
    if (metadata.resultError) {
      logEvent(sessionId, { level: 'warn', event: 'AGENT_RESULT_ERROR', subtype: metadata.resultError.subtype, error: metadata.resultError.error });
    }
    logTurn(session.simId, turnNumber, message, metadata.fullText ?? '', metadata.usage);
    logEvent(sessionId, { level: 'info', event: 'turn', direction: 'out', usage: metadata.usage ?? undefined });
  }

  const gameSessionUpdate: Record<string, unknown> = { turnCount: turnNumber };
  if (sessionComplete) {
    gameSessionUpdate.status = 'completed';
    logEvent(sessionId, { level: 'info', event: 'session_end', outcome: 'success' });
  }
  updateGameSession(session.simId, gameSessionUpdate);

  if (sessionComplete) {
    yield { type: 'complete' };
  }
  yield { type: 'done', sessionComplete };
}
