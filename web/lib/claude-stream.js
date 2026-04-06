const { query } = require('@anthropic-ai/claude-agent-sdk');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { buildPrompt } = require('./prompt-builder');
const paths = require('./paths');
const { parseEvents, logTurn, COLLECT_TIMEOUT_MS } = require('./claude-process');
const { sessions, persistSession, createGameSession, updateGameSession } = require('./claude-session');

let logger;
try {
  logger = require('./logger');
} catch {
  logger = { logEvent: () => {} };
}

/**
 * Stream events from Agent SDK query() as they arrive.
 * Yields parsed events (text, console, coaching, session, done, complete).
 * @param {string} prompt
 * @param {object} queryOptions
 * @param {AbortController} [abortController]
 * @returns {AsyncGenerator<object>}
 */
async function* streamQuery(prompt, queryOptions, abortController) {
  if (abortController) {
    queryOptions.abortController = abortController;
  }

  const iterator = query({ prompt, options: queryOptions });
  let claudeSessionId = null;
  let claudeModel = null;
  let fullText = '';
  let lastEventIndex = 0;
  let usage = null;
  let resultError = null;
  const toolCalls = [];

  const timeoutMs = COLLECT_TIMEOUT_MS;
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      if (abortController) abortController.abort();
      reject(new Error(`AGENT_TIMEOUT: Response exceeded ${timeoutMs / 1000} seconds`));
    }, timeoutMs);
    if (timeoutId.unref) timeoutId.unref();
  });

  try {
    for await (const msg of iterator) {
      if (msg.type === 'system' && msg.subtype === 'init') {
        claudeSessionId = msg.session_id;
        if (msg.model) claudeModel = msg.model;
        yield { type: 'session_init', claudeSessionId, claudeModel };
      } else if (msg.type === 'assistant' && msg.message) {
        const content = msg.message.content || [];
        for (const block of content) {
          if (block.type === 'text') {
            fullText += block.text;
          } else if (block.type === 'tool_use') {
            toolCalls.push({ name: block.name, input: block.input, id: block.id });
          }
        }

        // Re-parse and yield only new events
        const { events, sessionComplete } = parseEvents(fullText);
        for (let i = lastEventIndex; i < events.length; i++) {
          yield events[i];
        }
        lastEventIndex = events.length;

        if (sessionComplete) {
          yield { type: 'complete' };
        }
      } else if (msg.type === 'result') {
        const u = msg.usage || {};
        usage = { input_tokens: u.input_tokens || 0, output_tokens: u.output_tokens || 0 };
        if (msg.duration_ms) usage.duration_ms = msg.duration_ms;
        if (msg.is_error || (msg.subtype && msg.subtype.startsWith('error_'))) {
          resultError = { subtype: msg.subtype, error: msg.error || null };
        }
      }
    }
  } finally {
    clearTimeout(timeoutId);
  }

  // Yield metadata at the end
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

/**
 * Stream a new game session. Yields events as they arrive from the Agent SDK.
 * Performs all session bookkeeping (persist, log, create game session).
 */
async function* streamSession(simId, themeId, options = {}) {
  // Single-session enforcement
  const { endSession } = require('./claude-process');
  for (const [id] of sessions) {
    await endSession(id);
  }

  const modelKey = 'sonnet';
  const modelId = 'claude-sonnet-4-6';
  const sessionId = crypto.randomUUID();
  const promptText = buildPrompt(simId, themeId);
  const abortController = new AbortController();

  const stdinMessage = options.resume
    ? (options.resumeMessage || `Resume the in-progress session. Read learning/sessions/${simId}/session.json for session state.`)
    : 'Begin the simulation. Deliver the Opening and Briefing Card.';

  const queryOptions = {
    cwd: paths.ROOT,
    allowedTools: ['Read', 'Write'],
    model: modelId,
    systemPrompt: promptText,
    permissionMode: 'bypassPermissions',

    maxTurns: 50
  };

  try {
    const metricsConfig = JSON.parse(fs.readFileSync(path.join(paths.ROOT, 'scripts', 'metrics.config.json'), 'utf8'));
    const budget = metricsConfig.budgets?.game_session_usd;
    if (budget) queryOptions.maxBudgetUsd = budget;
  } catch { /* ignore missing config */ }

  const sessionData = {
    claudeSessionId: null,
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

  let metadata = null;
  for await (const event of streamQuery(stdinMessage, queryOptions, abortController)) {
    if (event.type === 'session_init') {
      sessionData.claudeSessionId = event.claudeSessionId;
      persistSession(sessionId, sessionData);
      continue;
    }
    if (event.type === '_metadata') {
      metadata = event;
      continue;
    }
    yield event;
  }

  // Post-iteration bookkeeping
  if (metadata) {
    logger.logEvent(sessionId, {
      level: 'info',
      event: 'session_start',
      sim_id: simId,
      theme: themeId,
      model_requested: modelKey,
      model_actual: metadata.claudeModel || 'unknown',
      claude_session_id: metadata.claudeSessionId
    });

    if (metadata.resultError) {
      logger.logEvent(sessionId, {
        level: 'warn',
        event: 'AGENT_RESULT_ERROR',
        subtype: metadata.resultError.subtype,
        error: metadata.resultError.error
      });
    }
  }

  yield { type: 'done' };
}

/**
 * Stream a message to an active session. Yields events as they arrive.
 */
async function* streamMessage(sessionId, message) {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error('SESSION_LOST: No active session with that ID');
  }

  session.turnCount++;
  const turnNumber = session.turnCount;
  persistSession(sessionId, session);
  const abortController = new AbortController();
  session.abortController = abortController;

  const queryOptions = {
    cwd: paths.ROOT,
    allowedTools: ['Read', 'Write'],
    model: session.modelId,
    permissionMode: 'bypassPermissions',

    maxTurns: 50
  };

  if (session.claudeSessionId && session.lastTurnHadToolUse) {
    // Skip resume to avoid unresolved tool_use errors
    logger.logEvent(sessionId, {
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

  let metadata = null;
  let sessionComplete = false;

  try {
    for await (const event of streamQuery(message, queryOptions, abortController)) {
      if (event.type === 'session_init') {
        if (event.claudeSessionId) session.claudeSessionId = event.claudeSessionId;
        continue;
      }
      if (event.type === '_metadata') {
        metadata = event;
        sessionComplete = event.sessionComplete;
        continue;
      }
      if (event.type === 'complete') {
        sessionComplete = true;
      }
      yield event;
    }
  } catch (err) {
    // Session error recovery: retry with fresh session
    if (err.message && (err.message.includes('unknown session') || err.message.includes('SESSION_LOST'))) {
      logger.logEvent(sessionId, { level: 'warn', event: 'retry', reason: 'SESSION_LOST', detail: 'Retrying with fresh system prompt' });

      const retryController = new AbortController();
      session.abortController = retryController;
      const retryOptions = {
        cwd: paths.ROOT,
        allowedTools: ['Read', 'Write'],
        model: session.modelId,
        systemPrompt: session.systemPrompt,
        permissionMode: 'bypassPermissions',

        maxTurns: 50
      };

      for await (const event of streamQuery(message, retryOptions, retryController)) {
        if (event.type === 'session_init') {
          if (event.claudeSessionId) session.claudeSessionId = event.claudeSessionId;
          continue;
        }
        if (event.type === '_metadata') {
          metadata = event;
          sessionComplete = event.sessionComplete;
          continue;
        }
        if (event.type === 'complete') sessionComplete = true;
        yield event;
      }
    } else {
      throw err;
    }
  }

  // Bookkeeping
  if (metadata) {
    session.lastTurnHadToolUse = metadata.toolCalls && metadata.toolCalls.length > 0;
    if (metadata.resultError) {
      logger.logEvent(sessionId, { level: 'warn', event: 'AGENT_RESULT_ERROR', subtype: metadata.resultError.subtype, error: metadata.resultError.error });
    }
    logTurn(session.simId, turnNumber, message, metadata.usage);
    logger.logEvent(sessionId, { level: 'info', event: 'turn', direction: 'out', usage: metadata.usage });
  }

  const gameSessionUpdate = { turnCount: turnNumber };
  if (sessionComplete) {
    gameSessionUpdate.status = 'completed';
    logger.logEvent(sessionId, { level: 'info', event: 'session_end', outcome: 'success' });
  }
  updateGameSession(session.simId, gameSessionUpdate);

  if (sessionComplete) {
    yield { type: 'complete' };
  }
  yield { type: 'done', sessionComplete };
}

module.exports = {
  streamQuery,
  streamSession,
  streamMessage
};
