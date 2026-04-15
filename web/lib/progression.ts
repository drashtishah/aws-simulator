import fs from 'node:fs';
import yaml from 'js-yaml';

export interface Polygon {
  [axis: string]: number;
}

interface Gate {
  all_axes_min?: number;
  axes_min?: Record<string, number>;
  count_axes_above?: { min: number; count: number };
}

interface QualityGate {
  avg_question_quality: number;
  min_sessions_at_rank: number;
}

interface Rank {
  id: string;
  title: string;
  max_difficulty: number;
  gate?: Gate;
  quality_gate?: QualityGate;
  unlocks?: string[];
}

interface Modifier {
  id: string;
  requires_unlock?: string;
}

interface DecayTier {
  ranks: string[];
  decay_after_days: number;
  min_value_to_decay: number;
  floor: number;
}

interface DecayConfig {
  decay_amount?: number;
  tiers?: DecayTier[];
  decay_after_days?: number;
  min_value_to_decay?: number;
  floor?: number;
}

interface SortingConfig {
  weakness_weight: number;
  service_gap_weight: number;
  retention_weight: number;
  retention_stale_days: number;
  retention_score_cap: number;
}

interface ScoringConfig {
  ramp_interval?: number;
  min_multiplier?: number;
}

export interface ProgressionConfig {
  axes: Record<string, unknown>;
  ranks: Rank[];
  modifiers?: Modifier[];
  decay?: DecayConfig;
  sorting: SortingConfig;
  scoring?: ScoringConfig;
  category_map: Record<string, string[]>;
}

interface Profile {
  question_quality?: { avg_overall?: number };
  sessions_at_current_rank?: number;
}

interface CatalogEntry {
  service: string;
  sims_completed: number;
  knowledge_score: number;
  last_practiced?: string;
}

interface SimInfo {
  category: string;
  services?: string[];
}

function loadConfig(yamlPath: string): ProgressionConfig {
  const raw = fs.readFileSync(yamlPath, 'utf8');
  const config = yaml.load(raw) as ProgressionConfig;

  if (!config.axes || typeof config.axes !== 'object') {
    throw new Error('progression config: missing or invalid "axes" section');
  }
  if (!Array.isArray(config.ranks) || config.ranks.length === 0) {
    throw new Error('progression config: missing or empty "ranks" section');
  }

  const axisKeys = Object.keys(config.axes);

  for (const rank of config.ranks) {
    if (!rank.id || !rank.title || rank.max_difficulty === undefined) {
      throw new Error('progression config: rank missing id, title, or max_difficulty');
    }
    const gate = rank.gate ?? {};
    if (gate.axes_min) {
      for (const axis of Object.keys(gate.axes_min)) {
        if (!axisKeys.includes(axis)) {
          throw new Error(`progression config: rank "${rank.id}" gate references unknown axis "${axis}"`);
        }
      }
    }
  }

  if (config.modifiers) {
    const allUnlocks = new Set<string>();
    for (const rank of config.ranks) {
      for (const u of (rank.unlocks ?? [])) {
        allUnlocks.add(u);
      }
    }
    for (const mod of config.modifiers) {
      if (mod.requires_unlock && !allUnlocks.has(mod.requires_unlock)) {
        throw new Error(`progression config: modifier "${mod.id}" requires unknown unlock "${mod.requires_unlock}"`);
      }
    }
  }

  return config;
}

function axisNames(config: ProgressionConfig): string[] {
  return Object.keys(config.axes);
}

function evaluateGate(polygon: Polygon, gate: Gate | undefined, config: ProgressionConfig): boolean {
  if (!gate || Object.keys(gate).length === 0) {
    return true;
  }

  const axes = axisNames(config);
  let pass = true;

  if (gate.all_axes_min !== undefined) {
    const min = gate.all_axes_min;
    if (!axes.every(axis => (polygon[axis] ?? 0) >= min)) {
      pass = false;
    }
  }

  if (pass && gate.axes_min) {
    for (const [axis, min] of Object.entries(gate.axes_min)) {
      if ((polygon[axis] ?? 0) < min) {
        pass = false;
        break;
      }
    }
  }

  if (pass && gate.count_axes_above) {
    const { min, count } = gate.count_axes_above;
    const above = axes.filter(axis => (polygon[axis] ?? 0) >= min).length;
    if (above < count) {
      pass = false;
    }
  }

  return pass;
}

function evaluateQualityGate(profile: Profile, qualityGate: QualityGate | undefined): boolean {
  if (!qualityGate) return true;

  const avgQuality = profile.question_quality?.avg_overall ?? 0;
  const sessionsAtRank = profile.sessions_at_current_rank ?? 0;

  if (avgQuality < qualityGate.avg_question_quality) return false;
  if (sessionsAtRank < qualityGate.min_sessions_at_rank) return false;

  return true;
}

function currentRank(polygon: Polygon, config: ProgressionConfig, profile?: Profile): Rank {
  for (const rank of config.ranks) {
    if (!evaluateGate(polygon, rank.gate, config)) continue;
    if (profile && !evaluateQualityGate(profile, rank.quality_gate)) continue;
    return rank;
  }
  return config.ranks[config.ranks.length - 1]!;
}

function maxDifficulty(polygon: Polygon, config: ProgressionConfig, profile?: Profile): number {
  return currentRank(polygon, config, profile).max_difficulty;
}

function applyDecay(
  polygon: Polygon,
  timestamps: Record<string, string>,
  config: ProgressionConfig,
  rankId?: string
): { polygon: Polygon; decayed: string[] } {
  const decayConfig = config.decay;
  if (!decayConfig) return { polygon: { ...polygon }, decayed: [] };

  let tierParams: { decay_after_days: number; min_value_to_decay: number; floor: number };
  if (decayConfig.tiers) {
    const found = decayConfig.tiers.find(t => t.ranks.includes(rankId ?? ''));
    tierParams = found ?? decayConfig.tiers[0]!;
  } else {
    tierParams = {
      decay_after_days: decayConfig.decay_after_days ?? 0,
      min_value_to_decay: decayConfig.min_value_to_decay ?? 0,
      floor: decayConfig.floor ?? 0,
    };
  }

  const now = new Date();
  const updated: Polygon = { ...polygon };
  const decayed: string[] = [];
  const decayAmount = decayConfig.decay_amount ?? 1;

  for (const axis of axisNames(config)) {
    const value = updated[axis] ?? 0;
    if (value < tierParams.min_value_to_decay) continue;

    const lastAdvanced = timestamps[axis];
    if (!lastAdvanced) continue;

    const daysSince = (now.getTime() - new Date(lastAdvanced).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince >= tierParams.decay_after_days) {
      updated[axis] = Math.max(tierParams.floor, value - decayAmount);
      if ((updated[axis] ?? 0) < value) {
        decayed.push(axis);
      }
    }
  }

  return { polygon: updated, decayed };
}

function scoreSim(
  sim: SimInfo,
  polygon: Polygon,
  catalog: CatalogEntry[] | null,
  config: ProgressionConfig
): number {
  const sorting = config.sorting;
  const categoryAxes = config.category_map[sim.category] ?? [];

  let weaknessScore: number;
  if (categoryAxes.length > 0) {
    const avg = categoryAxes.reduce((sum, axis) => sum + (polygon[axis] ?? 0), 0) / categoryAxes.length;
    weaknessScore = avg;
  } else {
    weaknessScore = 10;
  }

  const simServices = sim.services ?? [];
  let serviceGapScore = 0;
  if (simServices.length > 0 && catalog) {
    const practiced = simServices.filter(s => {
      const entry = catalog.find(c => c.service === s);
      return entry && entry.sims_completed > 0;
    }).length;
    serviceGapScore = practiced / simServices.length;
  }

  let retentionScore = 1;
  if (simServices.length > 0 && catalog) {
    const staleCount = simServices.filter(s => {
      const entry = catalog.find(c => c.service === s);
      if (!entry?.last_practiced) return false;
      const daysSince = (new Date().getTime() - new Date(entry.last_practiced).getTime()) / (1000 * 60 * 60 * 24);
      return daysSince >= sorting.retention_stale_days &&
             (entry.knowledge_score ?? 0) < sorting.retention_score_cap;
    }).length;
    retentionScore = staleCount > 0 ? 0 : 1;
  }

  return (sorting.weakness_weight * weaknessScore) +
         (sorting.service_gap_weight * serviceGapScore) +
         (sorting.retention_weight * retentionScore);
}

function availableModifiers(polygon: Polygon, config: ProgressionConfig, profile?: Profile): Modifier[] {
  if (!config.modifiers) return [];

  const rank = currentRank(polygon, config, profile);
  const unlocks = new Set(rank.unlocks ?? []);

  return config.modifiers.filter(mod =>
    !mod.requires_unlock || unlocks.has(mod.requires_unlock)
  );
}

function getDisplayCeiling(config: ProgressionConfig): number {
  let ceiling = 1;
  for (const rank of config.ranks) {
    const gate = rank.gate;
    if (!gate) continue;
    if (gate.all_axes_min !== undefined) {
      ceiling = Math.max(ceiling, gate.all_axes_min);
    }
    if (gate.axes_min) {
      for (const v of Object.values(gate.axes_min)) ceiling = Math.max(ceiling, v);
    }
    if (gate.count_axes_above?.min !== undefined) {
      ceiling = Math.max(ceiling, gate.count_axes_above.min);
    }
  }
  return ceiling;
}

function normalizePolygon(polygon: Polygon, config: ProgressionConfig, maxScale = 10): Polygon {
  const axes = axisNames(config);
  const ceiling = getDisplayCeiling(config);
  const result: Polygon = {};
  for (const axis of axes) {
    const scaled = ((polygon[axis] ?? 0) / ceiling) * maxScale;
    result[axis] = Math.min(scaled, maxScale);
  }
  return result;
}

function applyDiminishingReturns(
  polygon: Polygon,
  sessionEffectives: Record<string, number>,
  totalSessions: number,
  config: ProgressionConfig,
  avgQuality?: number | null
): Polygon {
  const result: Polygon = { ...polygon };
  const scoring = config.scoring;

  if (!scoring) {
    for (const [axis, points] of Object.entries(sessionEffectives)) {
      result[axis] = (result[axis] ?? 0) + points;
    }
    return result;
  }

  const ramp = scoring.ramp_interval ?? 3;
  const minMult = scoring.min_multiplier ?? 0.05;
  const multiplier = Math.max(minMult, 1 / (1 + Math.floor(totalSessions / ramp)));

  let qualityFactor = 1.0;
  if (avgQuality !== undefined && avgQuality !== null) {
    qualityFactor = Math.min(1.0, Math.max(0.25, avgQuality / 8));
  }

  for (const [axis, points] of Object.entries(sessionEffectives)) {
    const adjusted = Math.round(points * multiplier * qualityFactor);
    result[axis] = (result[axis] ?? 0) + adjusted;
  }

  return result;
}

function initPolygon(polygon: Polygon, config: ProgressionConfig): Polygon {
  const result: Polygon = { ...polygon };
  for (const axis of axisNames(config)) {
    if (result[axis] === undefined) {
      result[axis] = 0;
    }
  }
  return result;
}

export {
  loadConfig,
  axisNames,
  evaluateGate,
  evaluateQualityGate,
  currentRank,
  maxDifficulty,
  applyDecay,
  scoreSim,
  availableModifiers,
  normalizePolygon,
  getDisplayCeiling,
  initPolygon,
  applyDiminishingReturns,
};
