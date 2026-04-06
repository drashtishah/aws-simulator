import path from 'node:path';

const ROOT: string = path.resolve(__dirname, '..', '..');

const SIMS_DIR: string = path.join(ROOT, 'sims');
const THEMES_DIR: string = path.join(ROOT, 'themes');
const LEARNING_DIR: string = path.join(ROOT, 'learning');
const SESSIONS_DIR: string = path.join(LEARNING_DIR, 'sessions');
const LOGS_DIR: string = path.join(LEARNING_DIR, 'logs');
const VAULT_DIR: string = path.join(LEARNING_DIR, 'vault');
const UI_THEMES_DIR: string = path.join(ROOT, 'web', 'public', 'ui-themes');
const PUBLIC_DIR: string = path.join(ROOT, 'web', 'public');

const REGISTRY: string = path.join(SIMS_DIR, 'registry.json');
const PROFILE: string = path.join(LEARNING_DIR, 'profile.json');
const JOURNAL: string = path.join(LEARNING_DIR, 'journal.md');
const LOG_FILE: string = path.join(LOGS_DIR, 'activity.jsonl');
const SYSTEM_LOG_FILE: string = path.join(LOGS_DIR, 'system.jsonl');
const HEALTH_SCORES_FILE: string = path.join(LOGS_DIR, 'health-scores.jsonl');
const CATALOG: string = path.join(LEARNING_DIR, 'catalog.csv');
const THEME_BASE: string = path.join(THEMES_DIR, '_base.md');
const AGENT_PROMPTS: string = path.join(ROOT, '.claude', 'skills', 'play', 'references', 'agent-prompts.md');

const simDir = (id: string): string => path.join(SIMS_DIR, id);
const manifest = (id: string): string => path.join(SIMS_DIR, id, 'manifest.json');
const story = (id: string): string => path.join(SIMS_DIR, id, 'story.md');
const theme = (id: string): string => path.join(THEMES_DIR, `${id}.md`);
const sessionFile = (id: string): string => path.join(SESSIONS_DIR, id, 'session.json');
const transcriptFile = (id: string): string => path.join(SESSIONS_DIR, id, 'transcript.jsonl');
const turnsFile = (id: string): string => path.join(SESSIONS_DIR, id, 'turns.jsonl');
const sessionDir = (id: string): string => path.join(SESSIONS_DIR, id);

const paths = {
  ROOT,
  SIMS_DIR,
  THEMES_DIR,
  LEARNING_DIR,
  SESSIONS_DIR,
  LOGS_DIR,
  VAULT_DIR,
  UI_THEMES_DIR,
  PUBLIC_DIR,
  REGISTRY,
  PROFILE,
  JOURNAL,
  LOG_FILE,
  SYSTEM_LOG_FILE,
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
  turnsFile,
  sessionDir,
};

export = paths;
