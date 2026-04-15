import fs from 'node:fs';
import path from 'node:path';
import { parseClassificationJsonl } from './classification-schema.js';
import type { ClassificationRow } from './classification-schema.js';

export interface SessionLink {
  sessionSlug: string;
  sessionDate: string;
}

export interface ServiceStats {
  sessionCount: number;
  avgEffectiveness: number;
  recentAvgEffectiveness: number;
  coAppearingServices: Record<string, number>;
  coAppearingConcepts: Record<string, number>;
  sessionLinks: SessionLink[];
}

export type ConceptStats = ServiceStats;

function zeroState(): ServiceStats {
  return {
    sessionCount: 0,
    avgEffectiveness: 0,
    recentAvgEffectiveness: 0,
    coAppearingServices: {},
    coAppearingConcepts: {},
    sessionLinks: [],
  };
}

function deriveSessionDate(slug: string): string {
  const m = slug.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : slug;
}

function listSessionDirs(sessionsDir: string): string[] {
  if (!fs.existsSync(sessionsDir)) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(sessionsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort();
}

interface LoadedSession {
  slug: string;
  rows: ClassificationRow[];
}

function loadSessions(sessionsDir: string): LoadedSession[] {
  const dirs = listSessionDirs(sessionsDir);
  const out: LoadedSession[] = [];
  for (const slug of dirs) {
    const file = path.join(sessionsDir, slug, 'classification.jsonl');
    if (!fs.existsSync(file)) continue;
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (err) {
      console.error(`[vault-aggregation] unreadable: ${file}: ${String(err)}`);
      continue;
    }
    if (!text.trim()) continue;
    let rows: ClassificationRow[];
    try {
      rows = parseClassificationJsonl(text);
    } catch (err) {
      console.error(`[vault-aggregation] parse error: ${file}: ${String(err)}`);
      continue;
    }
    out.push({ slug, rows });
  }
  return out;
}

type RowListField = (row: ClassificationRow) => string[];

interface AggregateSpec {
  target: string;
  // Does this row match the target?
  matches: (row: ClassificationRow) => boolean;
  // Same-kind field: co-occurring values of the same kind as target (service for service aggregation, concept for concept).
  sameKindField: RowListField;
  // Other-kind field: the complementary kind.
  otherKindField: RowListField;
  // Which Record<string, number> the same-kind counts go into.
  sameKindTargetKey: 'coAppearingServices' | 'coAppearingConcepts';
}

function aggregate(sessionsDir: string, spec: AggregateSpec): ServiceStats {
  const sessions = loadSessions(sessionsDir);
  if (sessions.length === 0) return zeroState();

  const stats = zeroState();
  const otherKey = spec.sameKindTargetKey === 'coAppearingServices'
    ? 'coAppearingConcepts'
    : 'coAppearingServices';

  let totalEffSum = 0;
  let totalEffCount = 0;
  const matchingSessions: LoadedSession[] = [];

  for (const session of sessions) {
    const matchingRows = session.rows.filter(spec.matches);
    if (matchingRows.length === 0) continue;

    matchingSessions.push(session);
    stats.sessionCount += 1;
    for (const r of matchingRows) {
      totalEffSum += r.effectiveness;
      totalEffCount += 1;
    }

    const sameKind = new Set<string>();
    const otherKind = new Set<string>();
    for (const r of session.rows) {
      for (const v of spec.sameKindField(r)) {
        if (v !== spec.target) sameKind.add(v);
      }
      for (const v of spec.otherKindField(r)) {
        otherKind.add(v);
      }
    }
    for (const v of sameKind) {
      stats[spec.sameKindTargetKey][v] = (stats[spec.sameKindTargetKey][v] ?? 0) + 1;
    }
    for (const v of otherKind) {
      stats[otherKey][v] = (stats[otherKey][v] ?? 0) + 1;
    }

    stats.sessionLinks.push({
      sessionSlug: session.slug,
      sessionDate: deriveSessionDate(session.slug),
    });
  }

  stats.avgEffectiveness = totalEffCount > 0 ? totalEffSum / totalEffCount : 0;

  const recent = matchingSessions.slice(-3);
  let recentSum = 0;
  let recentCount = 0;
  for (const s of recent) {
    for (const r of s.rows) {
      if (spec.matches(r)) {
        recentSum += r.effectiveness;
        recentCount += 1;
      }
    }
  }
  stats.recentAvgEffectiveness = recentCount > 0 ? recentSum / recentCount : 0;

  return stats;
}

export function aggregateServiceStats(service: string, sessionsDir: string): ServiceStats {
  return aggregate(sessionsDir, {
    target: service,
    matches: r => r.services.includes(service),
    sameKindField: r => r.services,
    otherKindField: r => r.concepts,
    sameKindTargetKey: 'coAppearingServices',
  });
}

export function aggregateConceptStats(concept: string, sessionsDir: string): ConceptStats {
  return aggregate(sessionsDir, {
    target: concept,
    matches: r => r.concepts.includes(concept),
    sameKindField: r => r.concepts,
    otherKindField: r => r.services,
    sameKindTargetKey: 'coAppearingConcepts',
  });
}
