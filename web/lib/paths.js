const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

// Directories
const SIMS_DIR = path.join(ROOT, 'sims');
const THEMES_DIR = path.join(ROOT, 'themes');
const LEARNING_DIR = path.join(ROOT, 'learning');
const SESSIONS_DIR = path.join(LEARNING_DIR, 'sessions');
const LOGS_DIR = path.join(LEARNING_DIR, 'logs');
const UI_THEMES_DIR = path.join(ROOT, 'web', 'public', 'ui-themes');
const PUBLIC_DIR = path.join(ROOT, 'web', 'public');

// Static files
const REGISTRY = path.join(SIMS_DIR, 'registry.json');
const PROFILE = path.join(LEARNING_DIR, 'profile.json');
const JOURNAL = path.join(LEARNING_DIR, 'journal.md');
const LOG_FILE = path.join(LOGS_DIR, 'activity.jsonl');
const HEALTH_SCORES_FILE = path.join(LOGS_DIR, 'health-scores.jsonl');
const CATALOG = path.join(LEARNING_DIR, 'catalog.csv');
const THEME_BASE = path.join(THEMES_DIR, '_base.md');
const AGENT_PROMPTS = path.join(ROOT, '.claude', 'skills', 'play', 'references', 'agent-prompts.md');

// Dynamic path helpers
const simDir = (id) => path.join(SIMS_DIR, id);
const manifest = (id) => path.join(SIMS_DIR, id, 'manifest.json');
const story = (id) => path.join(SIMS_DIR, id, 'story.md');
const theme = (id) => path.join(THEMES_DIR, `${id}.md`);
const sessionFile = (id) => path.join(SESSIONS_DIR, id, 'session.json');
const transcriptFile = (id) => path.join(SESSIONS_DIR, id, 'transcript.jsonl');
const sessionDir = (id) => path.join(SESSIONS_DIR, id);

module.exports = {
  ROOT,
  SIMS_DIR,
  THEMES_DIR,
  LEARNING_DIR,
  SESSIONS_DIR,
  LOGS_DIR,
  UI_THEMES_DIR,
  PUBLIC_DIR,
  REGISTRY,
  PROFILE,
  JOURNAL,
  LOG_FILE,
  HEALTH_SCORES_FILE,
  CATALOG,
  THEME_BASE,
  AGENT_PROMPTS,
  simDir,
  manifest,
  story,
  theme,
  sessionFile,
  transcriptFile,
  sessionDir
};
