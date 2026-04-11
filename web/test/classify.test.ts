import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classify, BUCKETS } from '../../scripts/lib/classify';
'use strict';



const POSITIVE: Array<[string, string]> = [
  ['web/lib/paths.ts', 'code'],
  ['web/server.ts', 'code'],
  ['scripts/test.ts', 'code'],
  ['scripts/lib/classify.ts', 'code'],
  ['.github/scripts/pipeline-iterations.sh', 'code'],
  ['web/test/code-health.test.ts', 'test'],
  ['web/test/classify.test.ts', 'test'],
  ['web/test-specs/browser/chat.yaml', 'test'],
  ['web/test-specs/personas/power-user.json', 'test'],
  ['.claude/skills/play/SKILL.md', 'skill'],
  ['.claude/skills/fix/references/something.md', 'skill'],
  ['.claude/commands/play.md', 'command'],
  ['.claude/hooks/log-hook.ts', 'hook'],
  ['.claude/hooks/pre-commit-issues.ts', 'hook'],
  ['sims/001-ec2-unreachable/manifest.json', 'sim'],
  ['sims/001-ec2-unreachable/story.md', 'sim'],
  ['sims/001-ec2-unreachable/artifacts/context.txt', 'sim'],
  ['references/architecture/core-workflow.md', 'reference'],
  ['references/config/code-health.md', 'reference'],
  ['references/registries/path-registry.csv', 'registry'],
  ['references/registries/agent-index.md', 'registry'],
  ['scripts/metrics.config.json', 'config'],
  ['package.json', 'config'],
  ['tsconfig.json', 'config'],
  ['.claude/settings.json', 'config'],
  ['.mcp.json', 'config'],
  ['.claude/state/something.json', 'config'],
  ['CLAUDE.md', 'memory_link'],
  ['README.md', 'memory_link'],
  ['learning/profile.json', 'memory_link'],
  ['docs/superpowers/plans/foo.md', 'memory_link'],
  ['themes/snowy.css', 'memory_link'],
];

const NEGATIVE: string[] = [
  '.claude/plans/typed-herding-yao.md',
  '.claude/plans/some-plan.md',
];

describe('classify', () => {
  for (const [p, bucket] of POSITIVE) {
    it(`classifies ${p} as ${bucket}`, () => {
      assert.equal(classify(p), bucket);
    });
  }

  for (const p of NEGATIVE) {
    it(`returns null for ${p} (excluded)`, () => {
      assert.equal(classify(p), null);
    });
  }

  it('exposes the canonical bucket list', () => {
    assert.deepEqual(BUCKETS, [
      'code', 'test', 'skill', 'command', 'hook',
      'sim', 'reference', 'registry', 'config', 'memory_link'
    ]);
  });

  it('does NOT include a plans bucket', () => {
    assert.ok(!BUCKETS.includes('plan'));
    assert.ok(!BUCKETS.includes('plans'));
  });

  it('is a pure function (no I/O, no throws on unknown paths)', () => {
    assert.equal(classify('totally/unknown/file.xyz'), null);
  });

  it('every bucket has at least one positive case in this test', () => {
    const seen = new Set(POSITIVE.map(([, b]) => b));
    for (const b of BUCKETS) assert.ok(seen.has(b), `no positive test for bucket ${b}`);
  });
});
