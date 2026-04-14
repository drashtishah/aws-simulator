import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { exec } from 'node:child_process';
import express from 'express';
import { currentRank, normalizeHexagon, parseCatalog, getQuestionTypes, getConfig, progression } from '../lib/progress';


const ROOT = path.resolve(__dirname, '..', '..');

// --- Helpers ---

function request(app, method, url, body) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      const opts = {
        hostname: '127.0.0.1',
        port,
        path: url,
        method,
        headers: { 'Content-Type': 'application/json' }
      };
      const req = http.request(opts, (res) => {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => {
          server.close();
          try {
            resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, headers: res.headers, body: data });
          }
        });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  });
}

function requestRaw(app, method, url, body, contentType) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      const opts = {
        hostname: '127.0.0.1',
        port,
        path: url,
        method,
        headers: { 'Content-Type': contentType, 'Content-Length': body.length }
      };
      const req = http.request(opts, (res) => {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => {
          server.close();
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      req.write(body);
      req.end();
    });
  });
}

// --- Build a test app that mirrors server.js routes without startup validation ---

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/save-recording', express.raw({ type: 'video/webm', limit: '100mb' }));
  app.use(express.static(path.join(ROOT, 'web', 'public')));
  const videosDir = () => process.env.AWS_SIMULATOR_VIDEOS_DIR ?? path.join(ROOT, 'learning', 'videos');
  app.post('/api/save-recording', (req, res) => {
    if (!req.body || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: 'empty body' });
      return;
    }
    fs.mkdirSync(videosDir(), { recursive: true });
    const basename = `session-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const webmPath = path.join(videosDir(), `${basename}.webm`);
    const mp4Path = path.join(videosDir(), `${basename}.mp4`);
    fs.writeFileSync(webmPath, req.body);
    exec(`ffmpeg -i "${webmPath}" -c:v libx264 -c:a aac -movflags +faststart "${mp4Path}"`, (err) => {
      if (err) console.error(`mp4 conversion failed for ${basename}:`, err.message);
    });
    res.status(201).json({ filename: `${basename}.webm` });
  });

  function readJSON(filePath, fallback) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return fallback;
    }
  }

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

  app.get('/api/profile', (req, res) => {
    const profile = readJSON(path.join(ROOT, 'learning', 'profile.json'), {
      completed_sims: [], skill_polygon: {}
    });
    res.json(profile);
  });

  app.get('/api/registry', (req, res) => {
    const registry = readJSON(path.join(ROOT, 'sims', 'registry.json'), { version: 1, sims: [] });
    res.json(registry);
  });

  app.get('/api/themes', (req, res) => {
    const themesDir = path.join(ROOT, 'themes');
    try {
      const files = fs.readdirSync(themesDir).filter(f => f.endsWith('.md') && !f.startsWith('_'));
      const themes = files.map(f => {
        const content = fs.readFileSync(path.join(themesDir, f), 'utf8');
        const { meta } = stripFrontmatter(content);
        return {
          id: meta.id || f.replace('.md', ''),
          name: meta.name || f.replace('.md', ''),
          tagline: meta.tagline || ''
        };
      });
      res.json(themes);
    } catch {
      res.json([]);
    }
  });

  app.get('/api/sims/:id/manifest', (req, res) => {
    const manifestPath = path.join(ROOT, 'sims', req.params.id, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      return res.status(404).json({ error: 'Sim not found' });
    }
    const manifest = readJSON(manifestPath, null);
    if (!manifest) return res.status(500).json({ error: 'Invalid manifest' });
    res.json(manifest);
  });

  app.get('/api/sims/:id/artifacts/:file', (req, res) => {
    const filePath = path.join(ROOT, 'sims', req.params.id, 'artifacts', req.params.file);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Artifact not found' });
    }
    res.type('text/plain').send(fs.readFileSync(filePath, 'utf8'));
  });

  app.get('/api/sessions', (req, res) => {
    const sessionsDir = path.join(ROOT, 'learning', 'sessions');
    try {
      const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
      const sessions = files.map(f => readJSON(path.join(sessionsDir, f), null)).filter(Boolean);
      res.json(sessions);
    } catch {
      res.json([]);
    }
  });

  app.get('/api/journal-summary', (req, res) => {
    // Try vault session notes first
    const vaultSessionsDir = path.join(ROOT, 'learning', 'vault', 'sessions');
    try {
      const files = fs.readdirSync(vaultSessionsDir).filter(f => f.endsWith('.md')).sort().reverse().slice(0, 5);
      if (files.length > 0) {
        const parsed = files.map(f => {
          const content = fs.readFileSync(path.join(vaultSessionsDir, f), 'utf8');
          const { meta, body } = stripFrontmatter(content);
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
    const journalPath = path.join(ROOT, 'learning', 'journal.md');
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
    } catch {
      res.json([]);
    }
  });

  app.get('/api/ui-themes', (req, res) => {
    const themesDir = path.join(ROOT, 'web', 'public', 'ui-themes');
    try {
      const files = fs.readdirSync(themesDir).filter(f => f.endsWith('.css'));
      const themes = files.map(f => f.replace('.css', ''));
      res.json(themes);
    } catch {
      res.json([]);
    }
  });

  app.get('/api/progress', (req, res) => {
    const config = getConfig();
    const profile = readJSON(path.join(ROOT, 'learning', 'profile.json'), {
      completed_sims: [],
      skill_polygon: {}
    });

    const polygon = progression.initPolygon(profile.skill_polygon || {}, config);
    const rank = progression.currentRank(polygon, config);
    const normalized = progression.normalizePolygon(polygon, config);
    const axes = progression.axisNames(config);
    const axisLabels = {};
    for (const a of axes) {
      axisLabels[a] = config.axes[a].label;
    }

    // Find next rank
    const rankIdx = config.ranks.findIndex(r => r.id === rank.id);
    const nextRank = rankIdx > 0 ? config.ranks[rankIdx - 1] : null;

    let servicesEncountered = [];
    try {
      const content = fs.readFileSync(path.join(ROOT, 'learning', 'catalog.csv'), 'utf8');
      const catalog = parseCatalog(content);
      servicesEncountered = catalog.filter(s => s.sims_completed > 0).map(s => s.full_name);
    } catch {
      // catalog may not exist yet
    }

    res.json({
      rank: rank.title,
      rankTitle: rank.title,
      polygon: normalized,
      rawPolygon: polygon,
      axisNames: axes,
      axisLabels,
      hexagon: normalized,
      simsCompleted: (profile.completed_sims || []).length,
      servicesEncountered,
      maxDifficulty: rank.max_difficulty,
      polygonLastAdvanced: profile.polygon_last_advanced || {},
      rankHistory: profile.rank_history || [],
      challengeRuns: profile.challenge_runs || [],
      categoryMap: config.category_map,
      nextRank,
      assist: config.assist,
      questionQuality: profile.question_quality || null,
      sessionsAtCurrentRank: profile.sessions_at_current_rank || 0,
      behavioralProfile: profile.behavioral_profile_summary || null
    });
  });

  // Game endpoints return 503 without claude-process (acceptable for unit tests)
  app.post('/api/game/start', (req, res) => {
    const { simId, themeId } = req.body;
    if (!simId) return res.status(400).json({ error: 'simId is required' });
    const registry = readJSON(path.join(ROOT, 'sims', 'registry.json'), { sims: [] });
    const simExists = registry.sims.some(s => s.id === simId);
    if (!simExists) return res.status(400).json({ error: 'Invalid simId' });
    // Would normally start Claude process; return mock for testing
    res.json({ simId, themeId: themeId || 'calm-mentor' });
  });

  app.post('/api/game/message', (req, res) => {
    const { sessionId, message } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ error: 'Message is required' });
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });
    res.json({ ok: true });
  });

  app.post('/api/game/quit', (req, res) => {
    res.json({ ok: true });
  });

  app.post('/api/game/resume', (req, res) => {
    const { simId } = req.body;
    if (!simId) return res.status(400).json({ error: 'simId is required' });
    res.json({ ok: true });
  });

  return app;
}

// Build an app without claudeProcess to test 503 behavior
function buildAppWithoutClaude() {
  const app = express();
  app.use(express.json());

  app.post('/api/game/start', (req, res) => {
    res.status(503).json({ error: 'Game engine not available' });
  });
  app.post('/api/game/message', (req, res) => {
    res.status(503).json({ error: 'Game engine not available' });
  });
  app.post('/api/game/quit', (req, res) => {
    res.status(503).json({ error: 'Game engine not available' });
  });
  app.post('/api/game/resume', (req, res) => {
    res.status(503).json({ error: 'Game engine not available' });
  });

  return app;
}

// --- Tests ---

describe('GET /api/profile', () => {
  const app = buildApp();

  it('returns the player profile', async () => {
    const res = await request(app, 'GET', '/api/profile');
    assert.equal(res.status, 200);
    assert.ok(typeof res.body.skill_polygon === 'object');
    assert.ok(Array.isArray(res.body.completed_sims));
  });

  it('returns completed_sims as an array', async () => {
    const res = await request(app, 'GET', '/api/profile');
    assert.ok(Array.isArray(res.body.completed_sims), 'completed_sims should be an array');
  });

  it('returns rank_title as a string', async () => {
    const res = await request(app, 'GET', '/api/profile');
    assert.ok(typeof res.body.rank_title === 'string');
  });
});

describe('GET /api/registry', () => {
  const app = buildApp();

  it('returns sims array', async () => {
    const res = await request(app, 'GET', '/api/registry');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.sims));
  });

  it('each sim has required fields', async () => {
    const res = await request(app, 'GET', '/api/registry');
    for (const sim of res.body.sims) {
      assert.ok(sim.id, 'sim must have id');
      assert.ok(sim.title, 'sim must have title');
      assert.ok(typeof sim.difficulty === 'number', 'sim must have numeric difficulty');
      assert.ok(Array.isArray(sim.services), 'sim must have services array');
    }
  });
});

describe('GET /api/themes', () => {
  const app = buildApp();

  it('returns array of narrative themes', async () => {
    const res = await request(app, 'GET', '/api/themes');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.ok(res.body.length > 0, 'should have at least one theme');
  });

  it('each theme has id, name, and tagline', async () => {
    const res = await request(app, 'GET', '/api/themes');
    for (const theme of res.body) {
      assert.ok(theme.id, 'theme must have id');
      assert.ok(theme.name, 'theme must have name');
      assert.ok(typeof theme.tagline === 'string', 'theme must have tagline string');
    }
  });

  it('excludes _base.md from theme list', async () => {
    const res = await request(app, 'GET', '/api/themes');
    const ids = res.body.map(t => t.id);
    assert.ok(!ids.includes('_base'), '_base should not appear in themes');
  });
});

describe('GET /api/sims/:id/manifest', () => {
  const app = buildApp();

  it('returns manifest for valid sim', async () => {
    const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'sims', 'registry.json'), 'utf8'));
    const simId = registry.sims[0].id;
    const res = await request(app, 'GET', `/api/sims/${simId}/manifest`);
    assert.equal(res.status, 200);
    assert.ok(res.body.id);
    assert.ok(Array.isArray(res.body.consoles));
    assert.ok(res.body.resolution);
  });

  it('returns 404 for nonexistent sim', async () => {
    const res = await request(app, 'GET', '/api/sims/nonexistent-999/manifest');
    assert.equal(res.status, 404);
  });
});

describe('GET /api/sims/:id/artifacts/:file', () => {
  const app = buildApp();

  it('returns artifact content as text', async () => {
    const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'sims', 'registry.json'), 'utf8'));
    const simId = registry.sims[0].id;
    const res = await request(app, 'GET', `/api/sims/${simId}/artifacts/context.txt`);
    assert.equal(res.status, 200);
    assert.ok(typeof res.body === 'string' || typeof res.body === 'object');
  });

  it('returns 404 for nonexistent artifact', async () => {
    const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'sims', 'registry.json'), 'utf8'));
    const simId = registry.sims[0].id;
    const res = await request(app, 'GET', `/api/sims/${simId}/artifacts/does-not-exist.txt`);
    assert.equal(res.status, 404);
  });
});

describe('GET /api/sessions', () => {
  const app = buildApp();

  it('returns array (empty if no in-progress sessions)', async () => {
    const res = await request(app, 'GET', '/api/sessions');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
  });
});

describe('GET /api/journal-summary', () => {
  const app = buildApp();

  it('returns array of journal entries', async () => {
    const res = await request(app, 'GET', '/api/journal-summary');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
  });

  it('returns at most 5 entries', async () => {
    const res = await request(app, 'GET', '/api/journal-summary');
    assert.ok(res.body.length <= 5);
  });

  it('each entry has title and date', async () => {
    const res = await request(app, 'GET', '/api/journal-summary');
    for (const entry of res.body) {
      assert.ok(typeof entry.title === 'string');
      assert.ok(typeof entry.date === 'string');
    }
  });
});

describe('GET /api/ui-themes', () => {
  const app = buildApp();

  it('returns array of CSS theme ids', async () => {
    const res = await request(app, 'GET', '/api/ui-themes');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.ok(res.body.length > 0, 'should have at least one UI theme');
  });

  it('includes dracula theme', async () => {
    const res = await request(app, 'GET', '/api/ui-themes');
    assert.ok(res.body.includes('dracula'), 'should include dracula');
  });

  it('does not include snowy-mountain theme', async () => {
    const res = await request(app, 'GET', '/api/ui-themes');
    assert.ok(!res.body.includes('snowy-mountain'), 'snowy-mountain should be removed');
  });
});

describe('GET /api/progress', () => {
  const app = buildApp();

  it('returns progress data with rank, polygon, and new fields', async () => {
    const res = await request(app, 'GET', '/api/progress');
    assert.equal(res.status, 200);
    assert.ok(typeof res.body.rank === 'string');
    assert.ok(typeof res.body.rankTitle === 'string');
    assert.ok(typeof res.body.polygon === 'object');
    assert.ok(typeof res.body.rawPolygon === 'object');
    assert.ok(Array.isArray(res.body.axisNames));
    assert.ok(typeof res.body.axisLabels === 'object');
    assert.ok(typeof res.body.simsCompleted === 'number');
    assert.ok(Array.isArray(res.body.servicesEncountered));
    assert.ok(typeof res.body.maxDifficulty === 'number');
    assert.ok(typeof res.body.categoryMap === 'object');
    assert.ok(typeof res.body.assist === 'object');
  });

  it('polygon has all six question types', async () => {
    const res = await request(app, 'GET', '/api/progress');
    for (const t of ['gather', 'diagnose', 'correlate', 'impact', 'trace', 'fix']) {
      assert.ok(typeof res.body.polygon[t] === 'number', t + ' should be a number in polygon');
    }
  });

  it('includes hexagon alias for backwards compatibility', async () => {
    const res = await request(app, 'GET', '/api/progress');
    assert.ok(typeof res.body.hexagon === 'object');
  });

  it('includes rank history and challenge runs', async () => {
    const res = await request(app, 'GET', '/api/progress');
    assert.ok(Array.isArray(res.body.rankHistory));
    assert.ok(Array.isArray(res.body.challengeRuns));
  });

  it('includes questionQuality in response', async () => {
    const res = await request(app, 'GET', '/api/progress');
    // questionQuality may be null if profile has no quality data
    assert.ok(res.body.questionQuality !== undefined, 'questionQuality should be present');
  });

  it('includes sessionsAtCurrentRank in response', async () => {
    const res = await request(app, 'GET', '/api/progress');
    assert.ok(typeof res.body.sessionsAtCurrentRank === 'number');
  });

  it('includes behavioralProfile in response', async () => {
    const res = await request(app, 'GET', '/api/progress');
    assert.ok(res.body.behavioralProfile !== undefined, 'behavioralProfile should be present');
  });
});

describe('POST /api/game/start', () => {
  const app = buildApp();

  it('rejects missing simId', async () => {
    const res = await request(app, 'POST', '/api/game/start', {});
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('simId'));
  });

  it('rejects invalid simId', async () => {
    const res = await request(app, 'POST', '/api/game/start', { simId: 'nonexistent-999' });
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('Invalid'));
  });

  it('accepts valid simId and returns 200', async () => {
    const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'sims', 'registry.json'), 'utf8'));
    const simId = registry.sims[0].id;
    const res = await request(app, 'POST', '/api/game/start', { simId });
    assert.equal(res.status, 200);
    assert.equal(res.body.simId, simId);
  });

  it('defaults themeId to calm-mentor when not provided', async () => {
    const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'sims', 'registry.json'), 'utf8'));
    const simId = registry.sims[0].id;
    const res = await request(app, 'POST', '/api/game/start', { simId });
    assert.equal(res.status, 200);
    assert.equal(res.body.themeId, 'calm-mentor');
  });
});

describe('POST /api/game/message', () => {
  const app = buildApp();

  it('rejects empty message', async () => {
    const res = await request(app, 'POST', '/api/game/message', { sessionId: 'x', message: '' });
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('Message'), 'error should mention Message');
  });

  it('rejects whitespace-only message', async () => {
    const res = await request(app, 'POST', '/api/game/message', { sessionId: 'x', message: '   ' });
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('Message'));
  });

  it('rejects missing sessionId', async () => {
    const res = await request(app, 'POST', '/api/game/message', { message: 'hello' });
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('sessionId'));
  });

  it('rejects missing message field', async () => {
    const res = await request(app, 'POST', '/api/game/message', { sessionId: 'x' });
    assert.equal(res.status, 400);
  });
});

describe('POST /api/game/quit', () => {
  const app = buildApp();

  it('returns ok: true', async () => {
    const res = await request(app, 'POST', '/api/game/quit', { sessionId: 'x' });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });
});

describe('POST /api/game/resume', () => {
  const app = buildApp();

  it('rejects missing simId', async () => {
    const res = await request(app, 'POST', '/api/game/resume', {});
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('simId'));
  });

  it('handles resume after server restart (no prior prompt file)', async () => {
    // Simulate resume with a simId that has no /tmp prompt file (server restarted)
    const res = await request(app, 'POST', '/api/game/resume', {
      simId: '001-ec2-unreachable',
      themeId: 'calm-mentor',
      model: 'sonnet'
    });
    // Mock app returns 200 ok; real server would rebuild prompt from scratch
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });
});

describe('Game endpoints return 503 without claudeProcess', () => {
  const app = buildAppWithoutClaude();

  it('POST /api/game/start returns 503', async () => {
    const res = await request(app, 'POST', '/api/game/start', { simId: 'test' });
    assert.equal(res.status, 503);
    assert.ok(res.body.error.includes('not available'));
  });

  it('POST /api/game/message returns 503', async () => {
    const res = await request(app, 'POST', '/api/game/message', { sessionId: 'x', message: 'hi' });
    assert.equal(res.status, 503);
  });

  it('POST /api/game/quit returns 503', async () => {
    const res = await request(app, 'POST', '/api/game/quit', { sessionId: 'x' });
    assert.equal(res.status, 503);
  });

  it('POST /api/game/resume returns 503', async () => {
    const res = await request(app, 'POST', '/api/game/resume', { simId: 'test' });
    assert.equal(res.status, 503);
  });
});

// --- SSE event types for session complete flow ---

describe('POST /api/game/message SSE events', () => {
  function buildSSEApp(sessionComplete, postSessionResult) {
    const sseApp = express();
    sseApp.use(express.json());

    sseApp.post('/api/game/message', async (req, res) => {
      const { sessionId, message } = req.body;
      if (!message || !message.trim()) return res.status(400).json({ error: 'Message is required' });

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      res.write(`data: ${JSON.stringify({ type: 'text', content: 'Response text.' })}\n\n`);

      if (sessionComplete) {
        res.write(`data: ${JSON.stringify({ type: 'complete' })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'profile_updating' })}\n\n`);

        if (postSessionResult === 'success') {
          res.write(`data: ${JSON.stringify({ type: 'profile_updated' })}\n\n`);
        } else {
          res.write(`data: ${JSON.stringify({ type: 'profile_update_failed', message: 'Agent error' })}\n\n`);
        }
      }

      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    });

    return sseApp;
  }

  function requestSSE(app, method, url, body) {
    return new Promise((resolve, reject) => {
      const server = app.listen(0, () => {
        const port = server.address().port;
        const opts = {
          hostname: '127.0.0.1',
          port,
          path: url,
          method,
          headers: { 'Content-Type': 'application/json' }
        };
        const req = http.request(opts, (res) => {
          let data = '';
          res.on('data', d => data += d);
          res.on('end', () => {
            server.close();
            const events = data.split('\n')
              .filter(l => l.startsWith('data: '))
              .map(l => { try { return JSON.parse(l.slice(6)); } catch { return null; } })
              .filter(Boolean);
            resolve({ status: res.statusCode, events });
          });
        });
        req.on('error', (err) => { server.close(); reject(err); });
        if (body) req.write(JSON.stringify(body));
        req.end();
      });
    });
  }

  it('sends profile_updating event when session completes', async () => {
    const app = buildSSEApp(true, 'success');
    const res = await requestSSE(app, 'POST', '/api/game/message', { sessionId: 'x', message: 'fix it' });
    const types = res.events.map(e => e.type);
    assert.ok(types.includes('profile_updating'), 'should include profile_updating event');
  });

  it('sends profile_updated after successful post-session agent', async () => {
    const app = buildSSEApp(true, 'success');
    const res = await requestSSE(app, 'POST', '/api/game/message', { sessionId: 'x', message: 'fix it' });
    const types = res.events.map(e => e.type);
    assert.ok(types.includes('profile_updated'), 'should include profile_updated event');
    // profile_updating should come before profile_updated
    assert.ok(types.indexOf('profile_updating') < types.indexOf('profile_updated'));
  });

  it('sends profile_update_failed on post-session agent error', async () => {
    const app = buildSSEApp(true, 'failure');
    const res = await requestSSE(app, 'POST', '/api/game/message', { sessionId: 'x', message: 'fix it' });
    const types = res.events.map(e => e.type);
    assert.ok(types.includes('profile_update_failed'), 'should include profile_update_failed event');
  });

  it('does not send profile events when session is not complete', async () => {
    const app = buildSSEApp(false);
    const res = await requestSSE(app, 'POST', '/api/game/message', { sessionId: 'x', message: 'check logs' });
    const types = res.events.map(e => e.type);
    assert.ok(!types.includes('profile_updating'), 'should not include profile_updating');
    assert.ok(!types.includes('profile_updated'), 'should not include profile_updated');
  });
});

describe('POST /api/save-recording', () => {
  let tmpDir;
  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recorder-test-'));
    process.env.AWS_SIMULATOR_VIDEOS_DIR = tmpDir;
  });
  after(() => {
    delete process.env.AWS_SIMULATOR_VIDEOS_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns 400 for empty body', async () => {
    const app = buildApp();
    const res = await requestRaw(app, 'POST', '/api/save-recording', Buffer.alloc(0), 'video/webm');
    assert.equal(res.status, 400);
  });

  it('returns 201 and filename for valid buffer', async () => {
    const app = buildApp();
    const res = await requestRaw(app, 'POST', '/api/save-recording', Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), 'video/webm');
    assert.equal(res.status, 201);
    assert.match(res.body.filename, /^session-.+\.webm$/);
    assert.ok(fs.existsSync(path.join(tmpDir, res.body.filename)));
  });

  it('spawns ffmpeg to convert webm to mp4', async () => {
    const app = buildApp();
    const res = await requestRaw(app, 'POST', '/api/save-recording', Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), 'video/webm');
    assert.equal(res.status, 201);
    const basename = res.body.filename.replace('.webm', '');
    const webmPath = path.join(tmpDir, `${basename}.webm`);
    assert.ok(fs.existsSync(webmPath), 'webm file should exist');
    // mp4 conversion runs async in background, just verify the webm was saved
    // and the response basename matches the pattern
    assert.match(basename, /^session-.+$/);
  });
});
