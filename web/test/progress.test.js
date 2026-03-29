const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  QUESTION_TYPES,
  currentRank,
  normalizeHexagon,
  levelTitle,
  parseCatalog,
  serviceProgress
} = require('../lib/progress');

describe('QUESTION_TYPES', () => {
  it('has six types', () => {
    assert.equal(QUESTION_TYPES.length, 6);
  });

  it('includes all expected types', () => {
    for (const t of ['gather', 'diagnose', 'correlate', 'impact', 'trace', 'fix']) {
      assert.ok(QUESTION_TYPES.includes(t), t + ' should be in QUESTION_TYPES');
    }
  });
});

describe('currentRank', () => {
  it('returns Pager Duty Intern for empty hexagon', () => {
    assert.equal(currentRank({}), 'Pager Duty Intern');
  });

  it('returns Pager Duty Intern for null', () => {
    assert.equal(currentRank(null), 'Pager Duty Intern');
  });

  it('returns Config Whisperer when gather >= 3 and diagnose >= 3', () => {
    assert.equal(currentRank({ gather: 3, diagnose: 3 }), 'Config Whisperer');
  });

  it('returns Root Cause Wrangler when correlate >= 3 and 3 axes >= 3', () => {
    assert.equal(currentRank({ gather: 3, diagnose: 3, correlate: 3 }), 'Root Cause Wrangler');
  });

  it('returns Incident Commander when all 6 axes >= 3', () => {
    const hex = { gather: 3, diagnose: 3, correlate: 3, impact: 3, trace: 3, fix: 3 };
    assert.equal(currentRank(hex), 'Incident Commander');
  });

  it('returns Chaos Architect when all 6 axes >= 6', () => {
    const hex = { gather: 6, diagnose: 6, correlate: 6, impact: 6, trace: 6, fix: 6 };
    assert.equal(currentRank(hex), 'Chaos Architect');
  });

  it('returns Incident Commander, not Chaos Architect, at 5', () => {
    const hex = { gather: 5, diagnose: 5, correlate: 5, impact: 5, trace: 5, fix: 5 };
    assert.equal(currentRank(hex), 'Incident Commander');
  });

  it('returns Pager Duty Intern when only one axis is high', () => {
    assert.equal(currentRank({ gather: 10 }), 'Pager Duty Intern');
  });
});

describe('normalizeHexagon', () => {
  it('normalizes to 0-10 scale by default', () => {
    const hex = { gather: 10, diagnose: 5, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const norm = normalizeHexagon(hex);
    assert.equal(norm.gather, 10);
    assert.equal(norm.diagnose, 5);
    assert.equal(norm.correlate, 0);
  });

  it('handles empty hexagon', () => {
    const norm = normalizeHexagon({});
    for (const t of QUESTION_TYPES) {
      assert.equal(norm[t], 0);
    }
  });

  it('normalizes to custom scale', () => {
    const hex = { gather: 4, diagnose: 2, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const norm = normalizeHexagon(hex, 5);
    assert.equal(norm.gather, 5);
    assert.equal(norm.diagnose, 2.5);
  });
});

describe('levelTitle', () => {
  it('returns title for level 1', () => {
    assert.equal(levelTitle(1), 'Pager Duty Intern');
  });

  it('returns title for level 3', () => {
    assert.equal(levelTitle(3), 'Root Cause Wrangler');
  });

  it('returns highest title for levels beyond max', () => {
    assert.equal(levelTitle(99), 'Chaos Architect');
  });

  it('returns level 1 title for zero or negative', () => {
    assert.equal(levelTitle(0), 'Pager Duty Intern');
    assert.equal(levelTitle(-1), 'Pager Duty Intern');
  });
});

describe('parseCatalog', () => {
  it('parses CSV content into service objects', () => {
    const csv = 'service,full_name,category,cert_relevance,knowledge_score,sims_completed,last_practiced,notes\n' +
      'ec2,Amazon EC2,compute,SAA-C03,3,2,2026-03-25,some notes\n' +
      's3,Amazon S3,storage,SAA-C03,0,0,,\n';
    const result = parseCatalog(csv);
    assert.equal(result.length, 2);
    assert.equal(result[0].service, 'ec2');
    assert.equal(result[0].knowledge_score, 3);
    assert.equal(result[0].sims_completed, 2);
    assert.equal(result[1].service, 's3');
    assert.equal(result[1].knowledge_score, 0);
  });

  it('handles empty CSV', () => {
    const result = parseCatalog('service,full_name,category,cert_relevance,knowledge_score,sims_completed,last_practiced,notes\n');
    assert.equal(result.length, 0);
  });
});

describe('serviceProgress', () => {
  it('separates practiced and unpracticed services', () => {
    const catalog = [
      { service: 'ec2', full_name: 'Amazon EC2', category: 'compute', knowledge_score: 3, sims_completed: 2 },
      { service: 's3', full_name: 'Amazon S3', category: 'storage', knowledge_score: 0, sims_completed: 0 },
      { service: 'lambda', full_name: 'AWS Lambda', category: 'serverless', knowledge_score: 6, sims_completed: 5 }
    ];
    const result = serviceProgress(catalog);
    assert.equal(result.practiced.length, 2);
    assert.equal(result.unpracticed.length, 1);
    assert.equal(result.unpracticed[0].service, 's3');
  });

  it('sorts practiced by knowledge_score descending', () => {
    const catalog = [
      { service: 'ec2', full_name: 'Amazon EC2', category: 'compute', knowledge_score: 3, sims_completed: 2 },
      { service: 'lambda', full_name: 'AWS Lambda', category: 'serverless', knowledge_score: 6, sims_completed: 5 }
    ];
    const result = serviceProgress(catalog);
    assert.equal(result.practiced[0].service, 'lambda');
    assert.equal(result.practiced[1].service, 'ec2');
  });
});
