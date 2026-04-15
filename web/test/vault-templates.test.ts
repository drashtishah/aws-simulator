import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderSessionNote,
  renderServicePage,
  renderConceptPage,
  updateRankNote,
} from '../lib/vault-templates.js';
import type { ServiceStats, ConceptStats } from '../lib/vault-aggregation.js';

const BASE_CTX = {
  simId: '001-ec2-unreachable',
  sessionDate: '2026-04-15',
  rankAtTime: 'responder',
  sessionsCompleted: 1,
  services: ['EC2', 'VPC'],
  concepts: ['security-groups', 'inbound-rules'],
  questionTypes: ['gather', 'diagnose', 'fix'],
};

describe('renderSessionNote', () => {
  it('includes frontmatter with required keys', () => {
    const note = renderSessionNote(BASE_CTX);
    assert.ok(note.startsWith('---\n'), 'must start with YAML frontmatter');
    assert.ok(note.includes('date:'), 'must include date field');
    assert.ok(note.includes('sim:'), 'must include sim field');
    assert.ok(note.includes('tags:'), 'must include tags field');
    assert.ok(note.includes('session'), 'must include session tag');
  });

  it('includes wiki-links to services', () => {
    const note = renderSessionNote(BASE_CTX);
    assert.ok(note.includes('[[services/EC2]]') || note.includes('[[EC2]]'), 'must link to EC2');
    assert.ok(note.includes('[[services/VPC]]') || note.includes('[[VPC]]'), 'must link to VPC');
  });

  it('includes wiki-links to concepts', () => {
    const note = renderSessionNote(BASE_CTX);
    assert.ok(
      note.includes('[[concepts/security-groups]]') || note.includes('[[security-groups]]'),
      'must link to concept'
    );
  });

  it('includes simId and sessionDate', () => {
    const note = renderSessionNote(BASE_CTX);
    assert.ok(note.includes(BASE_CTX.simId));
    assert.ok(note.includes(BASE_CTX.sessionDate));
  });
});

describe('renderServicePage', () => {
  const stats: ServiceStats = {
    sessionCount: 3,
    avgEffectiveness: 5.5,
    recentAvgEffectiveness: 6.25,
    coAppearingServices: { vpc: 2, s3: 1 },
    coAppearingConcepts: { 'security-groups': 3, 'default-deny': 2 },
    sessionLinks: [
      { sessionSlug: '2026-04-01-foo', sessionDate: '2026-04-01' },
      { sessionSlug: '2026-04-10-baz', sessionDate: '2026-04-10' },
      { sessionSlug: '2026-04-05-bar', sessionDate: '2026-04-05' },
    ],
  };

  it('starts with YAML frontmatter declaring type: service', () => {
    const md = renderServicePage('ec2', stats);
    assert.ok(md.startsWith('---\n'), 'must start with frontmatter');
    assert.ok(md.includes('type: service'), 'frontmatter must include type: service');
    assert.ok(md.includes('- service'), 'tags must include service');
  });

  it('renders the Stats block with sessions_touched, avg, recent avg at 2dp', () => {
    const md = renderServicePage('ec2', stats);
    assert.ok(md.includes('## Stats'));
    assert.ok(md.includes('sessions_touched: 3'));
    assert.ok(md.includes('avg_effectiveness: 5.50'));
    assert.ok(md.includes('recent_avg_effectiveness: 6.25'));
  });

  it('renders both Co-appearing blocks with wiki-links sorted by count desc then alpha', () => {
    const md = renderServicePage('ec2', stats);
    assert.ok(md.includes('## Co-appearing services'));
    assert.ok(md.includes('## Co-appearing concepts'));
    assert.ok(md.includes('[[services/vpc]] (2 sessions)'));
    assert.ok(md.includes('[[services/s3]] (1 sessions)'));
    assert.ok(md.includes('[[concepts/security-groups]] (3 sessions)'));
    assert.ok(md.includes('[[concepts/default-deny]] (2 sessions)'));
    // order: vpc before s3
    const vpcIdx = md.indexOf('[[services/vpc]]');
    const s3Idx = md.indexOf('[[services/s3]]');
    assert.ok(vpcIdx !== -1 && s3Idx !== -1 && vpcIdx < s3Idx, 'vpc (2) should sort before s3 (1)');
  });

  it('renders Sessions block with wiki-links sorted lexically by slug', () => {
    const md = renderServicePage('ec2', stats);
    assert.ok(md.includes('## Sessions'));
    assert.ok(md.includes('[[sessions/2026-04-01-foo]] (2026-04-01)'));
    assert.ok(md.includes('[[sessions/2026-04-05-bar]] (2026-04-05)'));
    assert.ok(md.includes('[[sessions/2026-04-10-baz]] (2026-04-10)'));
    const a = md.indexOf('2026-04-01-foo');
    const b = md.indexOf('2026-04-05-bar');
    const c = md.indexOf('2026-04-10-baz');
    assert.ok(a < b && b < c, 'sessions must be chronological');
  });

  it('renders zero-state with sessions_touched: 0 and (none) placeholders', () => {
    const zero: ServiceStats = {
      sessionCount: 0,
      avgEffectiveness: 0,
      recentAvgEffectiveness: 0,
      coAppearingServices: {},
      coAppearingConcepts: {},
      sessionLinks: [],
    };
    const md = renderServicePage('ec2', zero);
    assert.ok(md.includes('sessions_touched: 0'));
    assert.ok(md.includes('avg_effectiveness: 0.00'));
    assert.ok(md.includes('recent_avg_effectiveness: 0.00'));
    assert.ok(md.includes('## Co-appearing services\n(none)'));
    assert.ok(md.includes('## Co-appearing concepts\n(none)'));
    assert.ok(md.includes('## Sessions\n(none)'));
  });

  it('does not include double-dashes punctuation', () => {
    const md = renderServicePage('ec2', stats);
    // Only `---` frontmatter fences are allowed; no `--` as punctuation in body.
    const withoutFences = md.replace(/^---$/gm, '');
    assert.ok(!/[^-]--[^-]/.test(withoutFences), 'body must not use -- as punctuation');
  });
});

describe('renderConceptPage', () => {
  const stats: ConceptStats = {
    sessionCount: 2,
    avgEffectiveness: 5,
    recentAvgEffectiveness: 5,
    coAppearingServices: { ec2: 2, vpc: 1 },
    coAppearingConcepts: { 'default-deny': 1 },
    sessionLinks: [
      { sessionSlug: '2026-04-01-foo', sessionDate: '2026-04-01' },
      { sessionSlug: '2026-04-05-bar', sessionDate: '2026-04-05' },
    ],
  };

  it('frontmatter declares type: concept with tag concept', () => {
    const md = renderConceptPage('security-groups', stats);
    assert.ok(md.startsWith('---\n'));
    assert.ok(md.includes('type: concept'));
    assert.ok(md.includes('- concept'));
  });

  it('includes Stats, both Co-appearing blocks, and Sessions', () => {
    const md = renderConceptPage('security-groups', stats);
    assert.ok(md.includes('## Stats'));
    assert.ok(md.includes('sessions_touched: 2'));
    assert.ok(md.includes('avg_effectiveness: 5.00'));
    assert.ok(md.includes('## Co-appearing services'));
    assert.ok(md.includes('## Co-appearing concepts'));
    assert.ok(md.includes('## Sessions'));
    assert.ok(md.includes('[[services/ec2]] (2 sessions)'));
    assert.ok(md.includes('[[concepts/default-deny]] (1 sessions)'));
  });

  it('zero-state renders (none) placeholders', () => {
    const zero: ConceptStats = {
      sessionCount: 0,
      avgEffectiveness: 0,
      recentAvgEffectiveness: 0,
      coAppearingServices: {},
      coAppearingConcepts: {},
      sessionLinks: [],
    };
    const md = renderConceptPage('security-groups', zero);
    assert.ok(md.includes('sessions_touched: 0'));
    assert.ok(md.includes('## Co-appearing services\n(none)'));
    assert.ok(md.includes('## Co-appearing concepts\n(none)'));
    assert.ok(md.includes('## Sessions\n(none)'));
  });
});

describe('updateRankNote', () => {
  it('creates rank note with required fields when content is empty', () => {
    const note = updateRankNote('', BASE_CTX);
    assert.ok(note.includes('current_rank:'));
    assert.ok(note.includes('## Sessions') || note.includes('Sessions'));
    assert.ok(note.includes('[[sessions/'));
  });

  it('prepends new session link when note already exists', () => {
    const existing = updateRankNote('', BASE_CTX);
    const updated = updateRankNote(existing, { ...BASE_CTX, simId: '002-rds-timeout', sessionDate: '2026-04-16' });
    assert.ok(updated.includes('002-rds-timeout'), 'must include new sim');
    assert.ok(updated.includes('001-ec2-unreachable'), 'must preserve old sim');
  });

  it('advances sessions_completed on update', () => {
    const existing = `---
current_rank: responder
sessions_completed: 1
---

## Sessions
- [[sessions/2026-04-01-foo]] (2026-04-01)
`;
    const result = updateRankNote(existing, { ...BASE_CTX, sessionsCompleted: 2 });
    assert.ok(result.includes('sessions_completed: 2'), 'must advance to 2');
    assert.ok(!result.includes('sessions_completed: 1'), 'must not retain 1');
  });

  it('writes the provided sessionsCompleted when creating fresh', () => {
    const result = updateRankNote('', { ...BASE_CTX, sessionsCompleted: 7 });
    assert.ok(result.includes('sessions_completed: 7'), 'must include 7');
  });

  it('advances sessions_completed across multi-digit values', () => {
    const existing = `---
current_rank: responder
sessions_completed: 9
---

## Sessions
- [[sessions/2026-04-01-foo]] (2026-04-01)
`;
    const result = updateRankNote(existing, { ...BASE_CTX, sessionsCompleted: 12 });
    assert.ok(result.includes('sessions_completed: 12'), 'must advance to 12');
    assert.ok(!result.includes('sessions_completed: 9'), 'must not retain 9');
  });
});
