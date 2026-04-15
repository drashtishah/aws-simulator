import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  aggregateServiceStats,
  aggregateConceptStats,
  loadSessions,
} from '../lib/vault-aggregation.js';

const TMP_ROOT = path.join(__dirname, '.tmp', `vault-agg-${process.pid}`);
const SESSIONS_DIR = path.join(TMP_ROOT, 'sessions');

const SESSIONS = [
  {
    name: '2026-04-01-foo',
    rows: [
      { index: 1, question_type: 'gather', effectiveness: 4, services: ['ec2', 'vpc'], concepts: ['security-groups'], beats: [], uncertainty: false, note: '' },
      { index: 2, question_type: 'diagnose', effectiveness: 6, services: ['ec2'], concepts: ['default-deny'], beats: [], uncertainty: false, note: '' },
    ],
  },
  {
    name: '2026-04-05-bar',
    rows: [
      { index: 1, question_type: 'gather', effectiveness: 5, services: ['s3'], concepts: ['security-groups'], beats: [], uncertainty: false, note: '' },
      { index: 2, question_type: 'correlate', effectiveness: 7, services: ['ec2', 's3'], concepts: ['security-groups'], beats: [], uncertainty: false, note: '' },
    ],
  },
  {
    name: '2026-04-10-baz',
    rows: [
      { index: 1, question_type: 'fix', effectiveness: 8, services: ['ec2', 'vpc'], concepts: ['default-deny'], beats: [], uncertainty: false, note: '' },
      { index: 2, question_type: 'impact', effectiveness: 5, services: ['vpc'], concepts: [], beats: [], uncertainty: false, note: '' },
      { index: 3, question_type: 'trace', effectiveness: 4, services: [], concepts: ['security-groups'], beats: [], uncertainty: false, note: '' },
    ],
  },
];

before(() => {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  for (const s of SESSIONS) {
    const d = path.join(SESSIONS_DIR, s.name);
    fs.mkdirSync(d, { recursive: true });
    const text = s.rows.map(r => JSON.stringify(r)).join('\n') + '\n';
    fs.writeFileSync(path.join(d, 'classification.jsonl'), text, 'utf8');
  }
});

after(() => {
  try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); } catch {}
});

describe('aggregateServiceStats', () => {
  it('counts sessions where the service appears in any row', () => {
    const stats = aggregateServiceStats('ec2', SESSIONS_DIR);
    // ec2 appears in all three sessions (rows 1,2 of foo; row 2 of bar; row 1 of baz)
    assert.equal(stats.sessionCount, 3);
  });

  it('avgEffectiveness is the mean of effectiveness in rows that mention the service', () => {
    const stats = aggregateServiceStats('ec2', SESSIONS_DIR);
    // ec2 rows: foo#1 (4), foo#2 (6), bar#2 (7), baz#1 (8). mean = 25/4 = 6.25
    assert.equal(stats.avgEffectiveness, 6.25);
  });

  it('recentAvgEffectiveness equals avgEffectiveness when there are exactly 3 sessions', () => {
    const stats = aggregateServiceStats('ec2', SESSIONS_DIR);
    assert.equal(stats.recentAvgEffectiveness, 6.25);
  });

  it('coAppearingServices counts per-session, never includes target', () => {
    const stats = aggregateServiceStats('ec2', SESSIONS_DIR);
    // ec2 sessions: foo (co: vpc), bar (co: s3), baz (co: vpc).
    // vpc: foo + baz = 2. s3: bar = 1. ec2 must not appear.
    assert.equal(stats.coAppearingServices['vpc'], 2);
    assert.equal(stats.coAppearingServices['s3'], 1);
    assert.equal(stats.coAppearingServices['ec2'], undefined);
  });

  it('coAppearingConcepts counts per-session', () => {
    const stats = aggregateServiceStats('ec2', SESSIONS_DIR);
    // ec2 sessions: foo (concepts across all rows: security-groups, default-deny),
    // bar (security-groups), baz (default-deny, security-groups)
    // security-groups: foo + bar + baz = 3. default-deny: foo + baz = 2.
    assert.equal(stats.coAppearingConcepts['security-groups'], 3);
    assert.equal(stats.coAppearingConcepts['default-deny'], 2);
  });

  it('sessionLinks has one entry per session with date prefix', () => {
    const stats = aggregateServiceStats('ec2', SESSIONS_DIR);
    assert.equal(stats.sessionLinks.length, 3);
    const slugs = stats.sessionLinks.map(l => l.sessionSlug).sort();
    assert.deepEqual(slugs, ['2026-04-01-foo', '2026-04-05-bar', '2026-04-10-baz']);
    const fooLink = stats.sessionLinks.find(l => l.sessionSlug === '2026-04-01-foo');
    assert.equal(fooLink!.sessionDate, '2026-04-01');
  });

  it('returns zero-state when service is not present', () => {
    const stats = aggregateServiceStats('not-a-real-service', SESSIONS_DIR);
    assert.equal(stats.sessionCount, 0);
    assert.equal(stats.avgEffectiveness, 0);
    assert.equal(stats.recentAvgEffectiveness, 0);
    assert.deepEqual(stats.coAppearingServices, {});
    assert.deepEqual(stats.coAppearingConcepts, {});
    assert.deepEqual(stats.sessionLinks, []);
  });

  it('returns zero-state when sessionsDir does not exist', () => {
    const stats = aggregateServiceStats('ec2', path.join(TMP_ROOT, 'does-not-exist'));
    assert.equal(stats.sessionCount, 0);
    assert.equal(stats.avgEffectiveness, 0);
    assert.equal(stats.recentAvgEffectiveness, 0);
    assert.deepEqual(stats.coAppearingServices, {});
    assert.deepEqual(stats.coAppearingConcepts, {});
    assert.deepEqual(stats.sessionLinks, []);
  });
});

describe('aggregateConceptStats', () => {
  it('counts sessions where the concept appears in any row', () => {
    const stats = aggregateConceptStats('security-groups', SESSIONS_DIR);
    // security-groups appears in all three sessions (foo#1, bar#1+#2, baz#3).
    assert.equal(stats.sessionCount, 3);
  });

  it('avgEffectiveness is the mean across matching rows', () => {
    const stats = aggregateConceptStats('security-groups', SESSIONS_DIR);
    // security-groups rows: foo#1 (4), bar#1 (5), bar#2 (7), baz#3 (4). mean = 20/4 = 5
    assert.equal(stats.avgEffectiveness, 5);
  });

  it('coAppearingServices counts per-session', () => {
    const stats = aggregateConceptStats('security-groups', SESSIONS_DIR);
    // foo union services: ec2, vpc. bar: s3, ec2. baz: ec2, vpc, (row3 empty).
    // ec2: 3, vpc: 2, s3: 1.
    assert.equal(stats.coAppearingServices['ec2'], 3);
    assert.equal(stats.coAppearingServices['vpc'], 2);
    assert.equal(stats.coAppearingServices['s3'], 1);
  });

  it('coAppearingConcepts excludes the target concept', () => {
    const stats = aggregateConceptStats('security-groups', SESSIONS_DIR);
    assert.equal(stats.coAppearingConcepts['security-groups'], undefined);
    // default-deny is in foo and baz (both security-groups sessions).
    assert.equal(stats.coAppearingConcepts['default-deny'], 2);
  });

  it('returns zero-state when concept is absent', () => {
    const stats = aggregateConceptStats('no-such-concept', SESSIONS_DIR);
    assert.equal(stats.sessionCount, 0);
    assert.equal(stats.avgEffectiveness, 0);
    assert.deepEqual(stats.sessionLinks, []);
  });

  it('returns zero-state when sessionsDir does not exist', () => {
    const stats = aggregateConceptStats('security-groups', path.join(TMP_ROOT, 'does-not-exist'));
    assert.equal(stats.sessionCount, 0);
    assert.deepEqual(stats.sessionLinks, []);
  });
});

describe('aggregate*: preloaded LoadedSession[] signature', () => {
  it('array signature returns identical output to string signature', () => {
    const viaString = aggregateServiceStats('ec2', SESSIONS_DIR);
    const loaded = loadSessions(SESSIONS_DIR);
    const viaArray = aggregateServiceStats('ec2', loaded);
    assert.deepEqual(viaArray, viaString);
  });

  it('concept array signature returns identical output to string signature', () => {
    const viaString = aggregateConceptStats('security-groups', SESSIONS_DIR);
    const loaded = loadSessions(SESSIONS_DIR);
    const viaArray = aggregateConceptStats('security-groups', loaded);
    assert.deepEqual(viaArray, viaString);
  });
});

describe('aggregate*: recentAvgEffectiveness picks the last 3 session dirs lexically', () => {
  const EXTRA_ROOT = path.join(__dirname, '.tmp', `vault-agg-recent-${process.pid}`);
  const EXTRA_SESSIONS = path.join(EXTRA_ROOT, 'sessions');

  before(() => {
    fs.mkdirSync(EXTRA_SESSIONS, { recursive: true });
    const configs = [
      { name: '2026-03-01-alpha', eff: 1 },
      { name: '2026-03-15-beta', eff: 1 },
      { name: '2026-04-01-gamma', eff: 10 },
      { name: '2026-04-10-delta', eff: 10 },
      { name: '2026-04-15-epsilon', eff: 10 },
    ];
    for (const c of configs) {
      const d = path.join(EXTRA_SESSIONS, c.name);
      fs.mkdirSync(d, { recursive: true });
      const row = { index: 1, question_type: 'gather', effectiveness: c.eff, services: ['ec2'], concepts: [], beats: [], uncertainty: false, note: '' };
      fs.writeFileSync(path.join(d, 'classification.jsonl'), JSON.stringify(row) + '\n', 'utf8');
    }
  });

  after(() => {
    try { fs.rmSync(EXTRA_ROOT, { recursive: true, force: true }); } catch {}
  });

  it('limits recent avg to the last 3 session dirs sorted lexically', () => {
    const stats = aggregateServiceStats('ec2', EXTRA_SESSIONS);
    assert.equal(stats.sessionCount, 5);
    // avg across all 5: (1+1+10+10+10)/5 = 6.4
    assert.equal(stats.avgEffectiveness, 6.4);
    // recent 3 lexically: gamma (10), delta (10), epsilon (10). mean = 10.
    assert.equal(stats.recentAvgEffectiveness, 10);
  });
});
