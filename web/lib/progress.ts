import path from 'node:path';
import * as progression from './progression.js';
import type { ProgressionConfig, Polygon } from './progression.js';

const CONFIG_PATH: string = path.join(__dirname, '..', '..', 'references', 'config', 'progression.yaml');
let _config: ProgressionConfig | undefined;

function getConfig(): ProgressionConfig {
  if (!_config) {
    _config = progression.loadConfig(CONFIG_PATH);
  }
  return _config;
}

function getQuestionTypes(): string[] {
  return progression.axisNames(getConfig());
}

// profile is optional so legacy callers keep working, but passing it in
// activates the quality_gate check (min_sessions_at_rank, avg_question_quality).
// Without the profile, polygon-only gates pass and the UI may show a higher
// rank than the post-session agent agrees with.
function currentRank(polygon: Polygon | undefined, profile?: Parameters<typeof progression.currentRank>[2]): string {
  return progression.currentRank(polygon ?? {}, getConfig(), profile).title;
}

function normalizeHexagon(polygon: Polygon | undefined, maxScale?: number): Polygon {
  return progression.normalizePolygon(polygon ?? {}, getConfig(), maxScale ?? 10);
}

export {
  getConfig,
  getQuestionTypes,
  currentRank,
  normalizeHexagon,
  progression,
};
