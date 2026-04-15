import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderSessionNote,
  appendSessionLinkToService,
  appendSessionLinkToConcept,
  updateRankNote,
} from '../lib/vault-templates.js';

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

describe('appendSessionLinkToService', () => {
  it('appends a session bullet to empty content', () => {
    const result = appendSessionLinkToService('', BASE_CTX);
    assert.ok(result.includes('[[sessions/'), 'must include session link');
    assert.ok(result.includes(BASE_CTX.simId));
  });

  it('appends a session bullet to existing content with Sessions section', () => {
    const existing = '---\ntype: service\n---\n\n## Sessions\n- [[sessions/old-sim]]\n';
    const result = appendSessionLinkToService(existing, BASE_CTX);
    assert.ok(result.includes('[[sessions/old-sim]]'), 'must preserve old links');
    assert.ok(result.includes(BASE_CTX.simId), 'must append new link');
  });

  it('is idempotent: calling twice with same ctx does not duplicate the link', () => {
    const first = appendSessionLinkToService('', BASE_CTX);
    const second = appendSessionLinkToService(first, BASE_CTX);
    const linkPattern = BASE_CTX.simId;
    const count = (second.split(linkPattern).length - 1);
    assert.equal(count, 1, 'session link must appear exactly once after idempotent call');
  });
});

describe('appendSessionLinkToConcept', () => {
  it('appends a session link to empty content', () => {
    const result = appendSessionLinkToConcept('', { ...BASE_CTX, concept: 'security-groups' });
    assert.ok(result.includes('[[sessions/'), 'must include session link');
  });

  it('preserves existing content', () => {
    const existing = '---\ntype: concept\n---\n\nExisting body.\n';
    const result = appendSessionLinkToConcept(existing, { ...BASE_CTX, concept: 'security-groups' });
    assert.ok(result.includes('Existing body.'), 'must preserve existing body');
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
