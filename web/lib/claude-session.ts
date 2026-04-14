import path from 'node:path';
import fs from 'node:fs';
import * as paths from './paths.js';
import { logEvent } from './logger.js';

export interface SessionData {
  claudeSessionId: string | null;
  simId: string;
  themeId: string;
  model: string;
  modelId: string;
  startedAt: Date;
  turnCount: number;
  systemPrompt: string;
  abortController?: AbortController;
}

interface PersistedSession {
  sessionId: string;
  claudeSessionId: string | null;
  simId: string;
  themeId: string;
  model: string;
  modelId: string;
  startedAt: string;
  turnCount: number;
}

interface CriterionStatus {
  id: string;
  description: string;
  required: boolean;
}

interface QuestionAxisProfile {
  count: number;
  effective: number;
}

export interface GameSession {
  sim_id: string;
  status: string;
  started_at: string;
  last_active: string;
  criteria_met: CriterionStatus[];
  criteria_remaining: CriterionStatus[];
  question_profile: Record<string, QuestionAxisProfile>;
  investigation_summary: string;
  story_beats_fired: string[];
  services_queried: string[];
  feedback_notes: string[];
  debrief_phase: string | null;
  debrief_questions_asked: number;
  debrief_zones_explored: string[];
  debrief_seeds_offered: string[];
  debrief_depth_score: number;
  question_quality_scores: unknown[];
  turnCount?: number;
  [key: string]: unknown;
}

export const sessions = new Map<string, SessionData>();

export const SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export function persistSession(sessionId: string, sessionData: SessionData): void {
  const dir = paths.sessionDir(sessionData.simId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'web-session.json');
  const data: PersistedSession = {
    sessionId,
    claudeSessionId: sessionData.claudeSessionId,
    simId: sessionData.simId,
    themeId: sessionData.themeId,
    model: sessionData.model,
    modelId: sessionData.modelId,
    startedAt: sessionData.startedAt instanceof Date ? sessionData.startedAt.toISOString() : String(sessionData.startedAt),
    turnCount: sessionData.turnCount || 0
  };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

export function recoverSessions(buildPromptFn: (simId: string, themeId: string) => string): void {
  const sessionsDir = paths.SESSIONS_DIR;
  if (!fs.existsSync(sessionsDir)) return;

  const entries = fs.readdirSync(sessionsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const filePath = path.join(sessionsDir, entry.name, 'web-session.json');
    if (!fs.existsSync(filePath)) continue;

    let data: PersistedSession;
    try {
      data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      continue;
    }

    const age = Date.now() - new Date(data.startedAt).getTime();
    if (age > SESSION_MAX_AGE_MS) continue;

    let systemPrompt: string;
    try {
      systemPrompt = buildPromptFn(data.simId, data.themeId);
    } catch {
      continue;
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

export function createGameSession(simId: string): GameSession {
  const manifestPath = paths.manifest(simId);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
    resolution: { fix_criteria?: Array<{ id: string; description: string; required: boolean }> };
  };

  const now = new Date().toISOString();
  const axes = ['gather', 'diagnose', 'correlate', 'impact', 'trace', 'fix'];
  const questionProfile: Record<string, QuestionAxisProfile> = {};
  for (const axis of axes) {
    questionProfile[axis] = { count: 0, effective: 0 };
  }

  const session: GameSession = {
    sim_id: simId,
    status: 'in_progress',
    started_at: now,
    last_active: now,
    criteria_met: [],
    criteria_remaining: (manifest.resolution.fix_criteria ?? []).map(c => ({
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

export function updateGameSession(simId: string, updates: Record<string, unknown>): GameSession | null {
  const filePath = paths.sessionFile(simId);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const session = JSON.parse(fs.readFileSync(filePath, 'utf8')) as GameSession;
  Object.assign(session, updates);
  session.last_active = new Date().toISOString();

  fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
  return session;
}

export async function endSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;

  if (session.abortController) {
    session.abortController.abort();
  }

  logEvent(sessionId, {
    level: 'info',
    event: 'session_end',
    outcome: 'quit'
  });

  if (session.simId) {
    const filePath = path.join(paths.sessionDir(session.simId), 'web-session.json');
    try { fs.unlinkSync(filePath); } catch {}
  }

  sessions.delete(sessionId);
}
