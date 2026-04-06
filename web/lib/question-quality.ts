export interface QuestionScore {
  specificity: number;
  relevance: number;
  building: number;
  targeting: number;
}

export interface QuestionQuality {
  avg_specificity: number;
  avg_relevance: number;
  avg_building: number;
  avg_targeting: number;
  avg_overall: number;
  total_questions_scored: number;
  last_5_session_avgs: number[];
}

export interface Profile {
  question_quality: QuestionQuality;
  [key: string]: unknown;
}

/**
 * Compute the quality factor for scoring.
 * Clamps avgQuality/8 between 0.25 and 1.0.
 */
export function qualityFactor(avgQuality: number): number {
  return Math.min(1.0, Math.max(0.25, avgQuality / 8));
}

/**
 * Update the running question quality averages in a profile.
 * Returns a new profile object with updated question_quality.
 */
export function updateRunningAverage(profile: Profile, sessionScores: QuestionScore[]): Profile {
  const qc: QuestionQuality = { ...profile.question_quality };
  const prevTotal = qc.total_questions_scored || 0;
  const newCount = sessionScores.length;
  const newTotal = prevTotal + newCount;

  if (newCount === 0) return { ...profile, question_quality: qc };

  // Compute session averages
  const sessionAvg = {
    specificity: sessionScores.reduce((s, q) => s + q.specificity, 0) / newCount,
    relevance: sessionScores.reduce((s, q) => s + q.relevance, 0) / newCount,
    building: sessionScores.reduce((s, q) => s + q.building, 0) / newCount,
    targeting: sessionScores.reduce((s, q) => s + q.targeting, 0) / newCount,
  };
  const sessionOverall = sessionAvg.specificity + sessionAvg.relevance + sessionAvg.building + sessionAvg.targeting;

  // Weighted running average
  qc.avg_specificity = (qc.avg_specificity * prevTotal + sessionAvg.specificity * newCount) / newTotal;
  qc.avg_relevance = (qc.avg_relevance * prevTotal + sessionAvg.relevance * newCount) / newTotal;
  qc.avg_building = (qc.avg_building * prevTotal + sessionAvg.building * newCount) / newTotal;
  qc.avg_targeting = (qc.avg_targeting * prevTotal + sessionAvg.targeting * newCount) / newTotal;
  qc.avg_overall = qc.avg_specificity + qc.avg_relevance + qc.avg_building + qc.avg_targeting;

  qc.total_questions_scored = newTotal;

  // Maintain last 5 session averages
  const last5 = [...(qc.last_5_session_avgs || []), sessionOverall];
  qc.last_5_session_avgs = last5.slice(-5);

  return { ...profile, question_quality: qc };
}
