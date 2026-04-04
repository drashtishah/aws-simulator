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

// --- Model mapping ---

const MODEL_MAP = {
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-6',
  haiku: 'claude-haiku-4-5'
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

  return {
    claudeSessionId,
    claudeModel,
    fullText: textParts.join(''),
    usage
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

async function collectMessages(asyncIterator) {
  const messages = [];
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('AGENT_TIMEOUT: Response exceeded 120 seconds')), COLLECT_TIMEOUT_MS)
  );

  const collect = async () => {
    for await (const message of asyncIterator) {
      messages.push(message);
    }
    return messages;
  };

  return Promise.race([collect(), timeout]);
}

// --- Session management ---

async function startSession(simId, themeId, options = {}) {
  // Single-session enforcement: end any active session
  for (const [id] of sessions) {
    await endSession(id);
  }

  const VALID_MODELS = ['sonnet', 'opus', 'haiku'];
  const modelKey = VALID_MODELS.includes(options.model) ? options.model : 'sonnet';
  const modelId = MODEL_MAP[modelKey];

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

  sessions.set(sessionId, {
    claudeSessionId: parsed.claudeSessionId,
    simId,
    themeId,
    model: modelKey,
    modelId,
    startedAt: new Date(),
    playtest: options.playtest || false,
    turnCount: 0,
    systemPrompt: promptText
  });

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

  // Update session ID if we got a new one
  if (parsed.claudeSessionId && parsed.claudeSessionId !== session.claudeSessionId) {
    session.claudeSessionId = parsed.claudeSessionId;
  }

  // Log turn to turns.jsonl
  logTurn(session.simId, turnNumber, message, parsed.usage);

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

async function endSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;

  logger.logEvent(sessionId, {
    level: 'info',
    event: 'session_end',
    outcome: 'quit'
  });

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
  sessions,
  COLLECT_TIMEOUT_MS
};
