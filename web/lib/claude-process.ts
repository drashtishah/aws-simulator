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

// Play uses Sonnet-medium with progressive disclosure of artifacts (see
// prompt-builder). Manifest, story, and resolution stay in context so the
// narrator can guide and verify the player's fix without leaking. Rollback
// to Opus is a one-line change in scripts/model-config.json; no code revert
// needed. Per-stage effort lives in scripts/model-config.json.
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
  const turnsPath = paths.turnsFile(simId);
  const manifestPath = paths.manifest(simId);
  const profilePath = paths.PROFILE;
  const catalogPath = paths.CATALOG;
  const coachingPatternsPath = path.join(paths.ROOT, '.claude', 'skills', 'play', 'references', 'coaching-patterns.md');
  const progressionPath = path.join(paths.ROOT, 'references', 'config', 'progression.yaml');
  const vaultDir = paths.VAULT_DIR;

  return `You are the post-session analysis agent. The play session just ended.

Your job: score the player from the transcript, update profile and catalog, write Obsidian vault notes.

Read:
- Transcript: ${turnsPath}
- Session metadata: ${sessionFilePath}
- Player profile: ${profilePath}
- Services catalog: ${catalogPath}
- Coaching patterns (classification + scoring rules): ${coachingPatternsPath}
- Progression config (rank gates, polygon rules): ${progressionPath}
- Sim manifest (scoring rubric only: services, resolution.fix_criteria, resolution.learning_objectives): ${manifestPath}

Do NOT read: sims/${simId}/story.md, sims/${simId}/resolution.md, sims/${simId}/artifacts/*. The transcript is your source of truth for what happened.

Steps:
1. Read the transcript. Classify each player question into one of: gather, diagnose, correlate, impact, trace, fix. Follow coaching-patterns.md.
2. For each classification, judge effectiveness: did the question advance the investigation, or was it off-track.
3. Identify which of the sim's fix_criteria the player articulated (literal content match, not wording).
4. Identify services the player touched by name in the transcript.
5. Update ${profilePath}: add sim to completed_sims, update skill_polygon with quality-weighted diminishing returns per progression.yaml, update question-quality running averages, derive rank, increment total_sessions and sessions_at_current_rank.
6. Update ${catalogPath}: increment sims_completed, update knowledge_score, set last_practiced.
7. Write Obsidian vault notes under ${vaultDir}:

Obsidian conventions:
- Every note starts with YAML frontmatter (--- fenced). Keys: date (YYYY-MM-DD), tags (array), plus type-specific keys.
- Links between notes use [[wiki-link]] syntax. Link by note title without extension. Folder prefix optional: [[services/EC2]] or [[EC2]].
- Tags use hashtag form inline (#session) or in frontmatter tags array.
- Filenames lowercase, kebab-case. Session notes prefix with date: 2026-04-14-001-ec2-unreachable.md.

Note types to write:
- ${vaultDir}/sessions/{YYYY-MM-DD}-${simId}.md: one session note. Frontmatter: date, sim, rank_at_time, services (array), concepts (array), question_types (array), tags: [session]. Body summarizes what happened and links to [[services/<service>]] and [[concepts/<concept>]] notes, plus the sim by title.
- ${vaultDir}/services/{service}.md: one per AWS service touched. Create if missing. Append a new bullet under ## Sessions linking back to this session note. Frontmatter: type: service, tags: [service].
- ${vaultDir}/concepts/{concept}.md: one per AWS concept surfaced (security-groups, iam-execution-role, alb-health-checks, etc.). Create if missing. Append a sentence or two about how the concept appeared in this session, and a [[sessions/...]] link. Frontmatter: type: concept, tags: [concept].
- ${vaultDir}/rank.md: create if missing, then update. Frontmatter: current_rank, sessions_completed, skill_polygon. Body has a ## Sessions section with [[sessions/...]] links in reverse-chron order.

8. Set session status to "completed" in ${sessionFilePath}.

Do not skip steps. All writes are inside ${vaultDir}, ${profilePath}, ${catalogPath}, and ${sessionFilePath}. Do not touch sim files, agent prompts, or code.`;
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
