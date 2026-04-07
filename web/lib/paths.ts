import path from 'node:path';

const ROOT: string = path.resolve(__dirname, '..', '..');

const SIMS_DIR: string = path.join(ROOT, 'sims');
const THEMES_DIR: string = path.join(ROOT, 'themes');
const LEARNING_DIR: string = path.join(ROOT, 'learning');
// PR-A.4.1: tests can stub the sessions dir via this env var so they no
// longer leak `learning/sessions/<simId>/` directories back into the worktree.
const SESSIONS_DIR: string = process.env.AWS_SIMULATOR_SESSIONS_DIR ?? path.join(LEARNING_DIR, 'sessions');
const LOGS_DIR: string = path.join(LEARNING_DIR, 'logs');
const VAULT_DIR: string = path.join(LEARNING_DIR, 'vault');
const UI_THEMES_DIR: string = path.join(ROOT, 'web', 'public', 'ui-themes');
const PUBLIC_DIR: string = path.join(ROOT, 'web', 'public');

const REGISTRY: string = path.join(SIMS_DIR, 'registry.json');
const PROFILE: string = path.join(LEARNING_DIR, 'profile.json');
const JOURNAL: string = path.join(LEARNING_DIR, 'journal.md');
// PR-B: activity.jsonl + system.jsonl unified into raw.jsonl. The legacy
// constants alias to the new file so any consumer that still imports them
// continues to work without code changes; new code should import RAW_LOG_FILE.
const RAW_LOG_FILE: string = path.join(LOGS_DIR, 'raw.jsonl');
const LOG_FILE: string = RAW_LOG_FILE;
const SYSTEM_LOG_FILE: string = RAW_LOG_FILE;
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
  RAW_LOG_FILE,
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
