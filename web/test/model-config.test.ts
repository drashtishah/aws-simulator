import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { MODEL_CONFIG, type StageKey, type EffortLevel } from '../../scripts/model-config';

const ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_PATH = path.join(ROOT, 'scripts', 'model-config.json');

const REQUIRED_STAGES: StageKey[] = [
  'planner',
  'critic',
  'implementer',
  'verifier',
  'evaluator',
  'play',
  'post_session',
  'agent_test_runner',
];

const VALID_EFFORTS: Array<EffortLevel | null> = ['low', 'medium', 'high', 'max', null];

const MODEL_ID_SHAPE = /^claude-(sonnet|opus|haiku)-\d+-\d+$/;

describe('model-config', () => {
  it('scripts/model-config.json exists', () => {
    assert.ok(fs.existsSync(CONFIG_PATH));
  });

  it('JSON file parses', () => {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    assert.doesNotThrow(() => JSON.parse(raw));
  });

  it('loader export matches JSON contents', () => {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    assert.deepEqual(MODEL_CONFIG, raw);
  });

  for (const stage of REQUIRED_STAGES) {
    it(`has entry for ${stage}`, () => {
      assert.ok(stage in MODEL_CONFIG, `missing stage: ${stage}`);
      const entry = MODEL_CONFIG[stage];
      assert.equal(typeof entry.model, 'string');
      assert.ok(entry.model.length > 0, `empty model for ${stage}`);
      assert.ok(MODEL_ID_SHAPE.test(entry.model), `bad model id shape: ${entry.model}`);
      assert.ok(
        VALID_EFFORTS.includes(entry.effort),
        `invalid effort for ${stage}: ${entry.effort}`,
      );
    });
  }
});
