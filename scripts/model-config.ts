import fs from 'node:fs';
import path from 'node:path';

export type EffortLevel = 'low' | 'medium' | 'high' | 'max';

export type StageKey =
  | 'planner'
  | 'critic'
  | 'implementer'
  | 'verifier'
  | 'evaluator'
  | 'play'
  | 'post_session'
  | 'agent_test_runner';

export interface StageConfig {
  model: string;
  effort: EffortLevel | null;
}

export type ModelConfig = Record<StageKey, StageConfig>;

const CONFIG_PATH = path.resolve(__dirname, 'model-config.json');

export const MODEL_CONFIG: ModelConfig = JSON.parse(
  fs.readFileSync(CONFIG_PATH, 'utf8'),
) as ModelConfig;
