import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseClassificationJsonl, ClassificationSchemaError } from '../lib/classification-schema.js';

describe('parseClassificationJsonl', () => {
  it('parses valid JSONL with two rows', () => {
    const text = [
      JSON.stringify({ index: 1, question_type: 'gather', effectiveness: 4 }),
      JSON.stringify({ index: 2, question_type: 'diagnose', effectiveness: 6 }),
    ].join('\n');
    const rows = parseClassificationJsonl(text);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].index, 1);
    assert.equal(rows[0].question_type, 'gather');
    assert.equal(rows[0].effectiveness, 4);
    assert.equal(rows[1].question_type, 'diagnose');
  });

  it('skips blank lines', () => {
    const text = '\n' + JSON.stringify({ index: 1, question_type: 'fix', effectiveness: 5 }) + '\n\n';
    const rows = parseClassificationJsonl(text);
    assert.equal(rows.length, 1);
  });

  it('throws ClassificationSchemaError on missing index', () => {
    const text = JSON.stringify({ question_type: 'gather', effectiveness: 3 });
    assert.throws(
      () => parseClassificationJsonl(text),
      ClassificationSchemaError,
      'missing index must throw'
    );
  });

  it('throws ClassificationSchemaError on missing question_type', () => {
    const text = JSON.stringify({ index: 1, effectiveness: 3 });
    assert.throws(
      () => parseClassificationJsonl(text),
      ClassificationSchemaError,
      'missing question_type must throw'
    );
  });

  it('throws ClassificationSchemaError on missing effectiveness', () => {
    const text = JSON.stringify({ index: 1, question_type: 'trace' });
    assert.throws(
      () => parseClassificationJsonl(text),
      ClassificationSchemaError,
      'missing effectiveness must throw'
    );
  });

  it('throws ClassificationSchemaError on unknown question_type', () => {
    const text = JSON.stringify({ index: 1, question_type: 'unknown', effectiveness: 3 });
    assert.throws(
      () => parseClassificationJsonl(text),
      ClassificationSchemaError,
      'unknown question_type must throw'
    );
  });

  it('deduplicates rows with the same index, keeping last', () => {
    const text = [
      JSON.stringify({ index: 1, question_type: 'gather', effectiveness: 3 }),
      JSON.stringify({ index: 1, question_type: 'diagnose', effectiveness: 5 }),
    ].join('\n');
    const rows = parseClassificationJsonl(text);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].question_type, 'diagnose');
    assert.equal(rows[0].effectiveness, 5);
  });

  it('accepts all valid question_type values', () => {
    const types = ['gather', 'diagnose', 'correlate', 'impact', 'trace', 'fix'];
    for (const qt of types) {
      const text = JSON.stringify({ index: 1, question_type: qt, effectiveness: 4 });
      const rows = parseClassificationJsonl(text);
      assert.equal(rows[0].question_type, qt);
    }
  });
});
