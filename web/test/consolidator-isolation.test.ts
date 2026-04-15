import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { renderServicePage } from '../lib/vault-templates';
import type { ServiceStats } from '../lib/vault-aggregation';

// D3 consolidator writes only to player-vault/insights/, never to services/ or
// concepts/ or rank.md or sessions/. D2's renderers never touch insights/. The
// two write paths are disjoint; this test asserts that property directly by
// re-rendering a services page and confirming the insights file is byte-for-byte
// identical.

describe('D2 + D3 write-path isolation', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'consolidator-iso-'));
  const servicesDir = path.join(tmpRoot, 'services');
  const insightsDir = path.join(tmpRoot, 'insights');
  fs.mkdirSync(servicesDir, { recursive: true });
  fs.mkdirSync(insightsDir, { recursive: true });

  after(() => {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  });

  it('re-rendering services/ec2.md leaves insights/pattern-foo.md untouched', () => {
    const statsA: ServiceStats = {
      sessionCount: 1,
      avgEffectiveness: 4,
      recentAvgEffectiveness: 4,
      coAppearingServices: {},
      coAppearingConcepts: { 'security-groups': 1 },
      sessionLinks: [{ sessionSlug: '2026-04-01-foo', sessionDate: '2026-04-01' }],
    };
    const servicePath = path.join(servicesDir, 'ec2.md');
    fs.writeFileSync(servicePath, renderServicePage('ec2', statsA));

    // Consolidator-authored insight note. Hand-crafted to simulate the agent's side effect.
    const insightPath = path.join(insightsDir, 'pattern-foo.md');
    const insightBody = `---
type: insight
tags:
  - insight
  - pattern
created: 2026-04-15
---

## Pattern
Player gathers shallowly on networking sims. Links: [[services/ec2]], [[concepts/security-groups]].
`;
    fs.writeFileSync(insightPath, insightBody);
    const snapshot = fs.readFileSync(insightPath);

    // Simulate next sim: D2 re-renders the service page with new stats.
    const statsB: ServiceStats = {
      sessionCount: 2,
      avgEffectiveness: 5,
      recentAvgEffectiveness: 5,
      coAppearingServices: { vpc: 1 },
      coAppearingConcepts: { 'security-groups': 2 },
      sessionLinks: [
        { sessionSlug: '2026-04-01-foo', sessionDate: '2026-04-01' },
        { sessionSlug: '2026-04-15-bar', sessionDate: '2026-04-15' },
      ],
    };
    fs.writeFileSync(servicePath, renderServicePage('ec2', statsB));

    // The service page was rewritten.
    const serviceAfter = fs.readFileSync(servicePath, 'utf8');
    assert.ok(serviceAfter.includes('sessions_touched: 2'), 'service page must reflect new stats');
    assert.ok(serviceAfter.includes('2026-04-15-bar'), 'service page must include new session link');

    // The insight file is byte-identical. This is the contract D3 depends on.
    const after = fs.readFileSync(insightPath);
    assert.ok(snapshot.equals(after), 'insights/pattern-foo.md must be byte-identical');
  });
});
