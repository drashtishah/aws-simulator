const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const {
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
} = require('../lib/progression');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'references', 'progression.yaml');

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

  it('has 5 ranks in default config', () => {
    const config = loadConfig(CONFIG_PATH);
    assert.equal(config.ranks.length, 5);
  });

  it('has 4 modifiers in default config', () => {
    const config = loadConfig(CONFIG_PATH);
    assert.equal(config.modifiers.length, 4);
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
});

describe('currentRank', () => {
  const config = loadConfig(CONFIG_PATH);

  it('returns Responder for empty polygon', () => {
    assert.equal(currentRank({}, config).id, 'responder');
  });

  it('returns Investigator when gather >= 3 and diagnose >= 3', () => {
    assert.equal(currentRank({ gather: 3, diagnose: 3 }, config).id, 'investigator');
  });

  it('returns Analyst when correlate >= 3 and 3 axes >= 3', () => {
    const poly = { gather: 3, diagnose: 3, correlate: 3 };
    assert.equal(currentRank(poly, config).id, 'analyst');
  });

  it('returns Incident Commander when all 6 axes >= 3', () => {
    const poly = { gather: 3, diagnose: 3, correlate: 3, impact: 3, trace: 3, fix: 3 };
    assert.equal(currentRank(poly, config).id, 'incident-commander');
  });

  it('returns Chaos Architect when all 6 axes >= 6', () => {
    const poly = { gather: 6, diagnose: 6, correlate: 6, impact: 6, trace: 6, fix: 6 };
    assert.equal(currentRank(poly, config).id, 'chaos-architect');
  });

  it('returns Incident Commander at 5 (not Chaos Architect)', () => {
    const poly = { gather: 5, diagnose: 5, correlate: 5, impact: 5, trace: 5, fix: 5 };
    assert.equal(currentRank(poly, config).id, 'incident-commander');
  });

  it('returns Responder when only one axis is high', () => {
    assert.equal(currentRank({ gather: 10 }, config).id, 'responder');
  });
});

describe('maxDifficulty', () => {
  const config = loadConfig(CONFIG_PATH);

  it('returns 1 for Responder', () => {
    assert.equal(maxDifficulty({}, config), 1);
  });

  it('returns 2 for Investigator', () => {
    assert.equal(maxDifficulty({ gather: 3, diagnose: 3 }, config), 2);
  });

  it('returns 3 for Analyst', () => {
    assert.equal(maxDifficulty({ gather: 3, diagnose: 3, correlate: 3 }, config), 3);
  });

  it('returns 4 for Incident Commander', () => {
    const poly = { gather: 3, diagnose: 3, correlate: 3, impact: 3, trace: 3, fix: 3 };
    assert.equal(maxDifficulty(poly, config), 4);
  });

  it('returns 4 for Chaos Architect', () => {
    const poly = { gather: 6, diagnose: 6, correlate: 6, impact: 6, trace: 6, fix: 6 };
    assert.equal(maxDifficulty(poly, config), 4);
  });
});

describe('applyDecay', () => {
  const config = loadConfig(CONFIG_PATH);

  it('does not decay axes below min_value_to_decay', () => {
    const poly = { gather: 2, diagnose: 0, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const timestamps = { gather: '2025-01-01' };
    const { polygon, decayed } = applyDecay(poly, timestamps, config);
    assert.equal(polygon.gather, 2);
    assert.equal(decayed.length, 0);
  });

  it('decays axes past decay_after_days threshold', () => {
    const poly = { gather: 5, diagnose: 0, correlate: 0, impact: 0, trace: 0, fix: 0 };
    // 100 days ago
    const past = new Date();
    past.setDate(past.getDate() - 100);
    const timestamps = { gather: past.toISOString().split('T')[0] };
    const { polygon, decayed } = applyDecay(poly, timestamps, config);
    assert.equal(polygon.gather, 4);
    assert.deepEqual(decayed, ['gather']);
  });

  it('respects floor', () => {
    const poly = { gather: 3, diagnose: 0, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const past = new Date();
    past.setDate(past.getDate() - 100);
    const timestamps = { gather: past.toISOString().split('T')[0] };

    // Apply decay multiple times to test floor
    let current = poly;
    let ts = timestamps;
    for (let i = 0; i < 5; i++) {
      const result = applyDecay(current, ts, config);
      current = result.polygon;
    }
    assert.ok(current.gather >= 0);
  });

  it('does not decay if no timestamp', () => {
    const poly = { gather: 5, diagnose: 0, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const { polygon, decayed } = applyDecay(poly, {}, config);
    assert.equal(polygon.gather, 5);
    assert.equal(decayed.length, 0);
  });

  it('decay can trigger a rank drop', () => {
    // Investigator requires gather >= 3 and diagnose >= 3
    const poly = { gather: 3, diagnose: 3, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const past = new Date();
    past.setDate(past.getDate() - 100);
    const timestamps = { gather: past.toISOString().split('T')[0], diagnose: past.toISOString().split('T')[0] };

    assert.equal(currentRank(poly, config).id, 'investigator');

    const { polygon } = applyDecay(poly, timestamps, config);
    assert.equal(currentRank(polygon, config).id, 'responder');
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

  it('returns modifiers for Incident Commander', () => {
    const poly = { gather: 3, diagnose: 3, correlate: 3, impact: 3, trace: 3, fix: 3 };
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

  it('normalizes to 0-10 scale', () => {
    const poly = { gather: 10, diagnose: 5, correlate: 0, impact: 0, trace: 0, fix: 0 };
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

describe('config extensibility', () => {
  it('adding a 7th axis: currentRank still works without code changes', () => {
    const config = loadConfig(CONFIG_PATH);
    // Simulate adding a 7th axis
    config.axes.communicate = { label: 'Communicate', description: 'Stakeholder updates', keywords: [] };

    // Responder gate is empty, should still match
    const poly = {};
    assert.equal(currentRank(poly, config).id, 'responder');

    // all_axes_min gate now requires 7 axes
    const poly7 = { gather: 6, diagnose: 6, correlate: 6, impact: 6, trace: 6, fix: 6, communicate: 6 };
    assert.equal(currentRank(poly7, config).id, 'chaos-architect');

    // Missing the 7th axis should fail all_axes_min
    const poly6 = { gather: 6, diagnose: 6, correlate: 6, impact: 6, trace: 6, fix: 6 };
    assert.notEqual(currentRank(poly6, config).id, 'chaos-architect');
  });

  it('inserting a rank: evaluator picks it up from config', () => {
    const config = loadConfig(CONFIG_PATH);
    // Insert a new rank between analyst and incident-commander
    const newRank = {
      id: 'senior-analyst',
      title: 'Senior Analyst',
      gate: { count_axes_above: { min: 3, count: 5 } },
      max_difficulty: 3,
      unlocks: []
    };
    // Insert at index 2 (after incident-commander, before analyst)
    config.ranks.splice(2, 0, newRank);

    const poly = { gather: 3, diagnose: 3, correlate: 3, impact: 3, trace: 3, fix: 0 };
    assert.equal(currentRank(poly, config).id, 'senior-analyst');
    assert.equal(maxDifficulty(poly, config), 3);
  });
});
