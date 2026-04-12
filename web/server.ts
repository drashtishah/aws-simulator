import express from 'express';
import type { Request, Response } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { exec, execSync } from 'node:child_process';
import paths from './lib/paths';
import { getConfig, currentRank, normalizeHexagon, getQuestionTypes, progression, parseCatalog } from './lib/progress';
import { stripFrontmatter } from './lib/frontmatter';

const app = express();

// Live reload in development
if (process.env.NODE_ENV === 'development') {
  const livereload = require('livereload');
  const connectLivereload = require('connect-livereload');
  const lrServer = livereload.createServer({
    exts: ['html', 'css', 'js'],
    delay: 100
  });
  lrServer.watch(paths.PUBLIC_DIR);
  app.use(connectLivereload());
}

app.use(express.json());
app.use('/api/save-recording', express.raw({ type: 'video/webm', limit: '100mb' }));
app.use(express.static(path.join(paths.ROOT, 'dist', 'public')));
app.use(express.static(paths.PUBLIC_DIR));

// --- Recording ---

app.post('/api/save-recording', (req: Request, res: Response) => {
  if (!req.body || !Buffer.isBuffer(req.body) || req.body.length === 0) {
    res.status(400).json({ error: 'empty body' });
    return;
  }
  fs.mkdirSync(paths.VIDEOS_DIR, { recursive: true });
  const basename = `session-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const webmPath = path.join(paths.VIDEOS_DIR, `${basename}.webm`);
  const mp4Path = path.join(paths.VIDEOS_DIR, `${basename}.mp4`);
  fs.writeFileSync(webmPath, req.body);
  exec(`ffmpeg -i "${webmPath}" -c:v libx264 -c:a aac -movflags +faststart "${mp4Path}"`, (err) => {
    if (err) console.error(`mp4 conversion failed for ${basename}:`, err.message);
    else console.log(`Converted ${basename}.mp4`);
  });
  res.status(201).json({ filename: `${basename}.webm` });
});

// --- Startup validation ---

function validateStartup(): void {
  try {
    execSync('which claude', { stdio: 'ignore' });
  } catch {
    console.error('Error: Claude CLI not found. Install it from https://docs.anthropic.com/en/docs/claude-code');
    process.exit(1);
  }

  const registryPath = paths.REGISTRY;
  if (!fs.existsSync(registryPath)) {
    console.error('Error: sims/registry.json not found. Run /create-sim first or check your clone.');
    process.exit(1);
  }
}

// --- Helper: safe JSON read ---

function readJSON<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

// --- Data API endpoints ---

app.get('/api/profile', (_req: Request, res: Response) => {
  const profile = readJSON(paths.PROFILE, {
    completed_sims: [] as string[],
    skill_polygon: {} as Record<string, number>
  });
  res.json(profile);
});

app.get('/api/registry', (_req: Request, res: Response) => {
  const registry = readJSON(paths.REGISTRY, { version: 1, sims: [] as unknown[] });
  res.json(registry);
});

app.get('/api/themes', (_req: Request, res: Response) => {
  try {
    const files = fs.readdirSync(paths.THEMES_DIR).filter(f => f.endsWith('.md') && !f.startsWith('_'));
    const themes = files.map(f => {
      const content = fs.readFileSync(path.join(paths.THEMES_DIR, f), 'utf8');
      const { meta } = stripFrontmatter(content);
      return {
        id: meta['id'] ?? f.replace('.md', ''),
        name: meta['name'] ?? f.replace('.md', ''),
        tagline: meta['tagline'] ?? ''
      };
    });
    res.json(themes);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`GET /api/themes: failed to read ${paths.THEMES_DIR}: ${message}`);
    res.json([]);
  }
});

app.get('/api/sims/:id/manifest', (req: Request, res: Response) => {
  const simId = req.params['id'] as string;
  const manifestPath = paths.manifest(simId);
  if (!fs.existsSync(manifestPath)) {
    return res.status(404).json({ error: 'Sim not found' });
  }
  const manifest = readJSON(manifestPath, null);
  if (!manifest) return res.status(500).json({ error: 'Invalid manifest' });
  res.json(manifest);
});

app.get('/api/sims/:id/artifacts/:file', (req: Request, res: Response) => {
  const simId = req.params['id'] as string;
  const fileName = req.params['file'] as string;
  const filePath = path.join(paths.simDir(simId), 'artifacts', fileName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Artifact not found' });
  }
  res.type('text/plain').send(fs.readFileSync(filePath, 'utf8'));
});

app.get('/api/sessions', (_req: Request, res: Response) => {
  try {
    const entries = fs.readdirSync(paths.SESSIONS_DIR, { withFileTypes: true });
    const sessions = entries
      .filter(e => e.isDirectory())
      .map(e => readJSON(path.join(paths.SESSIONS_DIR, e.name, 'session.json'), null))
      .filter(Boolean);
    res.json(sessions);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`GET /api/sessions: failed to read ${paths.SESSIONS_DIR}: ${message}`);
    res.json([]);
  }
});

app.get('/api/journal-summary', (_req: Request, res: Response) => {
  const vaultSessionsDir = path.join(paths.VAULT_DIR, 'sessions');
  try {
    const files = fs.readdirSync(vaultSessionsDir).filter(f => f.endsWith('.md')).sort().reverse().slice(0, 5);
    if (files.length > 0) {
      const parsed = files.map(f => {
        const content = fs.readFileSync(path.join(vaultSessionsDir, f), 'utf8');
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
        const meta: Record<string, string> = {};
        if (fmMatch) {
          for (const line of (fmMatch[1] ?? '').split('\n')) {
            const idx = line.indexOf(':');
            if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
          }
        }
        const body = fmMatch ? (fmMatch[2] ?? '') : content;
        const titleMatch = body.match(/^# (.+)/m);
        return {
          title: titleMatch ? (titleMatch[1] ?? '').trim() : f.replace('.md', ''),
          date: meta['date'] ?? '',
          takeaway: (body.match(/## Coaching Summary\n\n(.+)/m)?.[1] ?? '').trim().slice(0, 200)
        };
      });
      return res.json(parsed);
    }
  } catch {
    // vault may not exist yet
  }

  const journalPath = paths.JOURNAL;
  try {
    const content = fs.readFileSync(journalPath, 'utf8');
    if (!content.trim()) return res.json([]);

    const entries = content.split(/^## /m).filter(Boolean).slice(0, 5);
    const parsed = entries.map(entry => {
      const lines = entry.trim().split('\n');
      const title = lines[0] ?? '';
      const dateMatch = entry.match(/\*\*Date\*\*:\s*(.+)/i) ?? entry.match(/Date:\s*(.+)/i);
      const takeawayMatch = entry.match(/\*\*Key [Tt]akeaway\*\*:\s*(.+)/i) ?? entry.match(/Key [Tt]akeaway:\s*(.+)/i);
      return {
        title: title.trim(),
        date: dateMatch ? (dateMatch[1] ?? '').trim() : '',
        takeaway: takeawayMatch ? (takeawayMatch[1] ?? '').trim() : lines.slice(1).join(' ').trim().slice(0, 200)
      };
    });
    res.json(parsed);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`GET /api/journal-summary: failed to read: ${message}`);
    res.json([]);
  }
});

app.get('/api/ui-themes', (_req: Request, res: Response) => {
  try {
    const files = fs.readdirSync(paths.UI_THEMES_DIR).filter(f => f.endsWith('.css'));
    const themes = files.map(f => f.replace('.css', ''));
    res.json(themes);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`GET /api/ui-themes: failed to read ${paths.UI_THEMES_DIR}: ${message}`);
    res.json([]);
  }
});

interface ProfileData {
  skill_polygon?: Record<string, number>;
  completed_sims?: string[];
  polygon_last_advanced?: Record<string, string>;
  rank_history?: unknown[];
  challenge_runs?: unknown[];
  question_quality?: unknown;
  sessions_at_current_rank?: number;
  behavioral_profile_summary?: string | null;
}

interface RegistryData {
  sims: Array<{
    id: string;
    title: string;
    difficulty?: number;
    category?: string;
    services?: string[];
    summary?: string;
  }>;
}

app.get('/api/progress', (_req: Request, res: Response) => {
  const config = getConfig();
  const profile = readJSON<ProfileData>(paths.PROFILE, {
    skill_polygon: {},
    completed_sims: []
  });

  const polygon = progression.initPolygon(profile.skill_polygon ?? {}, config);
  const rank = progression.currentRank(polygon, config);
  const normalized = progression.normalizePolygon(polygon, config);
  const axes = progression.axisNames(config);
  const axisLabels: Record<string, string> = {};
  for (const a of axes) {
    const axisConfig = config.axes[a] as { label?: string } | undefined;
    axisLabels[a] = axisConfig?.label ?? a;
  }

  const rankIdx = config.ranks.findIndex(r => r.id === rank.id);
  const nextRank = rankIdx > 0 ? config.ranks[rankIdx - 1] : null;

  let servicesEncountered: string[] = [];
  try {
    const content = fs.readFileSync(paths.CATALOG, 'utf8');
    const catalog = parseCatalog(content);
    servicesEncountered = catalog.filter(s => s.sims_completed > 0).map(s => s.full_name);
  } catch {
    // catalog may not exist yet
  }

  const completedSimIds = profile.completed_sims ?? [];
  const registry = readJSON<RegistryData>(paths.REGISTRY, { sims: [] });
  const completedSims = completedSimIds.map(id => {
    const sim = registry.sims.find(s => s.id === id);
    if (!sim) return { id, title: id, questionTypes: ['gather'] };
    const cat = (sim.category ?? '').toLowerCase();
    const questionTypes = config.category_map[cat] ?? ['gather'];
    return {
      id: sim.id,
      title: sim.title,
      difficulty: sim.difficulty,
      category: sim.category,
      services: sim.services,
      summary: sim.summary,
      questionTypes
    };
  });

  res.json({
    rank: rank.title,
    rankTitle: rank.title,
    polygon: normalized,
    rawPolygon: polygon,
    hexagon: normalized,
    axisNames: axes,
    axisLabels,
    maxDifficulty: rank.max_difficulty,
    polygonLastAdvanced: profile.polygon_last_advanced ?? {},
    rankHistory: profile.rank_history ?? [],
    challengeRuns: profile.challenge_runs ?? [],
    categoryMap: config.category_map,
    nextRank,
    assist: (config as unknown as Record<string, unknown>).assist ?? {},
    simsCompleted: completedSimIds.length,
    completedSims,
    servicesEncountered,
    questionQuality: profile.question_quality ?? null,
    sessionsAtCurrentRank: profile.sessions_at_current_rank ?? 0,
    behavioralProfile: profile.behavioral_profile_summary ?? null
  });
});

// --- Game API endpoints ---

let claudeProcess: typeof import('./lib/claude-process') | undefined;
let claudeSession: typeof import('./lib/claude-session') | undefined;
let claudeStream: typeof import('./lib/claude-stream') | undefined;
try {
  claudeProcess = require('./lib/claude-process');
  claudeSession = require('./lib/claude-session');
  claudeStream = require('./lib/claude-stream');
} catch {
  // claude modules not yet created
}

interface StartBody { simId: string; themeId?: string }
interface MessageBody { sessionId: string; message: string }
interface QuitBody { sessionId: string }
interface ResumeBody { simId: string; themeId?: string }

app.post('/api/game/start', async (req: Request, res: Response) => {
  if (!claudeStream) return res.status(503).json({ error: 'Game engine not available' });

  const { simId, themeId } = req.body as StartBody;
  if (!simId) return res.status(400).json({ error: 'simId is required' });

  const registry = readJSON<RegistryData>(paths.REGISTRY, { sims: [] });
  const simExists = registry.sims.some(s => s.id === simId);
  if (!simExists) return res.status(400).json({ error: 'Invalid simId' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    for await (const event of claudeStream.streamSession(simId, themeId ?? 'calm-mentor', {})) {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    }
    if (!res.writableEnded) res.end();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`POST /api/game/start: simId=${simId}, error=${message}`);
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`);
      res.end();
    }
  }
});

app.post('/api/game/message', async (req: Request, res: Response) => {
  if (!claudeStream || !claudeProcess || !claudeSession) return res.status(503).json({ error: 'Game engine not available' });

  const { sessionId, message } = req.body as MessageBody;
  if (!message?.trim()) return res.status(400).json({ error: 'Message is required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let msg = message;
  let truncated = false;
  if (msg.length > 2000) {
    msg = msg.slice(0, 2000);
    truncated = true;
  }

  try {
    if (truncated) {
      res.write(`data: ${JSON.stringify({ type: 'warning', message: 'Message truncated to 2000 characters.' })}\n\n`);
    }

    let sessionComplete = false;
    for await (const event of claudeStream.streamMessage(sessionId, msg)) {
      if (event.type === 'done' && 'sessionComplete' in event && event.sessionComplete) {
        sessionComplete = true;
      }
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    }

    if (sessionComplete) {
      const session = claudeSession.sessions.get(sessionId);
      const simId = session ? session.simId : null;
      if (simId) {
        res.write(`data: ${JSON.stringify({ type: 'profile_updating' })}\n\n`);
        try {
          await claudeProcess.runPostSessionAgent(simId);
          res.write(`data: ${JSON.stringify({ type: 'profile_updated' })}\n\n`);
        } catch (postErr: unknown) {
          const postMessage = postErr instanceof Error ? postErr.message : String(postErr);
          console.error(`POST /api/game/message: post-session agent failed: ${postMessage}`);
          res.write(`data: ${JSON.stringify({ type: 'profile_update_failed', message: postMessage })}\n\n`);
        }
      }
    }

    if (!res.writableEnded) res.end();
  } catch (err: unknown) {
    const errMessage = err instanceof Error ? err.message : String(err);
    console.error(`POST /api/game/message: sessionId=${sessionId}, error=${errMessage}`);
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: errMessage })}\n\n`);
      res.end();
    }
  }
});

app.post('/api/game/quit', async (req: Request, res: Response) => {
  if (!claudeProcess) return res.status(503).json({ error: 'Game engine not available' });
  const { sessionId } = req.body as QuitBody;
  try {
    await claudeProcess.endSession(sessionId);
    res.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`POST /api/game/quit: sessionId=${sessionId}, error=${message}`);
    res.json({ ok: true });
  }
});

app.post('/api/game/resume', async (req: Request, res: Response) => {
  if (!claudeStream) return res.status(503).json({ error: 'Game engine not available' });

  const { simId, themeId } = req.body as ResumeBody;
  if (!simId) return res.status(400).json({ error: 'simId is required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    for await (const event of claudeStream.streamSession(simId, themeId ?? 'calm-mentor', {
      resume: true,
      resumeMessage: `Resume the in-progress session. Read learning/sessions/${simId}/session.json for session state.`
    })) {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    }
    if (!res.writableEnded) res.end();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`POST /api/game/resume: simId=${simId}, error=${message}`);
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`);
      res.end();
    }
  }
});

// --- Server startup ---

function startServer(port: number): ReturnType<typeof app.listen> {
  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`AWS Incident Simulator running at http://127.0.0.1:${port}`);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE' && port < 3203) {
      console.log(`Port ${port} in use, trying ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error(`Failed to start server: ${err.message}`);
      process.exit(1);
    }
  });

  return server;
}

validateStartup();

// Recover any persisted web sessions from disk
if (claudeSession?.recoverSessions) {
  const { buildPrompt } = require('./lib/prompt-builder');
  claudeSession.recoverSessions(buildPrompt);
}

// Create lock file to signal web app is running
const lockPath = path.join(paths.ROOT, 'learning', 'logs', '.web-active.lock');
fs.mkdirSync(path.dirname(lockPath), { recursive: true });
fs.writeFileSync(lockPath, JSON.stringify({
  pid: process.pid,
  port: 3200,
  startedAt: new Date().toISOString()
}));

function cleanupLock(): void {
  try { fs.unlinkSync(lockPath); } catch {}
}
process.on('SIGINT', () => { cleanupLock(); process.exit(); });
process.on('SIGTERM', () => { cleanupLock(); process.exit(); });
process.on('exit', cleanupLock);

const config = getConfig();
startServer(3200);

export default app;
