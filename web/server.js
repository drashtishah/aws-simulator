const express = require('express');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const paths = require('./lib/paths');

const app = express();

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

// --- Helper: parse YAML frontmatter ---

function stripFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };
  const meta = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      let val = line.slice(idx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      meta[key] = val;
    }
  }
  return { meta, body: match[2] };
}

// --- Data API endpoints ---

app.get('/api/profile', (req, res) => {
  const profile = readJSON(paths.PROFILE, {
    current_level: 1,
    strengths: [],
    weaknesses: []
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
    const files = fs.readdirSync(paths.SESSIONS_DIR).filter(f => f.endsWith('.json'));
    const sessions = files.map(f => readJSON(path.join(paths.SESSIONS_DIR, f), null)).filter(Boolean);
    res.json(sessions);
  } catch (err) {
    console.error(`GET /api/sessions: failed to read ${paths.SESSIONS_DIR}: ${err.message}`);
    res.json([]);
  }
});

app.get('/api/journal-summary', (req, res) => {
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
    console.error(`GET /api/journal-summary: failed to read ${journalPath}: ${err.message}`);
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

// --- Game API endpoints (added in Step 5) ---

let claudeProcess;
try {
  claudeProcess = require('./lib/claude-process');
} catch {
  // claude-process.js not yet created
}

app.post('/api/game/start', async (req, res) => {
  if (!claudeProcess) return res.status(503).json({ error: 'Game engine not available' });

  const { simId, themeId, model } = req.body;
  if (!simId) return res.status(400).json({ error: 'simId is required' });

  const registry = readJSON(paths.REGISTRY, { sims: [] });
  const simExists = registry.sims.some(s => s.id === simId);
  if (!simExists) return res.status(400).json({ error: 'Invalid simId' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const result = await claudeProcess.startSession(simId, themeId || 'still-life', { model: model || 'sonnet' });
    res.write(`data: ${JSON.stringify({ type: 'session', sessionId: result.sessionId })}\n\n`);

    for (const event of result.events) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (err) {
    console.error(`POST /api/game/start: simId=${simId}, error=${err.message}`);
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    res.end();
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
    const result = await claudeProcess.sendMessage(sessionId, msg);

    if (truncated) {
      res.write(`data: ${JSON.stringify({ type: 'warning', message: 'Message truncated to 2000 characters.' })}\n\n`);
    }

    for (const event of result.events) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    if (result.sessionComplete) {
      res.write(`data: ${JSON.stringify({ type: 'complete' })}\n\n`);
    }

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (err) {
    console.error(`POST /api/game/message: sessionId=${sessionId}, error=${err.message}`);
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    res.end();
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

  const { simId, themeId, model } = req.body;
  if (!simId) return res.status(400).json({ error: 'simId is required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const result = await claudeProcess.startSession(simId, themeId || 'still-life', {
      model: model || 'sonnet',
      resume: true,
      resumeMessage: `Resume the in-progress session. Read learning/sessions/${simId}.json for session state.`
    });
    res.write(`data: ${JSON.stringify({ type: 'session', sessionId: result.sessionId })}\n\n`);

    for (const event of result.events) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (err) {
    console.error(`POST /api/game/resume: simId=${simId}, error=${err.message}`);
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    res.end();
  }
});

// --- Server startup ---

function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`AWS Incident Simulator running at http://localhost:${port}`);
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
startServer(3200);

module.exports = app;
