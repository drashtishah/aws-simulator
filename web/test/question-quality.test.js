const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { qualityFactor, updateRunningAverage } = require('../lib/question-quality');

describe('qualityFactor', () => {
  it('returns 0.25 when avgQuality is 0', () => {
    assert.equal(qualityFactor(0), 0.25);
  });

  it('returns 0.25 when avgQuality is negative', () => {
    assert.equal(qualityFactor(-5), 0.25);
  });

  it('returns 1.0 when avgQuality is 8 or above', () => {
    assert.equal(qualityFactor(8), 1.0);
    assert.equal(qualityFactor(10), 1.0);
  });

  it('returns 0.5 when avgQuality is 4', () => {
    assert.equal(qualityFactor(4), 0.5);
  });

  it('returns intermediate values proportionally', () => {
    const result = qualityFactor(2);
    assert.equal(result, 0.25);
  });
});

describe('updateRunningAverage', () => {
  const baseProfile = {
    question_quality: {
      avg_specificity: 0,
      avg_relevance: 0,
      avg_building: 0,
      avg_targeting: 0,
      avg_overall: 0,
      total_questions_scored: 0,
      last_5_session_avgs: []
    }
  };

  it('returns unchanged profile when sessionScores is empty', () => {
    const result = updateRunningAverage(baseProfile, []);
    assert.equal(result.question_quality.total_questions_scored, 0);
  });

  it('computes averages for a single session score', () => {
    const scores = [{ specificity: 2, relevance: 2, building: 2, targeting: 2 }];
    const result = updateRunningAverage(baseProfile, scores);
    assert.equal(result.question_quality.avg_specificity, 2);
    assert.equal(result.question_quality.avg_relevance, 2);
    assert.equal(result.question_quality.avg_overall, 8);
    assert.equal(result.question_quality.total_questions_scored, 1);
  });

  it('computes weighted running average across multiple calls', () => {
    const scores1 = [{ specificity: 2, relevance: 2, building: 2, targeting: 2 }];
    const result1 = updateRunningAverage(baseProfile, scores1);
    const scores2 = [{ specificity: 0, relevance: 0, building: 0, targeting: 0 }];
    const result2 = updateRunningAverage(result1, scores2);
    assert.equal(result2.question_quality.avg_specificity, 1);
    assert.equal(result2.question_quality.total_questions_scored, 2);
  });

  it('maintains last 5 session averages', () => {
    let profile = baseProfile;
    for (let i = 0; i < 7; i++) {
      profile = updateRunningAverage(profile, [
        { specificity: i, relevance: i, building: i, targeting: i }
      ]);
    }
    assert.equal(profile.question_quality.last_5_session_avgs.length, 5);
  });

  it('does not mutate the original profile', () => {
    const scores = [{ specificity: 1, relevance: 1, building: 1, targeting: 1 }];
    const result = updateRunningAverage(baseProfile, scores);
    assert.equal(baseProfile.question_quality.total_questions_scored, 0);
    assert.notEqual(result, baseProfile);
  });
});
