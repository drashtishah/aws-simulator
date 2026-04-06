const path = require('path');
const fs = require('fs');
const paths = require('./paths');

let logger;
try {
  logger = require('./logger');
} catch {
  logger = { logEvent: () => {} };
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
    turnCount: sessionData.turnCount || 0
  };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function recoverSessions(buildPromptFn) {
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
      systemPrompt = buildPromptFn(data.simId, data.themeId);
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
  sessions,
  SESSION_MAX_AGE_MS,
  persistSession,
  recoverSessions,
  createGameSession,
  updateGameSession,
  endSession
};
