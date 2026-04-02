const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { buildPrompt } = require('./prompt-builder');
const paths = require('./paths');

let logger;
try {
  logger = require('./logger');
} catch {
  // logger not yet created, use console fallback
  logger = {
    logEvent: () => {},
    generateFixManifest: () => {}
  };
}

// In-memory session store (single-session enforcement)
const sessions = new Map();

function cleanEnv() {
  const env = { ...process.env };
  for (const key of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT',
    'CLAUDE_CODE_SESSION', 'CLAUDE_CODE_PARENT_SESSION']) {
    delete env[key];
  }
  return env;
}

function parseStreamJson(stdout) {
  const lines = stdout.split('\n').filter(l => l.trim());
  let claudeSessionId = null;
  let claudeModel = null;
  const textParts = [];
  let usage = null;

  for (const line of lines) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    if (parsed.type === 'system' && parsed.subtype === 'init') {
      claudeSessionId = parsed.session_id;
      if (parsed.model) claudeModel = parsed.model;
    } else if (parsed.type === 'assistant' && parsed.message) {
      const content = parsed.message.content || [];
      for (const block of content) {
        if (block.type === 'text') {
          textParts.push(block.text);
        }
      }
    } else if (parsed.type === 'result') {
      usage = {
        input_tokens: parsed.input_tokens || (parsed.usage && parsed.usage.input_tokens) || 0,
        output_tokens: parsed.output_tokens || (parsed.usage && parsed.usage.output_tokens) || 0
      };
      if (parsed.duration_ms) usage.duration_ms = parsed.duration_ms;
    }
  }

  const fullText = textParts.join('');

  // Parse markers from full text
  const events = [];
  let remaining = fullText;

  // Extract console blocks
  const consoleRegex = /\[CONSOLE_START\]([\s\S]*?)\[CONSOLE_END\]/g;
  let match;
  let lastIndex = 0;
  const segments = [];

  while ((match = consoleRegex.exec(remaining)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: remaining.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'console', content: match[1].trim() });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < remaining.length) {
    segments.push({ type: 'text', content: remaining.slice(lastIndex) });
  }

  // If no console markers found, treat everything as text
  if (segments.length === 0) {
    segments.push({ type: 'text', content: remaining });
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

  // Remove the [SESSION_COMPLETE] marker from event content
  if (sessionComplete) {
    for (const event of events) {
      if (event.content) {
        event.content = event.content.replace('[SESSION_COMPLETE]', '').trim();
      }
    }
  }

  return { claudeSessionId, claudeModel, events, sessionComplete, usage };
}

function spawnClaude(args, stdinData) {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', args, {
      cwd: paths.ROOT,
      env: cleanEnv(),
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', d => stdout += d.toString());
    proc.stderr.on('data', d => stderr += d.toString());

    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (!proc.killed) proc.kill('SIGKILL');
      }, 1000);
      reject(new Error('TIMEOUT: Claude subprocess exceeded 120s'));
    }, 120000);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0 && !stdout.trim()) {
        reject(new Error(`SUBPROCESS_CRASH: exit code ${code}, stderr: ${stderr.slice(0, 500)}`));
        return;
      }
      resolve({ stdout, stderr, code, pid: proc.pid });
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`SUBPROCESS_CRASH: ${err.message}`));
    });

    if (stdinData) {
      proc.stdin.write(stdinData);
    }
    proc.stdin.end();
  });
}

async function startSession(simId, themeId, options = {}) {
  // Single-session enforcement: end any active session
  for (const [id] of sessions) {
    await endSession(id);
  }

  const VALID_MODELS = ['sonnet', 'opus', 'haiku'];
  const model = VALID_MODELS.includes(options.model) ? options.model : 'sonnet';

  const sessionId = crypto.randomUUID();
  const turnStart = new Date();

  // Build and write prompt to temp file
  const promptText = buildPrompt(simId, themeId);
  const promptFile = path.join('/tmp', `aws-sim-prompt-${sessionId}.txt`);
  fs.writeFileSync(promptFile, promptText);

  const stdinMessage = options.resume
    ? (options.resumeMessage || `Resume the in-progress session. Read learning/sessions/${simId}/session.json for session state.`)
    : 'Begin the simulation. Deliver the Opening and Briefing Card.';

  const args = [
    '--print', '-',
    '--verbose',
    '--output-format', 'stream-json',
    '--append-system-prompt-file', promptFile,
    '--dangerously-skip-permissions',
    '--allowedTools', 'Read,Write',
    '--model', model
  ];

  const { stdout } = await spawnClaude(args, stdinMessage);
  const parsed = parseStreamJson(stdout);

  sessions.set(sessionId, {
    claudeSessionId: parsed.claudeSessionId,
    simId,
    themeId,
    model,
    promptFile,
    startedAt: turnStart,
    autosaveFailCount: 0,
    playtest: options.playtest || false,
    turnCount: 0
  });

  logger.logEvent(sessionId, {
    level: 'info',
    event: 'session_start',
    sim_id: simId,
    theme: themeId,
    model_requested: model,
    model_actual: parsed.claudeModel || 'unknown',
    claude_session_id: parsed.claudeSessionId
  });

  if (parsed.claudeModel && parsed.claudeModel !== model && !parsed.claudeModel.includes(model)) {
    logger.logEvent(sessionId, {
      level: 'warn',
      event: 'MODEL_MISMATCH',
      model_requested: model,
      model_actual: parsed.claudeModel
    });
  }

  // Verify autosave
  const autosaveResult = verifyAutosave(simId, turnStart);
  if (!autosaveResult.ok) {
    const session = sessions.get(sessionId);
    session.autosaveFailCount++;
    const level = session.autosaveFailCount >= 3 ? 'error' : 'warn';
    logger.logEvent(sessionId, {
      level,
      event: 'SESSION_AUTOSAVE_FAILED',
      failedCheck: autosaveResult.failedCheck,
      failCount: session.autosaveFailCount
    });
  } else {
    const session = sessions.get(sessionId);
    if (session) session.autosaveFailCount = 0;
  }

  if (options.playtest) {
    const transcript = require('./transcript');
    const narratorText = parsed.events
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
    events: parsed.events,
    sessionComplete: parsed.sessionComplete
  };
}

async function sendMessage(sessionId, message) {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error('SESSION_LOST: No active session with that ID');
  }

  const turnStart = new Date();

  const args = [
    '--print', '-',
    '--verbose',
    '--output-format', 'stream-json',
    '--resume', session.claudeSessionId,
    '--dangerously-skip-permissions',
    '--allowedTools', 'Read,Write',
    '--model', session.model || 'sonnet'
  ];

  let result;
  try {
    result = await spawnClaude(args, message);
  } catch (err) {
    // Session error recovery: retry without --resume
    if (err.message.includes('unknown session') || err.message.includes('SESSION_LOST')) {
      logger.logEvent(sessionId, {
        level: 'warn',
        event: 'retry',
        reason: 'SESSION_LOST',
        detail: 'Retrying without --resume'
      });

      const retryArgs = [
        '--print', '-',
        '--verbose',
        '--output-format', 'stream-json',
        '--append-system-prompt-file', session.promptFile,
        '--dangerously-skip-permissions',
        '--allowedTools', 'Read,Write',
        '--model', session.model || 'sonnet'
      ];
      result = await spawnClaude(retryArgs, message);
      const parsed = parseStreamJson(result.stdout);
      // Update claude session ID
      if (parsed.claudeSessionId) {
        session.claudeSessionId = parsed.claudeSessionId;
      }
    } else {
      throw err;
    }
  }

  const parsed = parseStreamJson(result.stdout);

  if (session && session.playtest) {
    const transcript = require('./transcript');
    session.turnCount++;

    const narratorText = parsed.events
      .filter(e => e.type === 'text')
      .map(e => e.content)
      .join('\n');
    const consoleText = parsed.events
      .filter(e => e.type === 'console')
      .map(e => e.content)
      .join('\n');
    const coachingText = parsed.events
      .filter(e => e.type === 'coaching')
      .map(e => e.content)
      .join('\n');

    const mode = consoleText ? 'console' : coachingText ? 'coaching' : 'narrator';

    transcript.appendTurn(session.simId, {
      turn: session.turnCount,
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

  // Verify autosave
  const autosaveResult = verifyAutosave(session.simId, turnStart);
  if (!autosaveResult.ok) {
    session.autosaveFailCount++;
    const level = session.autosaveFailCount >= 3 ? 'error' : 'warn';
    logger.logEvent(sessionId, {
      level,
      event: 'SESSION_AUTOSAVE_FAILED',
      failedCheck: autosaveResult.failedCheck,
      failCount: session.autosaveFailCount
    });
  } else {
    session.autosaveFailCount = 0;
  }

  // Clean up on session complete
  if (parsed.sessionComplete) {
    logger.logEvent(sessionId, {
      level: 'info',
      event: 'session_end',
      outcome: 'success'
    });
    cleanupPromptFile(session.promptFile);
  }

  return {
    events: parsed.events,
    sessionComplete: parsed.sessionComplete
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

  cleanupPromptFile(session.promptFile);
  sessions.delete(sessionId);
}

function verifyAutosave(simId, turnStartTime) {
  const sessionFile = paths.sessionFile(simId);

  if (!fs.existsSync(sessionFile)) {
    return { ok: false, failedCheck: 'file_missing' };
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
  } catch {
    return { ok: false, failedCheck: 'invalid_json' };
  }

  if (data.sim_id && data.sim_id !== simId) {
    return { ok: false, failedCheck: 'sim_id_mismatch' };
  }

  if (data.last_active) {
    const lastActive = new Date(data.last_active);
    if (lastActive < turnStartTime) {
      return { ok: false, failedCheck: 'stale_timestamp' };
    }
  }

  return { ok: true, failedCheck: null };
}

function cleanupPromptFile(promptFile) {
  try {
    if (promptFile && fs.existsSync(promptFile)) {
      fs.unlinkSync(promptFile);
    }
  } catch {
    // ignore cleanup errors
  }
}

module.exports = {
  startSession,
  sendMessage,
  endSession,
  parseStreamJson,
  verifyAutosave,
  sessions
};
