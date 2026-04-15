import fs from 'node:fs';
import path from 'node:path';
import jsYaml from 'js-yaml';
import type { ClassificationRow } from './classification-schema.js';
import {
  renderSessionNote,
  appendSessionLinkToService,
  appendSessionLinkToConcept,
  updateRankNote,
} from './vault-templates.js';
import type { SessionNoteCtx } from './vault-templates.js';

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

/**
 * Derives the rank id from a polygon and progression config.
 * Checks only polygon gates (not quality gates) since quality gates
 * require sustained sessions, which are not enforced here.
 * Returns the id of the first rank whose gate is satisfied (top-down).
 */
export function deriveRank(polygon: SkillPolygon, progression: Progression): string {
  const axisValues = Object.values(polygon);
  for (const rank of progression.ranks) {
    const gate = rank.gate;
    if (gateMatches(polygon, axisValues, gate)) {
      return rank.id;
    }
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

  // Derive rank from updated polygon.
  const rankId = deriveRank(updated.skill_polygon, progression);
  updated.rank = rankId;
  const rankDef = progression.ranks.find(r => r.id === rankId);
  if (rankDef) updated.rank_title = rankDef.title;

  return updated;
}

// --- Catalog update (added in commit 3) ---

export interface CatalogRow {
  service: string;
  sims_completed: number;
  knowledge_score: number;
  last_practiced: string;
  [key: string]: unknown;
}

/**
 * Updates catalog rows from classification results.
 * Pure and idempotent: if alreadyCompleted is true, returns rows unchanged.
 * Increments sims_completed and updates knowledge_score + last_practiced
 * for all rows (the session touched the whole catalog entry set).
 */
export function updateCatalogFromClassification(
  catalogRows: CatalogRow[],
  rows: ClassificationRow[],
  simId: string,
  alreadyCompleted: boolean
): CatalogRow[] {
  if (alreadyCompleted) return catalogRows;

  const today = new Date().toISOString().slice(0, 10);
  const allEffectiveness = rows.map(r => r.effectiveness);
  const avgEffectiveness =
    allEffectiveness.length > 0
      ? allEffectiveness.reduce((s, v) => s + v, 0) / allEffectiveness.length
      : 0;
  const qualityFactor = Math.min(1, Math.max(0.25, avgEffectiveness / 8));

  return catalogRows.map(row => ({
    ...row,
    sims_completed: row.sims_completed + 1,
    knowledge_score: Math.min(10, row.knowledge_score + qualityFactor),
    last_practiced: today,
  }));
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
export function renderVaultUpdates(
  profile: PlayerProfile,
  rows: ClassificationRow[],
  simId: string,
  sessionDate: string,
  vaultDir: string,
  existingFiles: Record<string, string> = {}
): VaultUpdates {
  const services = [...new Set(rows.map(() => ''))].filter(Boolean); // placeholder; real services come from manifest
  const questionTypes = [...new Set(rows.map(r => r.question_type))];

  const ctx: SessionNoteCtx = {
    simId,
    sessionDate,
    rankAtTime: profile.rank,
    services: (profile as { _sessionServices?: string[] })._sessionServices ?? [],
    concepts: (profile as { _sessionConcepts?: string[] })._sessionConcepts ?? [],
    questionTypes,
  };

  const files: VaultFile[] = [];

  // Session note.
  const sessionNotePath = path.join(vaultDir, 'sessions', `${sessionDate}-${simId}.md`);
  files.push({ path: sessionNotePath, content: renderSessionNote(ctx) });

  // Service notes.
  for (const service of ctx.services) {
    const p = path.join(vaultDir, 'services', `${service}.md`);
    const existing = existingFiles[p] ?? '';
    files.push({ path: p, content: appendSessionLinkToService(existing, ctx) });
  }

  // Concept notes.
  for (const concept of ctx.concepts) {
    const p = path.join(vaultDir, 'concepts', `${concept}.md`);
    const existing = existingFiles[p] ?? '';
    files.push({ path: p, content: appendSessionLinkToConcept(existing, { ...ctx, concept }) });
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
