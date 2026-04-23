#!/usr/bin/env npx ts-node
// eval-runner.ts: Scorecard engine for eval checks.
// Loads eval-scoring.yaml, runs deterministic checks against session/transcript data,
// returns pending_llm for LLM checks.

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { parseClassificationJsonl, ClassificationRow } from '../web/lib/classification-schema';

const ROOT: string = path.resolve(__dirname, '..');
const SESSIONS_DIR: string = path.join(ROOT, 'learning', 'sessions');
const RESULTS_DIR: string = path.join(ROOT, 'learning', 'logs', 'eval-results');
const HISTORY_PATH: string = path.join(ROOT, 'learning', 'logs', 'eval-history.jsonl');
const SIMS_DIR: string = path.join(ROOT, 'sims');
const SPEC_PATH: string = path.join(ROOT, 'references', 'config', 'eval-scoring.yaml');

interface ScoringSpec {
  categories: Record<string, Check[]>;
}

interface Check {
  id: string;
  rule: string;
  requires: string;
  category?: string;
  target?: string;
  field?: string;
  axes?: string[];
  value?: string;
  patterns?: string[];
  prompt?: string;
}

interface RuleResult {
  pass: boolean;
  reason?: string;
}

interface CheckResult {
  id: string;
  status: string;
  score?: number;
  reason?: string;
  prompt?: string;
}

interface ScorecardSummary {
  passed: number;
  failed: number;
  skipped: number;
  pending_llm: number;
  errors: number;
  total: number;
}

interface ScorecardResult {
  sim_id?: string;
  timestamp?: string;
  summary?: ScorecardSummary;
  results?: CheckResult[];
  error?: string;
}

interface Session {
  status?: string;
  scoring?: Record<string, number>;
  services_queried?: string[];
  total_questions?: number;
  last_active?: string;
  story_beats_fired?: string[];
  criteria_met?: string[];
  criteria_remaining?: string[];
  debrief_zones_explored?: string[];
  debrief_questions_asked?: number;
  [key: string]: unknown;
}

interface TurnEntry {
  ts: string;
  turn: number;
  player_message: string;
  assistant_message: string;
  usage?: unknown;
  [key: string]: unknown;
}

interface Manifest {
  services?: string[];
  resolution?: {
    root_cause?: string;
    fix_criteria?: Array<{ id: string }>;
  };
  team?: {
    narrator?: {
      system_narration?: {
        what_broke?: string;
      };
    };
  };
  [key: string]: unknown;
}

type SessionRuleFn = (session: Session, manifest: Manifest | null, check: Check) => RuleResult;
type TranscriptRuleFn = (transcript: TurnEntry[], manifest: Manifest | null, check: Check, session?: Session | null) => RuleResult;
type ClassificationRuleFn = (rows: ClassificationRow[], turns: TurnEntry[], manifest: Manifest | null, check: Check) => RuleResult;

function loadScoringSpec(): ScoringSpec {
  return yaml.load(fs.readFileSync(SPEC_PATH, 'utf8')) as ScoringSpec;
}

function allChecks(spec: ScoringSpec): Check[] {
  const flat: Check[] = [];
  for (const [category, checks] of Object.entries(spec.categories)) {
    for (const check of checks) flat.push({ ...check, category });
  }
  return flat;
}

function loadSession(simId: string): Session | null {
  const p: string = path.join(SESSIONS_DIR, simId, 'session.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8')) as Session;
}

function loadTurns(simId: string): TurnEntry[] | null {
  const p: string = path.join(SESSIONS_DIR, simId, 'turns.jsonl');
  if (!fs.existsSync(p)) return null;
  const lines: string[] = fs.readFileSync(p, 'utf8').trim().split('\n');
  return lines.filter(l => l.trim()).map(l => JSON.parse(l) as TurnEntry);
}

function loadClassification(simId: string): ClassificationRow[] | null {
  const p: string = path.join(SESSIONS_DIR, simId, 'classification.jsonl');
  if (!fs.existsSync(p)) return null;
  return parseClassificationJsonl(fs.readFileSync(p, 'utf8'));
}

function loadManifest(simId: string): Manifest | null {
  const simPrefix: string = simId.split('_')[0] ?? simId;
  const dirs: string[] = fs.existsSync(SIMS_DIR) ? fs.readdirSync(SIMS_DIR) : [];
  const simDir: string | undefined = dirs.find(d => d.startsWith(simPrefix));
  if (!simDir) return null;
  const p: string = path.join(SIMS_DIR, simDir, 'manifest.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8')) as Manifest;
}

function listCompletedSessions(): string[] {
  if (!fs.existsSync(SESSIONS_DIR)) return [];
  const completed: string[] = [];
  for (const dir of fs.readdirSync(SESSIONS_DIR)) {
    const p: string = path.join(SESSIONS_DIR, dir, 'session.json');
    if (!fs.existsSync(p)) continue;
    try {
      const s: Session = JSON.parse(fs.readFileSync(p, 'utf8')) as Session;
      if (s.status === 'completed') completed.push(dir);
    } catch (_e: unknown) { /* skip malformed */ }
  }
  return completed;
}

function extractField(transcript: TurnEntry[] | null, target: string): string {
  if (!transcript) return '';
  const fieldMap: Record<string, string> = {
    'narrator_text': 'assistant_message', 'transcript.narrator': 'assistant_message',
    'narrator': 'assistant_message',
    'player': 'player_message'
  };
  const field: string = fieldMap[target] ?? target;
  return transcript.map(t => (t[field] as string) ?? '').filter(Boolean).join('\n');
}

// Session rules: each returns { pass, reason? }
const sessionRules: Record<string, SessionRuleFn> = {
  all_values_lte_2(session: Session): RuleResult {
    const scoring: Record<string, number> = session.scoring ?? {};
    for (const [k, v] of Object.entries(scoring)) {
      if (k === 'total') continue;
      if (v > 2) return { pass: false, reason: k + ' is ' + v + ', exceeds 2' };
    }
    return { pass: true };
  },
  unqueried_services_zero(session: Session, manifest: Manifest | null): RuleResult {
    const scoring: Record<string, number> = session.scoring ?? {};
    const queried: string[] = session.services_queried ?? [];
    const services: string[] = manifest?.services ?? Object.keys(scoring).filter(k => k !== 'total');
    for (const svc of services) {
      if (!queried.includes(svc) && (scoring[svc] ?? 0) !== 0)
        return { pass: false, reason: svc + ' not queried but has score ' + scoring[svc] };
    }
    return { pass: true };
  },
  total_equals_sum(session: Session): RuleResult {
    const scoring: Record<string, number> = session.scoring ?? {};
    const total: number = scoring.total ?? 0;
    const sum: number = Object.entries(scoring).filter(([k]) => k !== 'total').reduce((s, [, v]) => s + v, 0);
    if (total !== sum) return { pass: false, reason: 'total ' + total + ' != sum ' + sum };
    return { pass: true };
  },
  all_values_gte_0(session: Session): RuleResult {
    for (const [k, v] of Object.entries(session.scoring ?? {})) {
      if (v < 0) return { pass: false, reason: k + ' is negative' };
    }
    return { pass: true };
  },
  field_exists(session: Session, _manifest: Manifest | null, check: Check): RuleResult {
    if (session[check.field!] === undefined) return { pass: false, reason: 'field ' + check.field + ' missing' };
    return { pass: true };
  },
  last_active_recent(session: Session): RuleResult {
    if (!session.last_active) return { pass: false, reason: 'last_active missing' };
    if (isNaN(new Date(session.last_active).getTime())) return { pass: false, reason: 'last_active not valid ISO date' };
    return { pass: true };
  },
  is_array(session: Session, _manifest: Manifest | null, check: Check): RuleResult {
    if (!Array.isArray(session[check.field!])) return { pass: false, reason: check.field + ' is not an array' };
    return { pass: true };
  },
  array_contains(session: Session, _manifest: Manifest | null, check: Check): RuleResult {
    const arr = (session[check.target!] as string[] | undefined) ?? session.story_beats_fired ?? [];
    if (!Array.isArray(arr)) return { pass: false, reason: check.target + ' is not an array' };
    if (!arr.includes(check.value!)) return { pass: false, reason: check.target + ' missing ' + check.value };
    return { pass: true };
  },
  criteria_met_subset_of_manifest(session: Session, manifest: Manifest | null): RuleResult {
    if (!manifest?.resolution?.fix_criteria) return { pass: true };
    const validIds: string[] = manifest.resolution.fix_criteria.map(c => c.id);
    for (const id of (session.criteria_met ?? [])) {
      if (!validIds.includes(id)) return { pass: false, reason: id + ' not in manifest criteria' };
    }
    return { pass: true };
  },
  criteria_sets_cover_manifest(session: Session, manifest: Manifest | null): RuleResult {
    if (!manifest?.resolution?.fix_criteria) return { pass: true };
    const covered: Set<string> = new Set([...(session.criteria_met ?? []), ...(session.criteria_remaining ?? [])]);
    for (const c of manifest.resolution.fix_criteria) {
      if (!covered.has(c.id)) return { pass: false, reason: c.id + ' not covered by met or remaining' };
    }
    return { pass: true };
  },
  debrief_covers_zones(session: Session): RuleResult {
    const zones = session.debrief_zones_explored;
    if (zones != null && Array.isArray(zones) && zones.length === 0 && (session.debrief_questions_asked ?? 0) > 0)
      return { pass: false, reason: 'debrief happened but no zones explored' };
    return { pass: true };
  },
  // TODO: refine with real play data
  depth_score_correlates_with_exploration(): RuleResult { return { pass: true }; }
};

// Transcript rules: each returns { pass, reason? }
const transcriptRules: Record<string, TranscriptRuleFn> = {
  not_contains_any(transcript: TurnEntry[], _manifest: Manifest | null, check: Check): RuleResult {
    const text: string = extractField(transcript, check.target!).toLowerCase();
    for (const p of (check.patterns ?? [])) {
      if (text.includes(p.toLowerCase())) return { pass: false, reason: 'found forbidden phrase: ' + p };
    }
    return { pass: true };
  },
  not_contains_manifest_field(transcript: TurnEntry[], manifest: Manifest | null, check: Check): RuleResult {
    const narText: string = extractField(transcript, 'assistant_message').toLowerCase();
    let values: string[] = [];
    if (check.field === 'root_cause' && manifest?.resolution?.root_cause)
      values.push(manifest.resolution.root_cause);
    else if (check.field === 'what_broke' && (manifest as { system?: { what_broke?: string } } | null)?.system?.what_broke)
      values.push((manifest as { system: { what_broke: string } }).system.what_broke);
    else if (check.field === 'criteria_ids' && manifest?.resolution?.fix_criteria)
      values = manifest.resolution.fix_criteria.map(c => c.id);
    else if (check.field === 'service_weights')
      return { pass: true };
    for (const v of values) {
      if (v && narText.includes(v.toLowerCase())) return { pass: false, reason: 'narrator leaked ' + check.field + ' value' };
    }
    return { pass: true };
  },
  no_emojis(transcript: TurnEntry[]): RuleResult {
    const narText: string = extractField(transcript, 'assistant_message');
    const emojiPattern: RegExp = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}]/u;
    if (emojiPattern.test(narText)) return { pass: false, reason: 'emoji found in narrator text' };
    return { pass: true };
  },
  // TODO: all stubs below pass by default, refine with real play data
  console_markers_wellformed(): RuleResult { return { pass: true }; },
  coaching_follows_unproductive(): RuleResult { return { pass: true }; },
  coaching_refs_correct_service(): RuleResult { return { pass: true }; },
  no_coaching_on_productive(): RuleResult { return { pass: true }; },
  hints_in_order(): RuleResult { return { pass: true }; },
  hints_skip_queried_services(): RuleResult { return { pass: true }; },
  max_one_hint_per_turn(): RuleResult { return { pass: true }; },
  hint_refs_relevant_service(): RuleResult { return { pass: true }; },
  no_hints_before_turn_3(): RuleResult { return { pass: true }; },
  debrief_follows_investigation(): RuleResult { return { pass: true }; },
  debrief_has_seed_questions(): RuleResult { return { pass: true }; }
};

// Keyword table for classification axes. Sourced from
// .claude/skills/play/references/coaching-patterns.md (classification rubric).
// Loose gross-mismatch check, not tight alignment.
const CLASSIFICATION_KEYWORDS: Record<string, string[]> = {
  gather: ['show me', 'what is the', 'what is', 'list', 'describe', 'get', 'which', 'what'],
  diagnose: ['why', 'what caused', "what's wrong", 'explain the error', 'cause', 'reason', 'explain', 'diagnose', 'investigate', 'check'],
  correlate: ['related to', 'connected', 'at the same time', 'both', 'between', 'related', 'link', 'correlate', 'compare', 'difference', 'versus', ' vs '],
  impact: ["who's affected", 'blast radius', 'how many users', 'production', 'impact', 'affect', 'downstream', 'users', 'customers', 'availability'],
  trace: ['what changed', 'who deployed', 'cloudtrail', 'when did', 'recent', 'trace', 'log', 'history', 'timeline', 'when', 'sequence', 'path', 'flow'],
  fix: ['fix', 'solve', 'resolve', 'apply', 'update', 'change', 'run', 'deploy', 'rotate', 'add rule', 'increase', 'should', 'we should']
};

const classificationRules: Record<string, ClassificationRuleFn> = {
  classification_matches_keywords(rows: ClassificationRow[], turns: TurnEntry[]): RuleResult {
    for (const row of rows) {
      const turn = turns[row.index - 1];
      if (!turn) continue;
      const msg = (turn.player_message ?? '').toLowerCase();
      const keywords = CLASSIFICATION_KEYWORDS[row.question_type] ?? [];
      const matched = keywords.some(k => msg.includes(k));
      if (!matched) {
        return {
          pass: false,
          reason: 'row ' + row.index + ' question_type ' + row.question_type + ' does not match any keyword in player message'
        };
      }
    }
    return { pass: true };
  }
};

function runCheck(check: Check, session: Session | null, transcript: TurnEntry[] | null, manifest: Manifest | null, classification: ClassificationRow[] | null = null): CheckResult {
  const id: string = check.id;
  if (check.requires === 'llm') return { id, status: 'pending_llm', prompt: check.prompt };
  if (check.requires === 'transcript' && !transcript) return { id, status: 'skipped', reason: 'no transcript' };
  if (check.requires === 'session' && !session) return { id, status: 'skipped', reason: 'no session' };
  if (check.requires === 'classification' && !classification) return { id, status: 'skipped', reason: 'no classification' };

  if (check.requires === 'classification') {
    const ruleFn = classificationRules[check.rule];
    if (!ruleFn) return { id, status: 'error', reason: 'unknown rule' };
    const result: RuleResult = ruleFn(classification!, transcript ?? [], manifest, check);
    return { id, status: result.pass ? 'pass' : 'fail', score: result.pass ? 1 : 0, reason: result.reason ?? undefined };
  }

  const ruleFn = check.requires === 'session'
    ? sessionRules[check.rule]
    : transcriptRules[check.rule];
  if (!ruleFn) return { id, status: 'error', reason: 'unknown rule' };

  const data = check.requires === 'session' ? session : transcript;
  const result: RuleResult = (ruleFn as (data: unknown, manifest: Manifest | null, check: Check, session?: Session | null) => RuleResult)(data, manifest, check, session);
  return { id, status: result.pass ? 'pass' : 'fail', score: result.pass ? 1 : 0, reason: result.reason ?? undefined };
}

function runScorecard(simId: string): ScorecardResult {
  const session: Session | null = loadSession(simId);
  if (!session) return { error: 'Session not found for ' + simId };
  const transcript: TurnEntry[] | null = loadTurns(simId);
  const manifest: Manifest | null = loadManifest(simId);
  const classification: ClassificationRow[] | null = loadClassification(simId);
  const checks: Check[] = allChecks(loadScoringSpec());
  const results: CheckResult[] = checks.map(c => runCheck(c, session, transcript, manifest, classification));
  const count = (status: string): number => results.filter(r => r.status === status).length;
  return {
    sim_id: simId,
    timestamp: new Date().toISOString(),
    summary: { passed: count('pass'), failed: count('fail'), skipped: count('skipped'), pending_llm: count('pending_llm'), errors: count('error'), total: checks.length },
    results
  };
}

function writeResult(simId: string, result: ScorecardResult): string {
  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const ts: string = new Date().toISOString().replace(/[:.]/g, '-');
  const filepath: string = path.join(RESULTS_DIR, simId + '-' + ts + '.json');
  fs.writeFileSync(filepath, JSON.stringify(result, null, 2) + '\n');
  return filepath;
}

function appendHistory(entry: Record<string, unknown>): void {
  const dir: string = path.dirname(HISTORY_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(HISTORY_PATH, JSON.stringify(entry) + '\n');
}

export {
  loadScoringSpec, allChecks, runCheck, runScorecard,
  writeResult, appendHistory, listCompletedSessions,
  loadSession, loadTurns, loadManifest, loadClassification,
  classificationRules,
  SESSIONS_DIR, RESULTS_DIR
};
