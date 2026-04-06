const { query } = require('@anthropic-ai/claude-agent-sdk');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { buildPrompt } = require('./prompt-builder');
const paths = require('./paths');

let logger;
try {
  logger = require('./logger');
} catch {
  logger = {
    logEvent: () => {},
    generateFixManifest: () => {}
  };
}

// In-memory session store (single-session enforcement)
const sessions = new Map();

const SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

// --- Session persistence ---

function persistSession(sessionId, sessionData) {
  const dir = paths.sessionDir(sessionData.simId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'web-session.json');
  const data = {
    sessionId,
    claudeSessionId: sessionData.claudeSessionId,
    simId: sessionData.simId,
    themeId: sessionData.themeId,
    model: sessionData.model,
    modelId: sessionData.modelId,
    startedAt: sessionData.startedAt instanceof Date ? sessionData.startedAt.toISOString() : sessionData.startedAt,
    playtest: sessionData.playtest || false,
    turnCount: sessionData.turnCount || 0
  };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function recoverSessions() {
  const sessionsDir = paths.SESSIONS_DIR;
  if (!fs.existsSync(sessionsDir)) return;

  const entries = fs.readdirSync(sessionsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const filePath = path.join(sessionsDir, entry.name, 'web-session.json');
    if (!fs.existsSync(filePath)) continue;

    let data;
    try {
      data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      continue; // Skip corrupt JSON
    }

    // Skip sessions older than 2 hours
    const age = Date.now() - new Date(data.startedAt).getTime();
    if (age > SESSION_MAX_AGE_MS) continue;

    // Rebuild systemPrompt from simId + themeId
    let systemPrompt;
    try {
      systemPrompt = buildPrompt(data.simId, data.themeId);
    } catch {
      continue; // Skip if sim/theme no longer exists
    }

    sessions.set(data.sessionId, {
      claudeSessionId: data.claudeSessionId,
      simId: data.simId,
      themeId: data.themeId,
      model: data.model,
      modelId: data.modelId,
      startedAt: new Date(data.startedAt),
      playtest: data.playtest || false,
      turnCount: data.turnCount || 0,
      systemPrompt
    });
  }
}

// --- Game session persistence (server-owned) ---

function createGameSession(simId, options = {}) {
  const manifestPath = paths.manifest(simId);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const now = new Date().toISOString();
  const axes = ['gather', 'diagnose', 'correlate', 'impact', 'trace', 'fix'];
  const questionProfile = {};
  for (const axis of axes) {
    questionProfile[axis] = { count: 0, effective: 0 };
  }

  const session = {
    sim_id: simId,
    status: 'in_progress',
    started_at: now,
    last_active: now,
    criteria_met: [],
    criteria_remaining: (manifest.resolution.fix_criteria || []).map(c => ({
      id: c.id,
      description: c.description,
      required: c.required
    })),
    question_profile: questionProfile,
    investigation_summary: '',
    story_beats_fired: [],
    services_queried: [],
    feedback_notes: [],
    debrief_phase: null,
    debrief_questions_asked: 0,
    debrief_zones_explored: [],
    debrief_seeds_offered: [],
    debrief_depth_score: 0,
    question_quality_scores: []
  };

  const dir = paths.sessionDir(simId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(paths.sessionFile(simId), JSON.stringify(session, null, 2));

  return session;
}

function updateGameSession(simId, updates) {
  const filePath = paths.sessionFile(simId);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const session = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  Object.assign(session, updates);
  session.last_active = new Date().toISOString();

  fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
  return session;
}

// --- Model mapping ---

const MODEL_MAP = {
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-6'
};

// --- Message parsing ---

/**
 * Parse Agent SDK messages from the query() async iterator.
 * Extracts session ID, model, full text, and usage.
 */
function parseAgentMessages(messages) {
  let claudeSessionId = null;
  let claudeModel = null;
  const textParts = [];
  const toolCalls = [];
  let usage = null;

  for (const msg of messages) {
    if (msg.type === 'system' && msg.subtype === 'init') {
      claudeSessionId = msg.session_id;
      if (msg.model) claudeModel = msg.model;
    } else if (msg.type === 'assistant' && msg.message) {
      const content = msg.message.content || [];
      for (const block of content) {
        if (block.type === 'text') {
          textParts.push(block.text);
        } else if (block.type === 'tool_use') {
          toolCalls.push({ name: block.name, input: block.input, id: block.id });
        }
      }
    } else if (msg.type === 'result') {
      const u = msg.usage || {};
      usage = {
        input_tokens: u.input_tokens || 0,
        output_tokens: u.output_tokens || 0
      };
      if (msg.duration_ms) usage.duration_ms = msg.duration_ms;
    }
  }

  let resultError = null;
  let terminalReason = null;

  for (const msg of messages) {
    if (msg.type === 'result') {
      if (msg.is_error || (msg.subtype && msg.subtype.startsWith('error_'))) {
        resultError = { subtype: msg.subtype, error: msg.error || null };
      }
      if (msg.terminal_reason) {
        terminalReason = msg.terminal_reason;
      }
    }
  }

  return {
    claudeSessionId,
    claudeModel,
    fullText: textParts.join(''),
    toolCalls,
    hasToolUse: toolCalls.length > 0,
    usage,
    resultError,
    terminalReason
  };
}

/**
 * Extract console, coaching, and session-complete markers from full text.
 * Returns { events, sessionComplete }.
 */
function parseEvents(fullText) {
  const events = [];

  // Extract console blocks
  const consoleRegex = /\[CONSOLE_START\]([\s\S]*?)\[CONSOLE_END\]/g;
  let match;
  let lastIndex = 0;
  const segments = [];

  while ((match = consoleRegex.exec(fullText)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: fullText.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'console', content: match[1].trim() });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < fullText.length) {
    segments.push({ type: 'text', content: fullText.slice(lastIndex) });
  }

  if (segments.length === 0) {
    segments.push({ type: 'text', content: fullText });
  }

  // Process coaching markers within text segments
  for (const seg of segments) {
    if (seg.type === 'console') {
      events.push({ type: 'console', content: seg.content });
      continue;
    }

    let text = seg.content;
    const coachingRegex = /\[COACHING_START\]([\s\S]*?)\[COACHING_END\]/g;
    let cLastIndex = 0;
    let cMatch;

    while ((cMatch = coachingRegex.exec(text)) !== null) {
      if (cMatch.index > cLastIndex) {
        const before = text.slice(cLastIndex, cMatch.index).trim();
        if (before) events.push({ type: 'text', content: before });
      }
      events.push({ type: 'coaching', content: cMatch[1].trim() });
      cLastIndex = cMatch.index + cMatch[0].length;
    }
    if (cLastIndex < text.length) {
      const after = text.slice(cLastIndex).trim();
      if (after) events.push({ type: 'text', content: after });
    }
  }

  const sessionComplete = fullText.includes('[SESSION_COMPLETE]');

  if (sessionComplete) {
    for (const event of events) {
      if (event.content) {
        event.content = event.content.replace('[SESSION_COMPLETE]', '').trim();
      }
    }
  }

  return { events, sessionComplete };
}

// --- Turn logging ---

/**
 * Log a turn to learning/sessions/{simId}/turns.jsonl.
 */
function logTurn(simId, turn, playerMessage, usage) {
  const turnsPath = paths.turnsFile(simId);
  const dir = path.dirname(turnsPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const entry = {
    ts: new Date().toISOString(),
    turn,
    player_message: playerMessage,
    usage: usage || {}
  };

  fs.appendFileSync(turnsPath, JSON.stringify(entry) + '\n');
}

// --- Agent SDK helpers ---

/**
 * Collect all messages from Agent SDK query() async iterator.
 */
const COLLECT_TIMEOUT_MS = 120000;

async function collectMessages(asyncIterator, timeoutMs = COLLECT_TIMEOUT_MS) {
  const messages = [];
  const timeout = new Promise((_, reject) => {
    const timer = setTimeout(() => {
      // Attempt cleanup of the async iterator
      if (asyncIterator.return) {
        asyncIterator.return().catch(() => {});
      }
      logger.logEvent(null, {
        level: 'warn',
        event: 'AGENT_TIMEOUT',
        timeout_ms: timeoutMs
      });
      reject(new Error(`AGENT_TIMEOUT: Response exceeded ${timeoutMs / 1000} seconds`));
    }, timeoutMs);
    // Allow timer to not block process exit
    if (timer.unref) timer.unref();
  });

  const collect = async () => {
    for await (const message of asyncIterator) {
      messages.push(message);
    }
    return messages;
  };

  return Promise.race([collect(), timeout]);
}

// --- Retry helper ---

/**
 * Retry wrapper with exponential backoff.
 * Handles SESSION_LOST (retry immediately with fresh session) and
 * rate limits (429/529, longer backoff).
 */
async function withRetry(fn, { maxAttempts = 3, delays = [1000, 2000, 4000], sessionId = null } = {}) {
  let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isRateLimit = err.status === 429 || err.status === 529 || (err.message && err.message.includes('rate_limit'));

      if (attempt === maxAttempts - 1) throw err;

      let delay = delays[attempt] || delays[delays.length - 1];
      if (isRateLimit) {
        const retryAfter = err.headers?.get?.('retry-after');
        delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : Math.max(5000, delay);
      }

      logger.logEvent(sessionId, {
        level: 'warn',
        event: 'retry',
        attempt: attempt + 1,
        reason: isRateLimit ? 'RATE_LIMIT' : 'UNKNOWN',
        delay_ms: delay,
        error: err.message
      });

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

// --- Streaming helpers ---

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
    allowDangerouslySkipPermissions: true,
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
    playtest: options.playtest || false,
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

  if (options.playtest && metadata) {
    const transcript = require('./transcript');
    const { events: parsedEvents } = parseEvents(metadata.fullText);
    const narratorText = parsedEvents.filter(e => e.type === 'text').map(e => e.content).join('\n');
    transcript.appendTurn(simId, { turn: 0, narrator: narratorText || null, mode: 'narrator' });
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
    allowDangerouslySkipPermissions: true,
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
        allowDangerouslySkipPermissions: true,
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

  if (session.playtest && metadata) {
    const transcript = require('./transcript');
    const { events: parsedEvents } = parseEvents(metadata.fullText);
    const narratorText = parsedEvents.filter(e => e.type === 'text').map(e => e.content).join('\n');
    const consoleText = parsedEvents.filter(e => e.type === 'console').map(e => e.content).join('\n');
    const coachingText = parsedEvents.filter(e => e.type === 'coaching').map(e => e.content).join('\n');
    const mode = consoleText ? 'console' : coachingText ? 'coaching' : 'narrator';
    transcript.appendTurn(session.simId, { turn: turnNumber, player: message, narrator: narratorText || null, console: consoleText || null, coaching: coachingText || null, mode });
  }

  if (sessionComplete) {
    yield { type: 'complete' };
  }
  yield { type: 'done', sessionComplete };
}

// --- Session management ---

async function startSession(simId, themeId, options = {}) {
  // Single-session enforcement: end any active session
  for (const [id] of sessions) {
    await endSession(id);
  }

  const modelKey = 'sonnet';
  const modelId = 'claude-sonnet-4-6';

  const sessionId = crypto.randomUUID();

  // Build system prompt
  const promptText = buildPrompt(simId, themeId);

  const stdinMessage = options.resume
    ? (options.resumeMessage || `Resume the in-progress session. Read learning/sessions/${simId}/session.json for session state.`)
    : 'Begin the simulation. Deliver the Opening and Briefing Card.';

  const queryOptions = {
    cwd: paths.ROOT,
    allowedTools: ['Read', 'Write'],
    model: modelId,
    systemPrompt: promptText,
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    maxTurns: 50
  };

  const messages = await collectMessages(query({
    prompt: stdinMessage,
    options: queryOptions
  }));

  const parsed = parseAgentMessages(messages);
  const { events, sessionComplete } = parseEvents(parsed.fullText);

  const sessionData = {
    claudeSessionId: parsed.claudeSessionId,
    simId,
    themeId,
    model: modelKey,
    modelId,
    startedAt: new Date(),
    playtest: options.playtest || false,
    turnCount: 0,
    systemPrompt: promptText
  };
  sessions.set(sessionId, sessionData);
  persistSession(sessionId, sessionData);
  createGameSession(simId);

  logger.logEvent(sessionId, {
    level: 'info',
    event: 'session_start',
    sim_id: simId,
    theme: themeId,
    model_requested: modelKey,
    model_actual: parsed.claudeModel || 'unknown',
    claude_session_id: parsed.claudeSessionId
  });

  if (options.playtest) {
    logger.logEvent(sessionId, {
      level: 'info',
      event: 'playtest_mode_active',
      sim_id: simId
    });
  }

  if (parsed.claudeModel && parsed.claudeModel !== modelKey && !parsed.claudeModel.includes(modelKey)) {
    logger.logEvent(sessionId, {
      level: 'warn',
      event: 'MODEL_MISMATCH',
      model_requested: modelKey,
      model_actual: parsed.claudeModel
    });
  }

  if (options.playtest) {
    const transcript = require('./transcript');
    const narratorText = events
      .filter(e => e.type === 'text')
      .map(e => e.content)
      .join('\n');

    transcript.appendTurn(simId, {
      turn: 0,
      narrator: narratorText || null,
      mode: 'narrator'
    });
  }

  return {
    sessionId,
    events,
    sessionComplete
  };
}

async function sendMessage(sessionId, message) {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error('SESSION_LOST: No active session with that ID');
  }

  session.turnCount++;
  const turnNumber = session.turnCount;
  persistSession(sessionId, session);

  const queryOptions = {
    cwd: paths.ROOT,
    allowedTools: ['Read', 'Write'],
    model: session.modelId,
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    maxTurns: 50
  };

  // Resume from existing session
  if (session.claudeSessionId) {
    queryOptions.resume = session.claudeSessionId;
  } else {
    // Fallback: re-send system prompt if no session to resume
    queryOptions.systemPrompt = session.systemPrompt;
  }

  let messages;
  try {
    messages = await collectMessages(query({
      prompt: message,
      options: queryOptions
    }));
  } catch (err) {
    // Session error recovery: retry with fresh session
    if (err.message && (err.message.includes('unknown session') || err.message.includes('SESSION_LOST'))) {
      logger.logEvent(sessionId, {
        level: 'warn',
        event: 'retry',
        reason: 'SESSION_LOST',
        detail: 'Retrying with fresh system prompt'
      });

      const retryOptions = {
        cwd: paths.ROOT,
        allowedTools: ['Read', 'Write'],
        model: session.modelId,
        systemPrompt: session.systemPrompt,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        maxTurns: 50
      };

      messages = await collectMessages(query({
        prompt: message,
        options: retryOptions
      }));

      const retryParsed = parseAgentMessages(messages);
      if (retryParsed.claudeSessionId) {
        session.claudeSessionId = retryParsed.claudeSessionId;
      }
    } else {
      throw err;
    }
  }

  const parsed = parseAgentMessages(messages);
  const { events, sessionComplete } = parseEvents(parsed.fullText);

  // Log result errors
  if (parsed.resultError) {
    logger.logEvent(sessionId, {
      level: 'warn',
      event: 'AGENT_RESULT_ERROR',
      subtype: parsed.resultError.subtype,
      error: parsed.resultError.error
    });
  }

  // Update session ID if we got a new one
  if (parsed.claudeSessionId && parsed.claudeSessionId !== session.claudeSessionId) {
    session.claudeSessionId = parsed.claudeSessionId;
  }

  // Log turn to turns.jsonl
  logTurn(session.simId, turnNumber, message, parsed.usage);

  // Update game session state
  const gameSessionUpdate = { turnCount: turnNumber };
  if (sessionComplete) {
    gameSessionUpdate.status = 'completed';
  }
  updateGameSession(session.simId, gameSessionUpdate);

  if (session.playtest) {
    const transcript = require('./transcript');

    const narratorText = events
      .filter(e => e.type === 'text')
      .map(e => e.content)
      .join('\n');
    const consoleText = events
      .filter(e => e.type === 'console')
      .map(e => e.content)
      .join('\n');
    const coachingText = events
      .filter(e => e.type === 'coaching')
      .map(e => e.content)
      .join('\n');

    const mode = consoleText ? 'console' : coachingText ? 'coaching' : 'narrator';

    transcript.appendTurn(session.simId, {
      turn: turnNumber,
      player: message,
      narrator: narratorText || null,
      console: consoleText || null,
      coaching: coachingText || null,
      mode
    });
  }

  logger.logEvent(sessionId, {
    level: 'info',
    event: 'turn',
    direction: 'out',
    usage: parsed.usage
  });

  if (sessionComplete) {
    logger.logEvent(sessionId, {
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

// --- Post-session agent ---

function buildPostSessionPrompt(simId) {
  const sessionFilePath = paths.sessionFile(simId);
  const manifestPath = paths.manifest(simId);
  const profilePath = paths.PROFILE;
  const catalogPath = paths.CATALOG;
  const coachingPatternsPath = path.join(paths.ROOT, '.claude', 'skills', 'play', 'references', 'coaching-patterns.md');
  const progressionPath = path.join(paths.ROOT, 'references', 'progression.yaml');

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

async function runPostSessionAgent(simId) {
  const prompt = buildPostSessionPrompt(simId);

  const queryOptions = {
    cwd: paths.ROOT,
    allowedTools: ['Read', 'Write'],
    model: 'claude-opus-4-6',
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    maxTurns: 30
  };

  try {
    const metricsConfig = JSON.parse(fs.readFileSync(path.join(paths.ROOT, 'scripts', 'metrics.config.json'), 'utf8'));
    const budget = metricsConfig.budgets?.post_session_usd;
    if (budget) queryOptions.maxBudgetUsd = budget;
  } catch { /* ignore missing config */ }

  const messages = await collectMessages(query({
    prompt,
    options: queryOptions
  }));

  const parsed = parseAgentMessages(messages);

  logger.logEvent(null, {
    level: 'info',
    event: 'post_session_agent_complete',
    sim_id: simId,
    usage: parsed.usage
  });

  if (parsed.resultError) {
    logger.logEvent(null, {
      level: 'error',
      event: 'post_session_agent_error',
      sim_id: simId,
      error: parsed.resultError
    });
    throw new Error(`Post-session agent failed: ${parsed.resultError.subtype}`);
  }

  return { success: true };
}

async function endSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;

  // Abort running query if any
  if (session.abortController) {
    session.abortController.abort();
  }

  logger.logEvent(sessionId, {
    level: 'info',
    event: 'session_end',
    outcome: 'quit'
  });

  // Clean up persisted web-session.json
  if (session.simId) {
    const filePath = path.join(paths.sessionDir(session.simId), 'web-session.json');
    try { fs.unlinkSync(filePath); } catch {}
  }

  sessions.delete(sessionId);
}

module.exports = {
  startSession,
  sendMessage,
  endSession,
  parseEvents,
  parseAgentMessages,
  logTurn,
  collectMessages,
  persistSession,
  recoverSessions,
  createGameSession,
  updateGameSession,
  buildPostSessionPrompt,
  runPostSessionAgent,
  withRetry,
  streamQuery,
  streamSession,
  streamMessage,
  sessions,
  COLLECT_TIMEOUT_MS,
  SESSION_MAX_AGE_MS
};
