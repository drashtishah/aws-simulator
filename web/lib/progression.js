'use strict';

const fs = require('fs');
const yaml = require('js-yaml');

/**
 * Load and validate the progression config from a YAML file.
 */
function loadConfig(yamlPath) {
  const raw = fs.readFileSync(yamlPath, 'utf8');
  const config = yaml.load(raw);

  if (!config.axes || typeof config.axes !== 'object') {
    throw new Error('progression config: missing or invalid "axes" section');
  }
  if (!Array.isArray(config.ranks) || config.ranks.length === 0) {
    throw new Error('progression config: missing or empty "ranks" section');
  }

  const axisKeys = Object.keys(config.axes);

  // Validate rank gates reference known axes
  for (const rank of config.ranks) {
    if (!rank.id || !rank.title || rank.max_difficulty === undefined) {
      throw new Error(`progression config: rank missing id, title, or max_difficulty`);
    }
    const gate = rank.gate || {};
    if (gate.axes_min) {
      for (const axis of Object.keys(gate.axes_min)) {
        if (!axisKeys.includes(axis)) {
          throw new Error(`progression config: rank "${rank.id}" gate references unknown axis "${axis}"`);
        }
      }
    }
  }

  // Validate modifier unlock keys exist in some rank's unlocks
  if (config.modifiers) {
    const allUnlocks = new Set();
    for (const rank of config.ranks) {
      for (const u of (rank.unlocks || [])) {
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

/**
 * Return ordered list of axis keys from config.
 */
function axisNames(config) {
  return Object.keys(config.axes);
}

/**
 * Evaluate a single gate condition against a polygon.
 * Gate types: all_axes_min, axes_min, count_axes_above, empty (always true).
 */
function evaluateGate(polygon, gate, config) {
  if (!gate || Object.keys(gate).length === 0) {
    return true;
  }

  const axes = axisNames(config);

  if (gate.all_axes_min !== undefined) {
    const min = gate.all_axes_min;
    return axes.every(axis => (polygon[axis] || 0) >= min);
  }

  // For compound gates (axes_min + count_axes_above), all conditions must pass
  let pass = true;

  if (gate.axes_min) {
    for (const [axis, min] of Object.entries(gate.axes_min)) {
      if ((polygon[axis] || 0) < min) {
        pass = false;
        break;
      }
    }
  }

  if (pass && gate.count_axes_above) {
    const { min, count } = gate.count_axes_above;
    const above = axes.filter(axis => (polygon[axis] || 0) >= min).length;
    if (above < count) {
      pass = false;
    }
  }

  return pass;
}

/**
 * Determine current rank by evaluating gates top-to-bottom.
 * Returns the full rank object (id, title, max_difficulty, unlocks, gate).
 */
function currentRank(polygon, config) {
  for (const rank of config.ranks) {
    if (evaluateGate(polygon, rank.gate, config)) {
      return rank;
    }
  }
  return config.ranks[config.ranks.length - 1];
}

/**
 * Shorthand: return max difficulty the player can access.
 */
function maxDifficulty(polygon, config) {
  return currentRank(polygon, config).max_difficulty;
}

/**
 * Apply skill decay to polygon axes based on timestamps.
 * Returns { polygon, decayed } where decayed is an array of axis keys that lost points.
 */
function applyDecay(polygon, timestamps, config) {
  const decayConfig = config.decay;
  if (!decayConfig) return { polygon: { ...polygon }, decayed: [] };

  const now = new Date();
  const updated = { ...polygon };
  const decayed = [];

  for (const axis of axisNames(config)) {
    const value = updated[axis] || 0;
    if (value < decayConfig.min_value_to_decay) continue;

    const lastAdvanced = timestamps[axis];
    if (!lastAdvanced) continue;

    const daysSince = (now - new Date(lastAdvanced)) / (1000 * 60 * 60 * 24);
    if (daysSince >= decayConfig.decay_after_days) {
      updated[axis] = Math.max(decayConfig.floor, value - decayConfig.decay_amount);
      if (updated[axis] < value) {
        decayed.push(axis);
      }
    }
  }

  return { polygon: updated, decayed };
}

/**
 * Compute a weighted sort score for a sim. Lower = appears first.
 */
function scoreSim(sim, polygon, catalog, config) {
  const sorting = config.sorting;
  const categoryAxes = config.category_map[sim.category] || [];

  // Weakness score: average of polygon values for axes this sim exercises.
  // Lower polygon values = higher priority (lower score contribution).
  let weaknessScore = 0;
  if (categoryAxes.length > 0) {
    const avg = categoryAxes.reduce((sum, axis) => sum + (polygon[axis] || 0), 0) / categoryAxes.length;
    weaknessScore = avg;
  } else {
    weaknessScore = 10; // No category mapping = low priority
  }

  // Service gap score: how many of the sim's services have NOT been practiced.
  // More unpracticed = lower score (higher priority).
  const simServices = sim.services || [];
  let serviceGapScore = 0;
  if (simServices.length > 0 && catalog) {
    const practiced = simServices.filter(s => {
      const entry = catalog.find(c => c.service === s);
      return entry && entry.sims_completed > 0;
    }).length;
    serviceGapScore = practiced / simServices.length; // 0 = all new, 1 = all practiced
  }

  // Retention score: for practiced services, how stale is the knowledge?
  // Stale services with low scores get priority (lower score).
  let retentionScore = 1; // Default: no boost
  if (simServices.length > 0 && catalog) {
    const staleCount = simServices.filter(s => {
      const entry = catalog.find(c => c.service === s);
      if (!entry || !entry.last_practiced) return false;
      const daysSince = (new Date() - new Date(entry.last_practiced)) / (1000 * 60 * 60 * 24);
      return daysSince >= sorting.retention_stale_days &&
             (entry.knowledge_score || 0) < sorting.retention_score_cap;
    }).length;
    retentionScore = staleCount > 0 ? 0 : 1;
  }

  return (sorting.weakness_weight * weaknessScore) +
         (sorting.service_gap_weight * serviceGapScore) +
         (sorting.retention_weight * retentionScore);
}

/**
 * Return modifiers the player's current rank unlocks.
 */
function availableModifiers(polygon, config) {
  if (!config.modifiers) return [];

  const rank = currentRank(polygon, config);
  const unlocks = new Set(rank.unlocks || []);

  return config.modifiers.filter(mod =>
    !mod.requires_unlock || unlocks.has(mod.requires_unlock)
  );
}

/**
 * Normalize polygon values to a 0-maxScale range for rendering.
 */
function normalizePolygon(polygon, config, maxScale = 10) {
  const axes = axisNames(config);
  const values = axes.map(a => polygon[a] || 0);
  const max = Math.max(...values, 1);
  const result = {};
  for (const axis of axes) {
    result[axis] = ((polygon[axis] || 0) / max) * maxScale;
  }
  return result;
}

/**
 * Initialize any missing axes in a polygon to 0.
 * Axes in the polygon but not in config are preserved but ignored.
 */
function initPolygon(polygon, config) {
  const result = { ...polygon };
  for (const axis of axisNames(config)) {
    if (result[axis] === undefined) {
      result[axis] = 0;
    }
  }
  return result;
}

module.exports = {
  loadConfig,
  axisNames,
  evaluateGate,
  currentRank,
  maxDifficulty,
  applyDecay,
  scoreSim,
  availableModifiers,
  normalizePolygon,
  initPolygon,
};
