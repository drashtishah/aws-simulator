import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { loadConfig, axisNames, evaluateGate, currentRank, maxDifficulty, applyDecay, scoreSim, availableModifiers, normalizePolygon, getDisplayCeiling, initPolygon, applyDiminishingReturns, evaluateQualityGate } from '../lib/progression';


const CONFIG_PATH = path.join(__dirname, '..', '..', 'references', 'config', 'progression.yaml');

describe('loadConfig', () => {
  it('loads and parses the default config', () => {
    const config = loadConfig(CONFIG_PATH);
    assert.ok(config.axes);
    assert.ok(config.ranks);
    assert.ok(config.category_map);
    assert.ok(config.decay);
    assert.ok(config.modifiers);
    assert.ok(config.sorting);
    assert.ok(config.assist);
  });

  it('has 6 axes in default config', () => {
    const config = loadConfig(CONFIG_PATH);
    assert.equal(Object.keys(config.axes).length, 6);
  });

  it('has 10 ranks in default config', () => {
    const config = loadConfig(CONFIG_PATH);
    assert.equal(config.ranks.length, 10);
  });

  it('has 4 modifiers in default config', () => {
    const config = loadConfig(CONFIG_PATH);
    assert.equal(config.modifiers.length, 4);
  });

  it('has tiered decay config', () => {
    const config = loadConfig(CONFIG_PATH);
    assert.ok(config.decay.tiers);
    assert.equal(config.decay.tiers.length, 3);
  });

  it('has quality scoring params', () => {
    const config = loadConfig(CONFIG_PATH);
    assert.equal(config.scoring.quality_weight, 0.5);
    assert.equal(config.scoring.quality_threshold, 4);
    assert.equal(config.scoring.ramp_interval, 3);
    assert.equal(config.scoring.min_multiplier, 0.05);
  });
});

describe('axisNames', () => {
  it('returns 6 axis keys from default config', () => {
    const config = loadConfig(CONFIG_PATH);
    const names = axisNames(config);
    assert.equal(names.length, 6);
    assert.deepEqual(names, ['gather', 'diagnose', 'correlate', 'impact', 'trace', 'fix']);
  });
});

describe('evaluateGate', () => {
  const config = loadConfig(CONFIG_PATH);

  it('empty gate always matches', () => {
    assert.ok(evaluateGate({}, {}, config));
  });

  it('all_axes_min: passes when all axes meet threshold', () => {
    const poly = { gather: 6, diagnose: 6, correlate: 6, impact: 6, trace: 6, fix: 6 };
    assert.ok(evaluateGate(poly, { all_axes_min: 6 }, config));
  });

  it('all_axes_min: fails when one axis is below threshold', () => {
    const poly = { gather: 6, diagnose: 5, correlate: 6, impact: 6, trace: 6, fix: 6 };
    assert.ok(!evaluateGate(poly, { all_axes_min: 6 }, config));
  });

  it('axes_min: passes when specific axes meet thresholds', () => {
    const poly = { gather: 3, diagnose: 3 };
    assert.ok(evaluateGate(poly, { axes_min: { gather: 3, diagnose: 3 } }, config));
  });

  it('axes_min: fails when a specific axis is below', () => {
    const poly = { gather: 3, diagnose: 2 };
    assert.ok(!evaluateGate(poly, { axes_min: { gather: 3, diagnose: 3 } }, config));
  });

  it('count_axes_above: passes when enough axes meet threshold', () => {
    const poly = { gather: 3, diagnose: 3, correlate: 3 };
    assert.ok(evaluateGate(poly, { count_axes_above: { min: 3, count: 3 } }, config));
  });

  it('count_axes_above: fails when not enough axes meet threshold', () => {
    const poly = { gather: 3, diagnose: 3 };
    assert.ok(!evaluateGate(poly, { count_axes_above: { min: 3, count: 3 } }, config));
  });

  it('compound gate: axes_min + count_axes_above', () => {
    const gate = { axes_min: { correlate: 3 }, count_axes_above: { min: 3, count: 3 } };
    const poly = { gather: 3, diagnose: 3, correlate: 3 };
    assert.ok(evaluateGate(poly, gate, config));
  });

  it('compound gate: fails when axes_min fails even if count passes', () => {
    const gate = { axes_min: { correlate: 3 }, count_axes_above: { min: 3, count: 3 } };
    const poly = { gather: 3, diagnose: 3, impact: 3, correlate: 2 };
    assert.ok(!evaluateGate(poly, gate, config));
  });

  it('compound gate: all_axes_min + count_axes_above', () => {
    const gate = { all_axes_min: 5, count_axes_above: { min: 6, count: 3 } };
    const poly = { gather: 6, diagnose: 6, correlate: 6, impact: 5, trace: 5, fix: 5 };
    assert.ok(evaluateGate(poly, gate, config));
  });

  it('compound gate: all_axes_min + count_axes_above fails when count insufficient', () => {
    const gate = { all_axes_min: 5, count_axes_above: { min: 6, count: 3 } };
    const poly = { gather: 6, diagnose: 6, correlate: 5, impact: 5, trace: 5, fix: 5 };
    assert.ok(!evaluateGate(poly, gate, config));
  });
});

describe('evaluateQualityGate', () => {
  it('passes when avg quality meets threshold', () => {
    const profile = { question_quality: { avg_overall: 4 }, sessions_at_current_rank: 50 };
    const qualityGate = { avg_question_quality: 4, min_sessions_at_rank: 50 };
    assert.ok(evaluateQualityGate(profile, qualityGate));
  });

  it('fails when avg quality below threshold', () => {
    const profile = { question_quality: { avg_overall: 3 }, sessions_at_current_rank: 50 };
    const qualityGate = { avg_question_quality: 4, min_sessions_at_rank: 50 };
    assert.ok(!evaluateQualityGate(profile, qualityGate));
  });

  it('fails when sessions_at_current_rank below minimum', () => {
    const profile = { question_quality: { avg_overall: 5 }, sessions_at_current_rank: 10 };
    const qualityGate = { avg_question_quality: 4, min_sessions_at_rank: 50 };
    assert.ok(!evaluateQualityGate(profile, qualityGate));
  });

  it('passes when both quality and sessions meet threshold', () => {
    const profile = { question_quality: { avg_overall: 6 }, sessions_at_current_rank: 100 };
    const qualityGate = { avg_question_quality: 5, min_sessions_at_rank: 70 };
    assert.ok(evaluateQualityGate(profile, qualityGate));
  });

  it('passes when no quality gate defined (null)', () => {
    const profile = { question_quality: { avg_overall: 0 }, sessions_at_current_rank: 0 };
    assert.ok(evaluateQualityGate(profile, null));
  });

  it('passes when no quality gate defined (undefined)', () => {
    const profile = { question_quality: { avg_overall: 0 }, sessions_at_current_rank: 0 };
    assert.ok(evaluateQualityGate(profile, undefined));
  });
});

describe('currentRank', () => {
  const config = loadConfig(CONFIG_PATH);

  it('returns Responder for empty polygon', () => {
    assert.equal(currentRank({}, config).id, 'responder');
  });

  it('returns Junior Investigator when 2 axes >= 1', () => {
    const poly = { gather: 1, diagnose: 1 };
    assert.equal(currentRank(poly, config).id, 'junior-investigator');
  });

  it('returns Investigator when gather >= 2 and diagnose >= 2', () => {
    assert.equal(currentRank({ gather: 2, diagnose: 2 }, config).id, 'investigator');
  });

  it('returns Senior Investigator when gather >= 3 and 3 axes >= 2', () => {
    const poly = { gather: 3, diagnose: 2, correlate: 2 };
    assert.equal(currentRank(poly, config).id, 'senior-investigator');
  });

  it('returns Analyst when 3 axes >= 3', () => {
    const poly = { gather: 3, diagnose: 3, correlate: 3 };
    assert.equal(currentRank(poly, config).id, 'analyst');
  });

  it('returns Senior Analyst when correlate >= 4 and 4 axes >= 3', () => {
    const poly = { gather: 3, diagnose: 3, correlate: 4, impact: 3 };
    assert.equal(currentRank(poly, config).id, 'senior-analyst');
  });

  it('returns Incident Commander when all >= 3 and 3 axes >= 4', () => {
    const poly = { gather: 4, diagnose: 4, correlate: 4, impact: 3, trace: 3, fix: 3 };
    assert.equal(currentRank(poly, config).id, 'incident-commander');
  });

  it('returns Senior Commander when all axes >= 4', () => {
    const poly = { gather: 4, diagnose: 4, correlate: 4, impact: 4, trace: 4, fix: 4 };
    assert.equal(currentRank(poly, config).id, 'senior-commander');
  });

  it('returns Chaos Engineer when all >= 5 and 3 axes >= 6', () => {
    const poly = { gather: 6, diagnose: 6, correlate: 6, impact: 5, trace: 5, fix: 5 };
    assert.equal(currentRank(poly, config).id, 'chaos-engineer');
  });

  it('returns Chaos Architect when all 6 axes >= 6', () => {
    const poly = { gather: 6, diagnose: 6, correlate: 6, impact: 6, trace: 6, fix: 6 };
    assert.equal(currentRank(poly, config).id, 'chaos-architect');
  });

  it('returns Responder when only one axis is high', () => {
    assert.equal(currentRank({ gather: 10 }, config).id, 'responder');
  });

  it('quality gate blocks rank even when polygon passes', () => {
    const poly = { gather: 2, diagnose: 2 };
    // Without quality profile, polygon-only evaluation gives Investigator
    assert.equal(currentRank(poly, config).id, 'investigator');
    // With quality profile that fails all quality gates, falls to Responder
    const profile = { question_quality: { avg_overall: 1 }, sessions_at_current_rank: 5 };
    assert.equal(currentRank(poly, config, profile).id, 'responder');
  });

  it('quality gate on Junior Investigator with insufficient sessions', () => {
    const poly = { gather: 1, diagnose: 1 };
    const profile = { question_quality: { avg_overall: 3 }, sessions_at_current_rank: 5 };
    // Quality avg passes (3 >= 2) but sessions too low (5 < 15)
    assert.equal(currentRank(poly, config, profile).id, 'responder');
  });
});

describe('maxDifficulty', () => {
  const config = loadConfig(CONFIG_PATH);

  it('returns 1 for Responder', () => {
    assert.equal(maxDifficulty({}, config), 1);
  });

  it('returns 1 for Junior Investigator', () => {
    assert.equal(maxDifficulty({ gather: 1, diagnose: 1 }, config), 1);
  });

  it('returns 2 for Investigator', () => {
    assert.equal(maxDifficulty({ gather: 2, diagnose: 2 }, config), 2);
  });

  it('returns 2 for Senior Investigator', () => {
    const poly = { gather: 3, diagnose: 2, correlate: 2 };
    assert.equal(maxDifficulty(poly, config), 2);
  });

  it('returns 3 for Analyst', () => {
    assert.equal(maxDifficulty({ gather: 3, diagnose: 3, correlate: 3 }, config), 3);
  });

  it('returns 3 for Senior Analyst', () => {
    const poly = { gather: 3, diagnose: 3, correlate: 4, impact: 3 };
    assert.equal(maxDifficulty(poly, config), 3);
  });

  it('returns 4 for Incident Commander', () => {
    const poly = { gather: 4, diagnose: 4, correlate: 4, impact: 3, trace: 3, fix: 3 };
    assert.equal(maxDifficulty(poly, config), 4);
  });

  it('returns 4 for Senior Commander', () => {
    const poly = { gather: 4, diagnose: 4, correlate: 4, impact: 4, trace: 4, fix: 4 };
    assert.equal(maxDifficulty(poly, config), 4);
  });

  it('returns 4 for Chaos Engineer', () => {
    const poly = { gather: 6, diagnose: 6, correlate: 6, impact: 5, trace: 5, fix: 5 };
    assert.equal(maxDifficulty(poly, config), 4);
  });

  it('returns 4 for Chaos Architect', () => {
    const poly = { gather: 6, diagnose: 6, correlate: 6, impact: 6, trace: 6, fix: 6 };
    assert.equal(maxDifficulty(poly, config), 4);
  });
});

describe('applyDecay', () => {
  const config = loadConfig(CONFIG_PATH);

  it('uses fast tier for Responder (decay at 21 days)', () => {
    const poly = { gather: 3, diagnose: 0, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const past = new Date();
    past.setDate(past.getDate() - 25); // past fast tier threshold (21 days)
    const timestamps = { gather: past.toISOString().split('T')[0] };
    const rankId = 'responder';
    const { polygon, decayed } = applyDecay(poly, timestamps, config, rankId);
    assert.equal(polygon.gather, 2);
    assert.deepEqual(decayed, ['gather']);
  });

  it('fast tier does not decay below min_value_to_decay of 2', () => {
    const poly = { gather: 1, diagnose: 0, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const past = new Date();
    past.setDate(past.getDate() - 25);
    const timestamps = { gather: past.toISOString().split('T')[0] };
    const { polygon, decayed } = applyDecay(poly, timestamps, config, 'responder');
    assert.equal(polygon.gather, 1);
    assert.equal(decayed.length, 0);
  });

  it('uses medium tier for Analyst (decay at 28 days)', () => {
    const poly = { gather: 4, diagnose: 0, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const past = new Date();
    past.setDate(past.getDate() - 30); // past medium tier threshold (28 days)
    const timestamps = { gather: past.toISOString().split('T')[0] };
    const { polygon, decayed } = applyDecay(poly, timestamps, config, 'analyst');
    assert.equal(polygon.gather, 3);
    assert.deepEqual(decayed, ['gather']);
  });

  it('medium tier respects floor of 1', () => {
    const poly = { gather: 3, diagnose: 0, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const past = new Date();
    past.setDate(past.getDate() - 100);
    const timestamps = { gather: past.toISOString().split('T')[0] };
    let current = poly;
    for (let i = 0; i < 5; i++) {
      const result = applyDecay(current, timestamps, config, 'analyst');
      current = result.polygon;
    }
    assert.ok(current.gather >= 1);
  });

  it('uses slow tier for Chaos Architect (decay at 42 days)', () => {
    const poly = { gather: 5, diagnose: 0, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const past = new Date();
    past.setDate(past.getDate() - 45); // past slow tier threshold (42 days)
    const timestamps = { gather: past.toISOString().split('T')[0] };
    const { polygon, decayed } = applyDecay(poly, timestamps, config, 'chaos-architect');
    assert.equal(polygon.gather, 4);
    assert.deepEqual(decayed, ['gather']);
  });

  it('slow tier does not decay below min_value_to_decay of 4', () => {
    const poly = { gather: 3, diagnose: 0, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const past = new Date();
    past.setDate(past.getDate() - 100);
    const timestamps = { gather: past.toISOString().split('T')[0] };
    const { polygon, decayed } = applyDecay(poly, timestamps, config, 'chaos-architect');
    assert.equal(polygon.gather, 3);
    assert.equal(decayed.length, 0);
  });

  it('slow tier respects floor of 2', () => {
    const poly = { gather: 5, diagnose: 0, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const past = new Date();
    past.setDate(past.getDate() - 100);
    const timestamps = { gather: past.toISOString().split('T')[0] };
    let current = poly;
    for (let i = 0; i < 10; i++) {
      const result = applyDecay(current, timestamps, config, 'chaos-architect');
      current = result.polygon;
    }
    assert.ok(current.gather >= 2);
  });

  it('does not decay if no timestamp', () => {
    const poly = { gather: 5, diagnose: 0, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const { polygon, decayed } = applyDecay(poly, {}, config, 'responder');
    assert.equal(polygon.gather, 5);
    assert.equal(decayed.length, 0);
  });

  it('fast tier does not decay at 20 days (under 21 day threshold)', () => {
    const poly = { gather: 3, diagnose: 0, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const past = new Date();
    past.setDate(past.getDate() - 20);
    const timestamps = { gather: past.toISOString().split('T')[0] };
    const { polygon, decayed } = applyDecay(poly, timestamps, config, 'responder');
    assert.equal(polygon.gather, 3);
    assert.equal(decayed.length, 0);
  });

  it('falls back to fast tier when no rankId given', () => {
    const poly = { gather: 3, diagnose: 0, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const past = new Date();
    past.setDate(past.getDate() - 25);
    const timestamps = { gather: past.toISOString().split('T')[0] };
    const { polygon, decayed } = applyDecay(poly, timestamps, config);
    assert.equal(polygon.gather, 2);
    assert.deepEqual(decayed, ['gather']);
  });
});

describe('scoreSim', () => {
  const config = loadConfig(CONFIG_PATH);

  it('gives lower score to sims targeting weak axes', () => {
    const poly = { gather: 0, diagnose: 0, correlate: 5, impact: 5, trace: 5, fix: 5 };
    const simWeak = { category: 'networking', services: [] }; // targets gather, diagnose (both 0)
    const simStrong = { category: 'security', services: [] }; // targets trace, impact (both 5)

    const scoreWeak = scoreSim(simWeak, poly, [], config);
    const scoreStrong = scoreSim(simStrong, poly, [], config);
    assert.ok(scoreWeak < scoreStrong, 'sim targeting weak axes should score lower');
  });

  it('uses weakness_weight from config', () => {
    const poly = { gather: 2, diagnose: 2, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const sim = { category: 'networking', services: [] };
    const score = scoreSim(sim, poly, [], config);
    assert.ok(typeof score === 'number');
    assert.ok(score >= 0);
  });
});

describe('availableModifiers', () => {
  const config = loadConfig(CONFIG_PATH);

  it('returns no modifiers for Responder', () => {
    const mods = availableModifiers({}, config);
    assert.equal(mods.length, 0);
  });

  it('returns no modifiers for Analyst (rank 5, no unlock)', () => {
    const poly = { gather: 3, diagnose: 3, correlate: 3 };
    const mods = availableModifiers(poly, config);
    assert.equal(mods.length, 0);
  });

  it('returns modifiers for Incident Commander (rank 7)', () => {
    const poly = { gather: 4, diagnose: 4, correlate: 4, impact: 3, trace: 3, fix: 3 };
    const mods = availableModifiers(poly, config);
    assert.ok(mods.length > 0);
    assert.ok(mods.every(m => m.id && m.title));
  });

  it('returns all modifiers for Chaos Architect', () => {
    const poly = { gather: 6, diagnose: 6, correlate: 6, impact: 6, trace: 6, fix: 6 };
    const mods = availableModifiers(poly, config);
    assert.equal(mods.length, 4);
  });
});

describe('normalizePolygon', () => {
  const config = loadConfig(CONFIG_PATH);

  it('normalizes to 0-10 scale against top rank threshold', () => {
    const poly = { gather: 6, diagnose: 3, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const norm = normalizePolygon(poly, config);
    assert.equal(norm.gather, 10);
    assert.equal(norm.diagnose, 5);
  });

  it('handles empty polygon', () => {
    const norm = normalizePolygon({}, config);
    for (const axis of axisNames(config)) {
      assert.equal(norm[axis], 0);
    }
  });

  it('normalizes against the top rank threshold, not player-max', () => {
    const poly = { gather: 1, diagnose: 0, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const norm = normalizePolygon(poly, config);
    assert.equal(Math.round(norm.gather * 100) / 100, 1.67);
    assert.equal(norm.diagnose, 0);
  });

  it('clamps axes above the ceiling to maxScale', () => {
    const poly = { gather: 9, diagnose: 6, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const norm = normalizePolygon(poly, config);
    assert.equal(norm.gather, 10);
    assert.equal(norm.diagnose, 10);
  });

  it('getDisplayCeiling derives 6 from chaos-architect gate', () => {
    assert.equal(getDisplayCeiling(config), 6);
  });
});

describe('initPolygon', () => {
  const config = loadConfig(CONFIG_PATH);

  it('initializes missing axes to 0', () => {
    const poly = { gather: 5 };
    const result = initPolygon(poly, config);
    assert.equal(result.gather, 5);
    assert.equal(result.diagnose, 0);
    assert.equal(result.fix, 0);
  });

  it('preserves existing values', () => {
    const poly = { gather: 5, diagnose: 3, correlate: 1, impact: 2, trace: 4, fix: 6 };
    const result = initPolygon(poly, config);
    assert.deepEqual(result, poly);
  });

  it('preserves extra axes not in config', () => {
    const poly = { gather: 5, extra_axis: 7 };
    const result = initPolygon(poly, config);
    assert.equal(result.extra_axis, 7);
    assert.equal(result.gather, 5);
    assert.equal(result.diagnose, 0);
  });
});

describe('applyDiminishingReturns', () => {
  const config = loadConfig(CONFIG_PATH);

  it('0 sessions, quality 8/8: full points (multiplier = 1.0, quality factor = 1.0)', () => {
    const polygon = { gather: 0, diagnose: 0, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const effectives = { gather: 2, diagnose: 1 };
    const result = applyDiminishingReturns(polygon, effectives, 0, config, 8);
    assert.equal(result.gather, 2);
    assert.equal(result.diagnose, 1);
  });

  it('0 sessions, quality 4/8: half quality factor (0.5)', () => {
    const polygon = { gather: 0, diagnose: 0, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const effectives = { gather: 2, diagnose: 2 };
    const result = applyDiminishingReturns(polygon, effectives, 0, config, 4);
    // multiplier=1.0, quality_factor=0.5, 2*1.0*0.5=1
    assert.equal(result.gather, 1);
    assert.equal(result.diagnose, 1);
  });

  it('quality factor floor at 0.25 (quality 1/8)', () => {
    const polygon = { gather: 0, diagnose: 0, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const effectives = { gather: 4 };
    const result = applyDiminishingReturns(polygon, effectives, 0, config, 1);
    // multiplier=1.0, quality_factor=clamp(1/8, 0.25, 1.0)=0.25, 4*1.0*0.25=1
    assert.equal(result.gather, 1);
  });

  it('quality factor cap at 1.0 (quality 8/8)', () => {
    const polygon = { gather: 0, diagnose: 0, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const effectives = { gather: 3 };
    const result = applyDiminishingReturns(polygon, effectives, 0, config, 8);
    // multiplier=1.0, quality_factor=1.0, 3*1.0*1.0=3
    assert.equal(result.gather, 3);
  });

  it('quality factor at 0.75 for quality 6/8', () => {
    const polygon = { gather: 0, diagnose: 0, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const effectives = { gather: 4 };
    const result = applyDiminishingReturns(polygon, effectives, 0, config, 6);
    // multiplier=1.0, quality_factor=0.75, 4*1.0*0.75=3
    assert.equal(result.gather, 3);
  });

  it('2 sessions: still full multiplier (first ramp interval is 3)', () => {
    const polygon = { gather: 5, diagnose: 3, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const effectives = { gather: 2, diagnose: 1 };
    const result = applyDiminishingReturns(polygon, effectives, 2, config, 8);
    assert.equal(result.gather, 7);
    assert.equal(result.diagnose, 4);
  });

  it('3 sessions: half multiplier (0.5)', () => {
    const polygon = { gather: 0, diagnose: 0, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const effectives = { gather: 2, diagnose: 2 };
    const result = applyDiminishingReturns(polygon, effectives, 3, config, 8);
    // multiplier=max(0.05, 1/(1+1))=0.5, quality=1.0, 2*0.5*1.0=1
    assert.equal(result.gather, 1);
    assert.equal(result.diagnose, 1);
  });

  it('6 sessions: third of points (multiplier ~ 0.33)', () => {
    const polygon = { gather: 0, diagnose: 0, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const effectives = { gather: 3, diagnose: 3 };
    const result = applyDiminishingReturns(polygon, effectives, 6, config, 8);
    // multiplier=max(0.05, 1/(1+2))=0.333, quality=1.0, 3*0.333*1.0=1
    assert.equal(result.gather, 1);
    assert.equal(result.diagnose, 1);
  });

  it('min multiplier floor respected (never below 0.05)', () => {
    const polygon = { gather: 0, diagnose: 0, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const effectives = { gather: 20 };
    // At 100 sessions: multiplier = 1/(1+33) = 0.029, floored to 0.05
    const result = applyDiminishingReturns(polygon, effectives, 100, config, 8);
    assert.equal(result.gather, 1); // 20 * 0.05 * 1.0 = 1
  });

  it('empty effectives: no change to polygon', () => {
    const polygon = { gather: 5, diagnose: 3, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const result = applyDiminishingReturns(polygon, {}, 10, config, 8);
    assert.equal(result.gather, 5);
    assert.equal(result.diagnose, 3);
  });

  it('config without scoring section: falls back to 1.0x', () => {
    const configNoScoring = { ...config };
    delete configNoScoring.scoring;
    const polygon = { gather: 0, diagnose: 0, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const effectives = { gather: 3 };
    const result = applyDiminishingReturns(polygon, effectives, 20, configNoScoring);
    assert.equal(result.gather, 3); // No diminishing, full points
  });

  it('no avgQuality argument: defaults to no quality factor', () => {
    const polygon = { gather: 0, diagnose: 0, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const effectives = { gather: 2 };
    const result = applyDiminishingReturns(polygon, effectives, 0, config);
    // Without quality arg, should still work (backward compat, quality factor = 1.0)
    assert.equal(result.gather, 2);
  });
});

describe('config extensibility', () => {
  it('adding a 7th axis: currentRank still works without code changes', () => {
    const config = loadConfig(CONFIG_PATH);
    config.axes.communicate = { label: 'Communicate', description: 'Stakeholder updates', keywords: [] };

    const poly = {};
    assert.equal(currentRank(poly, config).id, 'responder');

    const poly7 = { gather: 6, diagnose: 6, correlate: 6, impact: 6, trace: 6, fix: 6, communicate: 6 };
    assert.equal(currentRank(poly7, config).id, 'chaos-architect');

    const poly6 = { gather: 6, diagnose: 6, correlate: 6, impact: 6, trace: 6, fix: 6 };
    assert.notEqual(currentRank(poly6, config).id, 'chaos-architect');
  });

  it('inserting a rank: evaluator picks it up from config', () => {
    const config = loadConfig(CONFIG_PATH);
    const newRank = {
      id: 'master-architect',
      title: 'Master Architect',
      gate: { all_axes_min: 8 },
      max_difficulty: 4,
      unlocks: ['challenge_modifiers', 'custom_constraints']
    };
    config.ranks.splice(0, 0, newRank);

    const poly = { gather: 8, diagnose: 8, correlate: 8, impact: 8, trace: 8, fix: 8 };
    assert.equal(currentRank(poly, config).id, 'master-architect');
    assert.equal(maxDifficulty(poly, config), 4);
  });
});
