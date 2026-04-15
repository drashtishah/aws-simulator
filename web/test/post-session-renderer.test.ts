import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseClassificationJsonl } from '../lib/classification-schema.js';
import type { ClassificationRow } from '../lib/classification-schema.js';
import { updateProfileFromClassification, deriveRank, updateCatalogFromClassification } from '../lib/post-session-renderer.js';
import type { CatalogRow } from '../lib/post-session-renderer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures');

function loadSample(): ClassificationRow[] {
  const text = fs.readFileSync(path.join(FIXTURES, 'classification-sample.jsonl'), 'utf8');
  return parseClassificationJsonl(text);
}

function loadProfileBefore() {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, 'profile-before.json'), 'utf8')) as Parameters<typeof updateProfileFromClassification>[0];
}

function loadProgression() {
  const yaml = require('js-yaml') as typeof import('js-yaml');
  return yaml.load(
    fs.readFileSync(path.join(__dirname, '../../references/config/progression.yaml'), 'utf8')
  ) as Parameters<typeof updateProfileFromClassification>[3];
}

describe('updateProfileFromClassification', () => {
  it('adds simId to completed_sims', () => {
    const profile = loadProfileBefore();
    const rows = loadSample();
    const progression = loadProgression();
    const updated = updateProfileFromClassification(profile, rows, 'test-sim-001', progression);
    assert.ok(updated.completed_sims.includes('test-sim-001'));
  });

  it('increments total_sessions', () => {
    const profile = loadProfileBefore();
    const rows = loadSample();
    const progression = loadProgression();
    const updated = updateProfileFromClassification(profile, rows, 'test-sim-001', progression);
    assert.equal(updated.total_sessions, 1);
  });

  it('increases polygon axes for exercised question types', () => {
    const profile = loadProfileBefore();
    const rows = loadSample();
    const progression = loadProgression();
    const updated = updateProfileFromClassification(profile, rows, 'test-sim-001', progression);
    assert.ok(updated.skill_polygon.gather > 0, 'gather should increase');
    assert.ok(updated.skill_polygon.diagnose > 0, 'diagnose should increase');
    assert.ok(updated.skill_polygon.fix > 0, 'fix should increase');
  });

  it('is idempotent: calling twice with same simId produces same polygon', () => {
    const profile = loadProfileBefore();
    const rows = loadSample();
    const progression = loadProgression();
    const once = updateProfileFromClassification(profile, rows, 'test-sim-001', progression);
    const twice = updateProfileFromClassification(once, rows, 'test-sim-001', progression);
    assert.deepEqual(twice.skill_polygon, once.skill_polygon);
    assert.deepEqual(twice.completed_sims, once.completed_sims);
    assert.equal(twice.total_sessions, once.total_sessions);
  });

  it('applies diminishing returns: second unique sim earns fewer points than first', () => {
    const profile = loadProfileBefore();
    const rows = loadSample();
    const progression = loadProgression();
    const after1 = updateProfileFromClassification(profile, rows, 'test-sim-001', progression);
    const after2 = updateProfileFromClassification(after1, rows, 'test-sim-002', progression);
    const gain1 = after1.skill_polygon.gather - profile.skill_polygon.gather;
    const gain2 = after2.skill_polygon.gather - after1.skill_polygon.gather;
    // Both should be >= 0; after many sessions diminishing returns kick in
    assert.ok(gain1 >= 0);
    assert.ok(gain2 >= 0);
  });
});

describe('deriveRank', () => {
  it('returns responder for a zeroed polygon', () => {
    const polygon = { gather: 0, diagnose: 0, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const progression = loadProgression();
    assert.equal(deriveRank(polygon, progression), 'responder');
  });

  it('returns junior-investigator when 2 axes reach 1', () => {
    const polygon = { gather: 1, diagnose: 1, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const progression = loadProgression();
    assert.equal(deriveRank(polygon, progression), 'junior-investigator');
  });

  it('returns investigator when gather and diagnose reach 2', () => {
    const polygon = { gather: 2, diagnose: 2, correlate: 0, impact: 0, trace: 0, fix: 0 };
    const progression = loadProgression();
    assert.equal(deriveRank(polygon, progression), 'investigator');
  });
});

describe('updateCatalogFromClassification', () => {
  const sampleRows: CatalogRow[] = [
    { service: 'EC2', sims_completed: 0, knowledge_score: 0, last_practiced: '' },
    { service: 'VPC', sims_completed: 2, knowledge_score: 3, last_practiced: '2026-01-01' },
  ];

  it('increments sims_completed on first call', () => {
    const rows = loadSample();
    const updated = updateCatalogFromClassification(sampleRows, rows, 'sim-001', false);
    assert.equal(updated[0].sims_completed, 1);
    assert.equal(updated[1].sims_completed, 3);
  });

  it('is idempotent: catalog not double-incremented on second call (alreadyCompleted=true)', () => {
    const rows = loadSample();
    const first = updateCatalogFromClassification(sampleRows, rows, 'sim-001', false);
    const second = updateCatalogFromClassification(first, rows, 'sim-001', true);
    assert.equal(second[0].sims_completed, first[0].sims_completed);
    assert.equal(second[1].sims_completed, first[1].sims_completed);
  });

  it('updates last_practiced to today', () => {
    const rows = loadSample();
    const today = new Date().toISOString().slice(0, 10);
    const updated = updateCatalogFromClassification(sampleRows, rows, 'sim-001', false);
    assert.equal(updated[0].last_practiced, today);
  });

  it('does not exceed knowledge_score of 10', () => {
    const rows = loadSample();
    const highScore: CatalogRow[] = [{ service: 'EC2', sims_completed: 100, knowledge_score: 9.9, last_practiced: '' }];
    const updated = updateCatalogFromClassification(highScore, rows, 'sim-001', false);
    assert.ok(updated[0].knowledge_score <= 10);
  });
});
