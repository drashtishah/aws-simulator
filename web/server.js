const express = require('express');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const paths = require('./lib/paths');
const { getConfig, currentRank, normalizeHexagon, getQuestionTypes, progression, parseCatalog } = require('./lib/progress');

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
app.use(express.static(paths.PUBLIC_DIR));

// --- Startup validation ---

function validateStartup() {
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

function readJSON(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

const { stripFrontmatter } = require('./lib/frontmatter');

// --- Data API endpoints ---

app.get('/api/profile', (req, res) => {
  const profile = readJSON(paths.PROFILE, {
    completed_sims: [],
    skill_polygon: {}
  });
  res.json(profile);
});

app.get('/api/registry', (req, res) => {
  const registry = readJSON(paths.REGISTRY, { version: 1, sims: [] });
  res.json(registry);
});

app.get('/api/themes', (req, res) => {
  try {
    const files = fs.readdirSync(paths.THEMES_DIR).filter(f => f.endsWith('.md') && !f.startsWith('_'));
    const themes = files.map(f => {
      const content = fs.readFileSync(path.join(paths.THEMES_DIR, f), 'utf8');
      const { meta } = stripFrontmatter(content);
      return {
        id: meta.id || f.replace('.md', ''),
        name: meta.name || f.replace('.md', ''),
        tagline: meta.tagline || ''
      };
    });
    res.json(themes);
  } catch (err) {
    console.error(`GET /api/themes: failed to read ${paths.THEMES_DIR}: ${err.message}`);
    res.json([]);
  }
});

app.get('/api/sims/:id/manifest', (req, res) => {
  const manifestPath = paths.manifest(req.params.id);
  if (!fs.existsSync(manifestPath)) {
    return res.status(404).json({ error: 'Sim not found' });
  }
  const manifest = readJSON(manifestPath, null);
  if (!manifest) return res.status(500).json({ error: 'Invalid manifest' });
  res.json(manifest);
});

app.get('/api/sims/:id/artifacts/:file', (req, res) => {
  const filePath = path.join(paths.simDir(req.params.id), 'artifacts', req.params.file);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Artifact not found' });
  }
  res.type('text/plain').send(fs.readFileSync(filePath, 'utf8'));
});

app.get('/api/sessions', (req, res) => {
  try {
    const entries = fs.readdirSync(paths.SESSIONS_DIR, { withFileTypes: true });
    const sessions = entries
      .filter(e => e.isDirectory())
      .map(e => readJSON(path.join(paths.SESSIONS_DIR, e.name, 'session.json'), null))
      .filter(Boolean);
    res.json(sessions);
  } catch (err) {
    console.error(`GET /api/sessions: failed to read ${paths.SESSIONS_DIR}: ${err.message}`);
    res.json([]);
  }
});

app.get('/api/journal-summary', (req, res) => {
  // Try vault session notes first
  const vaultSessionsDir = path.join(paths.VAULT_DIR, 'sessions');
  try {
    const files = fs.readdirSync(vaultSessionsDir).filter(f => f.endsWith('.md')).sort().reverse().slice(0, 5);
    if (files.length > 0) {
      const parsed = files.map(f => {
        const content = fs.readFileSync(path.join(vaultSessionsDir, f), 'utf8');
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
        const meta = {};
        if (fmMatch) {
          for (const line of fmMatch[1].split('\n')) {
            const idx = line.indexOf(':');
            if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
          }
        }
        const body = fmMatch ? fmMatch[2] : content;
        const titleMatch = body.match(/^# (.+)/m);
        return {
          title: titleMatch ? titleMatch[1].trim() : f.replace('.md', ''),
          date: meta.date || '',
          takeaway: (body.match(/## Coaching Summary\n\n(.+)/m) || ['', ''])[1].trim().slice(0, 200)
        };
      });
      return res.json(parsed);
    }
  } catch {
    // vault may not exist yet
  }

  // Fall back to journal.md
  const journalPath = paths.JOURNAL;
  try {
    const content = fs.readFileSync(journalPath, 'utf8');
    if (!content.trim()) return res.json([]);

    const entries = content.split(/^## /m).filter(Boolean).slice(0, 5);
    const parsed = entries.map(entry => {
      const lines = entry.trim().split('\n');
      const title = lines[0] || '';
      const dateMatch = entry.match(/\*\*Date\*\*:\s*(.+)/i) || entry.match(/Date:\s*(.+)/i);
      const takeawayMatch = entry.match(/\*\*Key [Tt]akeaway\*\*:\s*(.+)/i) || entry.match(/Key [Tt]akeaway:\s*(.+)/i);
      return {
        title: title.trim(),
        date: dateMatch ? dateMatch[1].trim() : '',
        takeaway: takeawayMatch ? takeawayMatch[1].trim() : lines.slice(1).join(' ').trim().slice(0, 200)
      };
    });
    res.json(parsed);
  } catch (err) {
    console.error(`GET /api/journal-summary: failed to read: ${err.message}`);
    res.json([]);
  }
});

app.get('/api/ui-themes', (req, res) => {
  try {
    const files = fs.readdirSync(paths.UI_THEMES_DIR).filter(f => f.endsWith('.css'));
    const themes = files.map(f => f.replace('.css', ''));
    res.json(themes);
  } catch (err) {
    console.error(`GET /api/ui-themes: failed to read ${paths.UI_THEMES_DIR}: ${err.message}`);
    res.json([]);
  }
});

app.get('/api/progress', (req, res) => {
  const config = getConfig();
  const profile = readJSON(paths.PROFILE, {
    skill_polygon: {},
    completed_sims: []
  });

  const polygon = progression.initPolygon(profile.skill_polygon || {}, config);
  const rank = progression.currentRank(polygon, config);
  const normalized = progression.normalizePolygon(polygon, config);
  const axes = progression.axisNames(config);
  const axisLabels = {};
  for (const a of axes) {
    axisLabels[a] = config.axes[a].label;
  }

  // Find next rank (one tier above current)
  const rankIdx = config.ranks.findIndex(r => r.id === rank.id);
  const nextRank = rankIdx > 0 ? config.ranks[rankIdx - 1] : null;

  let servicesEncountered = [];
  try {
    const content = fs.readFileSync(paths.CATALOG, 'utf8');
    const catalog = parseCatalog(content);
    servicesEncountered = catalog.filter(s => s.sims_completed > 0).map(s => s.full_name);
  } catch {
    // catalog may not exist yet
  }

  // Build completed sim details with question types
  const completedSimIds = profile.completed_sims || [];
  const registry = readJSON(paths.REGISTRY, { sims: [] });
  const completedSims = completedSimIds.map(id => {
    const sim = (registry.sims || []).find(s => s.id === id);
    if (!sim) return { id, title: id, questionTypes: [] };
    const cat = (sim.category || '').toLowerCase();
    const questionTypes = config.category_map[cat] || ['gather'];
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
    polygonLastAdvanced: profile.polygon_last_advanced || {},
    rankHistory: profile.rank_history || [],
    challengeRuns: profile.challenge_runs || [],
    categoryMap: config.category_map,
    nextRank,
    assist: config.assist || {},
    simsCompleted: completedSimIds.length,
    completedSims,
    servicesEncountered,
    questionQuality: profile.question_quality || null,
    sessionsAtCurrentRank: profile.sessions_at_current_rank || 0,
    behavioralProfile: profile.behavioral_profile_summary || null
  });
});

// --- Game API endpoints (added in Step 5) ---

let claudeProcess;
let claudeSession;
let claudeStream;
try {
  claudeProcess = require('./lib/claude-process');
  claudeSession = require('./lib/claude-session');
  claudeStream = require('./lib/claude-stream');
} catch {
  // claude modules not yet created
}

app.post('/api/game/start', async (req, res) => {
  if (!claudeProcess) return res.status(503).json({ error: 'Game engine not available' });

  const { simId, themeId } = req.body;
  if (!simId) return res.status(400).json({ error: 'simId is required' });

  const registry = readJSON(paths.REGISTRY, { sims: [] });
  const simExists = registry.sims.some(s => s.id === simId);
  if (!simExists) return res.status(400).json({ error: 'Invalid simId' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    for await (const event of claudeStream.streamSession(simId, themeId || 'calm-mentor', {})) {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    }
    if (!res.writableEnded) res.end();
  } catch (err) {
    console.error(`POST /api/game/start: simId=${simId}, error=${err.message}`);
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      res.end();
    }
  }
});

app.post('/api/game/message', async (req, res) => {
  if (!claudeProcess) return res.status(503).json({ error: 'Game engine not available' });

  const { sessionId, message } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: 'Message is required' });

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
      if (event.type === 'done' && event.sessionComplete) {
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
        } catch (postErr) {
          console.error(`POST /api/game/message: post-session agent failed: ${postErr.message}`);
          res.write(`data: ${JSON.stringify({ type: 'profile_update_failed', message: postErr.message })}\n\n`);
        }
      }
    }

    if (!res.writableEnded) res.end();
  } catch (err) {
    console.error(`POST /api/game/message: sessionId=${sessionId}, error=${err.message}`);
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      res.end();
    }
  }
});

app.post('/api/game/quit', async (req, res) => {
  if (!claudeProcess) return res.status(503).json({ error: 'Game engine not available' });
  const { sessionId } = req.body;
  try {
    await claudeProcess.endSession(sessionId);
    res.json({ ok: true });
  } catch (err) {
    console.error(`POST /api/game/quit: sessionId=${sessionId}, error=${err.message}`);
    res.json({ ok: true });
  }
});

app.post('/api/game/resume', async (req, res) => {
  if (!claudeProcess) return res.status(503).json({ error: 'Game engine not available' });

  const { simId, themeId } = req.body;
  if (!simId) return res.status(400).json({ error: 'simId is required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    for await (const event of claudeStream.streamSession(simId, themeId || 'calm-mentor', {
      resume: true,
      resumeMessage: `Resume the in-progress session. Read learning/sessions/${simId}/session.json for session state.`
    })) {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    }
    if (!res.writableEnded) res.end();
  } catch (err) {
    console.error(`POST /api/game/resume: simId=${simId}, error=${err.message}`);
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      res.end();
    }
  }
});

// --- Server startup ---

function startServer(port) {
  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`AWS Incident Simulator running at http://127.0.0.1:${port}`);
  });

  server.on('error', (err) => {
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
if (claudeSession && claudeSession.recoverSessions) {
  claudeSession.recoverSessions();
}

// Create lock file to signal web app is running
const lockPath = path.join(paths.ROOT, 'learning', 'logs', '.web-active.lock');
fs.mkdirSync(path.dirname(lockPath), { recursive: true });
fs.writeFileSync(lockPath, JSON.stringify({
  pid: process.pid,
  port: 3200,
  startedAt: new Date().toISOString()
}));

function cleanupLock() {
  try { fs.unlinkSync(lockPath); } catch {}
}
process.on('SIGINT', () => { cleanupLock(); process.exit(); });
process.on('SIGTERM', () => { cleanupLock(); process.exit(); });
process.on('exit', cleanupLock);

const config = getConfig();
startServer(3200);

module.exports = app;
