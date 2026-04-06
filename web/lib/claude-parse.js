const path = require('path');
const fs = require('fs');
const paths = require('./paths');

const COLLECT_TIMEOUT_MS = 120000;

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

/**
 * Collect all messages from Agent SDK query() async iterator.
 */
async function collectMessages(asyncIterator, timeoutMs = COLLECT_TIMEOUT_MS) {
  const messages = [];

  const timeout = new Promise((_, reject) => {
    const timer = setTimeout(() => {
      if (asyncIterator.return) {
        asyncIterator.return().catch(() => {});
      }
      reject(new Error(`AGENT_TIMEOUT: Response exceeded ${timeoutMs / 1000} seconds`));
    }, timeoutMs);
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

/**
 * Retry wrapper with exponential backoff.
 */
async function withRetry(fn, { maxAttempts = 3, delays = [1000, 2000, 4000] } = {}) {
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

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

module.exports = {
  parseEvents,
  parseAgentMessages,
  logTurn,
  collectMessages,
  withRetry,
  COLLECT_TIMEOUT_MS
};
