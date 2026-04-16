import fs from 'node:fs';
import path from 'node:path';
import jsYaml from 'js-yaml';
import type { ClassificationRow } from './classification-schema.js';
import {
  renderSessionNote,
  renderServicePage,
  renderConceptPage,
  updateRankNote,
} from './vault-templates.js';
import type { SessionNoteCtx, FixCriterion } from './vault-templates.js';
import { aggregateServiceStats, aggregateConceptStats, loadSessions } from './vault-aggregation.js';
import { updateRunningAverage } from './question-quality.js';
import type { QuestionQuality } from './question-quality.js';
import * as paths from './paths.js';

const EMPTY_QUESTION_QUALITY: QuestionQuality = {
  avg_specificity: 0,
  avg_relevance: 0,
  avg_building: 0,
  avg_targeting: 0,
  avg_overall: 0,
  total_questions_scored: 0,
  last_5_session_avgs: [],
};

// --- Types for external data ---

export interface SkillPolygon {
  gather: number;
  diagnose: number;
  correlate: number;
  impact: number;
  trace: number;
  fix: number;
  [key: string]: number;
}

export interface PlayerProfile {
  rank: string;
  rank_title?: string;
  completed_sims: string[];
  skill_polygon: SkillPolygon;
  total_sessions: number;
  sessions_at_current_rank: number;
  avg_question_quality: number;
  question_quality?: QuestionQuality;
  [key: string]: unknown;
}

interface ProgressionScoring {
  base_points: number;
  ramp_interval: number;
  min_multiplier: number;
  quality_weight: number;
  quality_threshold: number;
}

interface ProgressionRankGate {
  all_axes_min?: number;
  axes_min?: Record<string, number>;
  count_axes_above?: { min: number; count: number };
}

interface ProgressionRank {
  id: string;
  title: string;
  gate: ProgressionRankGate;
  quality_gate?: { avg_question_quality: number; min_sessions_at_rank: number };
}

export interface Progression {
  scoring: ProgressionScoring;
  ranks: ProgressionRank[];
  [key: string]: unknown;
}

// --- Public API ---

type QualityProfile = {
  question_quality?: { avg_overall?: number };
  sessions_at_current_rank?: number;
};

/**
 * Derives the rank id from a polygon and progression config.
 * Checks polygon gates and, when a profile is supplied, rank.quality_gate
 * against profile.question_quality.avg_overall and profile.sessions_at_current_rank.
 * Returns the id of the first rank whose gates are satisfied (top-down).
 */
export function deriveRank(
  polygon: SkillPolygon,
  progression: Progression,
  profile?: QualityProfile
): string {
  const axisValues = Object.values(polygon);
  for (const rank of progression.ranks) {
    if (!gateMatches(polygon, axisValues, rank.gate)) continue;
    if (profile && !qualityGateMatches(profile, rank.quality_gate)) continue;
    return rank.id;
  }
  return 'responder';
}

function gateMatches(polygon: SkillPolygon, axisValues: number[], gate: ProgressionRankGate): boolean {
  if (gate.all_axes_min !== undefined) {
    if (!axisValues.every(v => v >= gate.all_axes_min!)) return false;
  }
  if (gate.axes_min) {
    for (const [axis, min] of Object.entries(gate.axes_min)) {
      if ((polygon[axis] ?? 0) < min) return false;
    }
  }
  if (gate.count_axes_above) {
    const { min, count } = gate.count_axes_above;
    const qualifying = axisValues.filter(v => v >= min).length;
    if (qualifying < count) return false;
  }
  return true;
}

function qualityGateMatches(
  profile: QualityProfile,
  qualityGate: ProgressionRank['quality_gate']
): boolean {
  if (!qualityGate) return true;
  const avgQuality = profile.question_quality?.avg_overall ?? 0;
  const sessionsAtRank = profile.sessions_at_current_rank ?? 0;
  if (avgQuality < qualityGate.avg_question_quality) return false;
  if (sessionsAtRank < qualityGate.min_sessions_at_rank) return false;
  return true;
}

/**
 * Updates a player profile from a set of classification rows.
 * Pure and idempotent: calling twice with the same simId leaves
 * completed_sims and total_sessions unchanged on the second call.
 */
export function updateProfileFromClassification(
  profile: PlayerProfile,
  rows: ClassificationRow[],
  simId: string,
  progression: Progression
): PlayerProfile {
  const alreadyCompleted = profile.completed_sims.includes(simId);
  if (alreadyCompleted) {
    return profile;
  }

  const updated: PlayerProfile = {
    ...profile,
    skill_polygon: { ...profile.skill_polygon },
    completed_sims: [...profile.completed_sims, simId],
    total_sessions: profile.total_sessions + 1,
    sessions_at_current_rank: profile.sessions_at_current_rank + 1,
  };

  const { base_points, ramp_interval, min_multiplier, quality_weight, quality_threshold } =
    progression.scoring;

  const multiplier = Math.max(
    min_multiplier,
    1 / (1 + Math.floor(updated.total_sessions / ramp_interval))
  );

  // Group rows by question_type and compute average effectiveness per axis.
  const axisRows: Record<string, number[]> = {};
  for (const row of rows) {
    if (!axisRows[row.question_type]) axisRows[row.question_type] = [];
    axisRows[row.question_type]!.push(row.effectiveness);
  }

  for (const [axis, effectivenessScores] of Object.entries(axisRows)) {
    const avgEffectiveness =
      effectivenessScores.reduce((s, v) => s + v, 0) / effectivenessScores.length;
    const qualityFactor = Math.min(1, Math.max(0.25, avgEffectiveness / 8));
    const points = Math.max(1, Math.round(base_points * multiplier * qualityFactor));
    updated.skill_polygon[axis] = (updated.skill_polygon[axis] ?? 0) + points;
  }

  // Update avg_question_quality as running average.
  const allEffectiveness = rows.map(r => r.effectiveness);
  if (allEffectiveness.length > 0) {
    const sessionAvg =
      allEffectiveness.reduce((s, v) => s + v, 0) / allEffectiveness.length;
    const prevSessions = updated.total_sessions - 1;
    updated.avg_question_quality =
      (profile.avg_question_quality * prevSessions + sessionAvg) / updated.total_sessions;
  }

  // Populate canonical profile.question_quality.avg_overall so the quality_gate
  // in deriveRank (below) sees fresh data. Per-dimension scores are synthesized
  // as effectiveness/4 so avg_overall (sum of 4 dim averages) matches
  // avg(effectiveness) on the 0-8 scale used by progression.yaml gate thresholds.
  if (rows.length > 0) {
    const sessionScores = rows.map(r => ({
      specificity: r.effectiveness / 4,
      relevance: r.effectiveness / 4,
      building: r.effectiveness / 4,
      targeting: r.effectiveness / 4,
    }));
    const prior = (updated.question_quality as QuestionQuality | undefined) ?? EMPTY_QUESTION_QUALITY;
    const qResult = updateRunningAverage({ question_quality: prior }, sessionScores);
    updated.question_quality = qResult.question_quality;
  }

  // Derive rank from updated polygon, gated by quality_gate against updated profile.
  const rankId = deriveRank(updated.skill_polygon, progression, updated);
  if (rankId !== profile.rank) {
    // Promotion (or demotion): this session counted toward the OLD rank; the
    // new rank's session clock starts fresh next session.
    updated.sessions_at_current_rank = 0;
  }
  updated.rank = rankId;
  const rankDef = progression.ranks.find(r => r.id === rankId);
  if (rankDef) updated.rank_title = rankDef.title;

  return updated;
}

// --- Vault updates (added in commit 4) ---

export interface VaultFile {
  path: string;
  content: string;
}

export interface VaultUpdates {
  files: VaultFile[];
}

/**
 * Pure: returns vault file paths and contents without touching the filesystem.
 * Callers supply existing file contents for notes that may already exist.
 */
export interface VaultRenderExtras {
  investigationSummary?: string;
  fixCriteria?: FixCriterion[];
}

export function renderVaultUpdates(
  profile: PlayerProfile,
  rows: ClassificationRow[],
  simId: string,
  sessionDate: string,
  vaultDir: string,
  existingFiles: Record<string, string> = {},
  extras: VaultRenderExtras = {}
): VaultUpdates {
  const questionTypes = [...new Set(rows.map(r => r.question_type))];
  const services = [...new Set(rows.flatMap(r => r.services))];
  const concepts = [...new Set(rows.flatMap(r => r.concepts))];

  const ctx: SessionNoteCtx = {
    simId,
    sessionDate,
    rankAtTime: profile.rank,
    services,
    concepts,
    questionTypes,
    investigationSummary: extras.investigationSummary,
    rows,
    fixCriteria: extras.fixCriteria,
    polygon: profile.skill_polygon,
    sessionsCompleted: profile.total_sessions,
    avgQuestionQuality: profile.avg_question_quality,
  };

  const files: VaultFile[] = [];

  // Session note.
  const sessionNotePath = path.join(vaultDir, 'sessions', `${sessionDate}-${simId}.md`);
  files.push({ path: sessionNotePath, content: renderSessionNote(ctx) });

  // Preload sessions once so service and concept aggregation skip the disk walk per item.
  const loadedSessions = loadSessions(paths.SESSIONS_DIR);

  // Service notes: deterministic per-session full rewrite from aggregated stats.
  for (const service of ctx.services) {
    const stats = aggregateServiceStats(service, loadedSessions);
    const p = path.join(vaultDir, 'services', `${service}.md`);
    files.push({ path: p, content: renderServicePage(service, stats) });
  }

  // Concept notes: same pattern.
  for (const concept of ctx.concepts) {
    const stats = aggregateConceptStats(concept, loadedSessions);
    const p = path.join(vaultDir, 'concepts', `${concept}.md`);
    files.push({ path: p, content: renderConceptPage(concept, stats) });
  }

  // Rank note.
  const rankPath = path.join(vaultDir, 'rank.md');
  const existingRank = existingFiles[rankPath] ?? '';
  files.push({ path: rankPath, content: updateRankNote(existingRank, ctx) });

  return { files };
}

/**
 * Writes vault files atomically: write to .tmp then rename.
 * Safe on Linux (same filesystem); harmless on macOS.
 */
export function applyVaultUpdates(updates: VaultUpdates): void {
  for (const file of updates.files) {
    const dir = path.dirname(file.path);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = file.path + '.tmp';
    fs.writeFileSync(tmp, file.content, 'utf8');
    fs.renameSync(tmp, file.path);
  }
}
