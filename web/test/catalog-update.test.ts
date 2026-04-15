import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { updateCatalogFromClassification } from '../lib/post-session-renderer.js';
import type { CatalogRow } from '../lib/post-session-renderer.js';
import type { ClassificationRow } from '../lib/classification-schema.js';
import { parseCatalogCsv } from '../lib/claude-process.js';

function makeRow(overrides: Partial<ClassificationRow>): ClassificationRow {
  return {
    index: 0,
    question_type: 'gather',
    effectiveness: 6,
    services: [],
    concepts: [],
    beats: [],
    uncertainty: false,
    note: '',
    ...overrides,
  };
}

describe('updateCatalogFromClassification service filter', () => {
  it('only touches catalog rows whose service appears in classification services', () => {
    const catalog: CatalogRow[] = [
      { service: 'ec2', sims_completed: 0, knowledge_score: 0, last_practiced: '' },
      { service: 'vpc', sims_completed: 0, knowledge_score: 0, last_practiced: '' },
      { service: 'lambda', sims_completed: 0, knowledge_score: 0, last_practiced: '' },
      { service: 's3', sims_completed: 0, knowledge_score: 0, last_practiced: '' },
      { service: 'iam', sims_completed: 0, knowledge_score: 0, last_practiced: '' },
    ];
    const rows: ClassificationRow[] = [
      makeRow({ services: ['ec2', 'vpc'], question_type: 'gather' }),
      makeRow({ services: ['ec2'], question_type: 'diagnose' }),
    ];

    const updated = updateCatalogFromClassification(catalog, rows, 'sim-a', false);

    // Touched rows: sims_completed bumped.
    const ec2 = updated.find(r => r.service === 'ec2')!;
    const vpc = updated.find(r => r.service === 'vpc')!;
    assert.equal(ec2.sims_completed, 1);
    assert.equal(vpc.sims_completed, 1);

    // Untouched rows return the SAME reference (pass-through).
    const lambdaIdx = catalog.findIndex(r => r.service === 'lambda');
    const s3Idx = catalog.findIndex(r => r.service === 's3');
    const iamIdx = catalog.findIndex(r => r.service === 'iam');
    assert.strictEqual(updated[lambdaIdx], catalog[lambdaIdx], 'lambda row must be same reference');
    assert.strictEqual(updated[s3Idx], catalog[s3Idx], 's3 row must be same reference');
    assert.strictEqual(updated[iamIdx], catalog[iamIdx], 'iam row must be same reference');
  });

  it('defensively coerces NaN numeric fields to 0 via ?? 0', () => {
    const catalog: CatalogRow[] = [
      {
        service: 'ec2',
        sims_completed: NaN as unknown as number,
        knowledge_score: NaN as unknown as number,
        last_practiced: '',
      },
    ];
    const rows: ClassificationRow[] = [
      makeRow({ services: ['ec2'], effectiveness: 6 }),
    ];

    const updated = updateCatalogFromClassification(catalog, rows, 'sim-b', false);

    const ec2 = updated[0]!;
    assert.ok(Number.isFinite(ec2.sims_completed), 'sims_completed must be finite');
    assert.ok(Number.isFinite(ec2.knowledge_score), 'knowledge_score must be finite');
    assert.equal(ec2.sims_completed, 1);
  });
});

describe('parseCatalogCsv NaN coercion', () => {
  it('treats blank numeric fields as 0', () => {
    const text = 'service,sims_completed,knowledge_score,last_practiced\nec2,,,';
    const [row] = parseCatalogCsv(text);
    assert.ok(row, 'expected parsed row');
    assert.equal(row!.sims_completed, 0);
    assert.equal(row!.knowledge_score, 0);
    assert.ok(!Number.isNaN(row!.sims_completed));
    assert.ok(!Number.isNaN(row!.knowledge_score));
  });

  it('treats literal "NaN" strings as 0, not NaN', () => {
    const text = 'service,sims_completed,knowledge_score,last_practiced\nec2,NaN,NaN,2026-04-15';
    const [row] = parseCatalogCsv(text);
    assert.ok(row, 'expected parsed row');
    assert.equal(row!.sims_completed, 0);
    assert.equal(row!.knowledge_score, 0);
    assert.ok(!Number.isNaN(row!.sims_completed));
    assert.ok(!Number.isNaN(row!.knowledge_score));
  });
});
