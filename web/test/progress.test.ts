import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getQuestionTypes, currentRank, normalizeHexagon, parseCatalog, serviceProgress } from '../lib/progress';


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

  // Regression: the wrapper must pipe the player profile through so that
  // quality_gate checks (min_sessions_at_rank, avg_question_quality) run.
  // Without this, polygon alone promotes the player and the UI disagrees
  // with what the post-session agent wrote to rank_title.
  describe('quality gate (regression)', () => {
    it('passes polygon alone to Junior Investigator when profile omitted', () => {
      const poly = { gather: 1, trace: 1, fix: 1 };
      assert.equal(currentRank(poly), 'Junior Investigator');
    });

    it('blocks Junior Investigator when sessions_at_current_rank below gate', () => {
      const poly = { gather: 1, trace: 1, fix: 1 };
      // gate: avg_question_quality: 2, min_sessions_at_rank: 15
      const profile = { question_quality: { avg_overall: 6 }, sessions_at_current_rank: 1 };
      assert.equal(currentRank(poly, profile), 'Responder');
    });

    it('blocks Junior Investigator when avg_question_quality below gate', () => {
      const poly = { gather: 1, trace: 1, fix: 1 };
      const profile = { question_quality: { avg_overall: 1 }, sessions_at_current_rank: 50 };
      assert.equal(currentRank(poly, profile), 'Responder');
    });

    it('promotes to Junior Investigator when both gates pass', () => {
      const poly = { gather: 1, trace: 1, fix: 1 };
      const profile = { question_quality: { avg_overall: 6 }, sessions_at_current_rank: 15 };
      assert.equal(currentRank(poly, profile), 'Junior Investigator');
    });
  });
});

describe('normalizeHexagon (via progress.js wrapper)', () => {
  it('normalizes to 0-10 scale against top rank threshold', () => {
    const poly = { gather: 6, diagnose: 3, correlate: 0, impact: 0, trace: 0, fix: 0 };
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
    const poly = { gather: 6, diagnose: 3, correlate: 0, impact: 0, trace: 0, fix: 0 };
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
