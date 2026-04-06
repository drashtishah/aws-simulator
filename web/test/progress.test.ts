const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  getQuestionTypes,
  currentRank,
  normalizeHexagon,
  parseCatalog,
  serviceProgress
} = require('../lib/progress');

describe('getQuestionTypes', () => {
  it('has six types', () => {
    assert.equal(getQuestionTypes().length, 6);
  });

  it('includes all expected types', () => {
    const types = getQuestionTypes();
    for (const t of ['gather', 'diagnose', 'correlate', 'impact', 'trace', 'fix']) {
      assert.ok(types.includes(t), t + ' should be in question types');
    }
  });
});

describe('currentRank (via progress.js wrapper)', () => {
  it('returns Responder for empty polygon', () => {
    assert.equal(currentRank({}), 'Responder');
  });

  it('returns Responder for null', () => {
    assert.equal(currentRank(null), 'Responder');
  });

  it('returns Investigator when gather >= 3 and diagnose >= 3', () => {
    assert.equal(currentRank({ gather: 3, diagnose: 3 }), 'Investigator');
  });

  it('returns Analyst when correlate >= 3 and 3 axes >= 3', () => {
    assert.equal(currentRank({ gather: 3, diagnose: 3, correlate: 3 }), 'Analyst');
  });

  it('returns Analyst when all 6 axes >= 3', () => {
    const poly = { gather: 3, diagnose: 3, correlate: 3, impact: 3, trace: 3, fix: 3 };
    assert.equal(currentRank(poly), 'Analyst');
  });

  it('returns Chaos Architect when all 6 axes >= 6', () => {
    const poly = { gather: 6, diagnose: 6, correlate: 6, impact: 6, trace: 6, fix: 6 };
    assert.equal(currentRank(poly), 'Chaos Architect');
  });

  it('returns Senior Commander, not Chaos Architect, at 5', () => {
    const poly = { gather: 5, diagnose: 5, correlate: 5, impact: 5, trace: 5, fix: 5 };
    assert.equal(currentRank(poly), 'Senior Commander');
  });

  it('returns Responder when only one axis is high', () => {
    assert.equal(currentRank({ gather: 10 }), 'Responder');
  });
});

describe('normalizeHexagon (via progress.js wrapper)', () => {
  it('normalizes to 0-10 scale by default', () => {
    const poly = { gather: 10, diagnose: 5, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const norm = normalizeHexagon(poly);
    assert.equal(norm.gather, 10);
    assert.equal(norm.diagnose, 5);
    assert.equal(norm.correlate, 0);
  });

  it('handles empty polygon', () => {
    const norm = normalizeHexagon({});
    for (const t of getQuestionTypes()) {
      assert.equal(norm[t], 0);
    }
  });

  it('normalizes to custom scale', () => {
    const poly = { gather: 4, diagnose: 2, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const norm = normalizeHexagon(poly, 5);
    assert.equal(norm.gather, 5);
    assert.equal(norm.diagnose, 2.5);
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
