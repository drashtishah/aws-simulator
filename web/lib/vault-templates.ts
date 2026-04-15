export interface SessionNoteCtx {
  simId: string;
  sessionDate: string;
  rankAtTime: string;
  services: string[];
  concepts: string[];
  questionTypes: string[];
  investigationSummary?: string;
  rows?: ClassificationRowLike[];
  fixCriteria?: FixCriterion[];
  polygon?: Record<string, number>;
  avgQuestionQuality?: number;
}

export interface ClassificationRowLike {
  index: number;
  question_type: string;
  effectiveness: number;
  services: string[];
  concepts: string[];
  beats: string[];
  uncertainty: boolean;
  note: string;
}

export interface FixCriterion {
  id: string;
  description: string;
  required: boolean;
}

export interface ConceptCtx extends SessionNoteCtx {
  concept: string;
}

function sessionNoteFilename(ctx: SessionNoteCtx): string {
  return `sessions/${ctx.sessionDate}-${ctx.simId}`;
}

/**
 * Renders a session note. Pure, returns a string.
 * When ctx.rows is present, emits a diagnostic body (turn-by-turn table,
 * criteria checklist, axis profile, gaps). Otherwise emits the thin body.
 */
export function renderSessionNote(ctx: SessionNoteCtx): string {
  const serviceLinks = ctx.services.map(s => `[[services/${s}]]`).join(', ');
  const conceptLinks = ctx.concepts.map(c => `[[concepts/${c}]]`).join(', ');
  const servicesYaml = ctx.services.map(s => `  - ${s}`).join('\n');
  const conceptsYaml = ctx.concepts.map(c => `  - ${c}`).join('\n');
  const questionTypesYaml = ctx.questionTypes.map(q => `  - ${q}`).join('\n');

  const hasDiagnostic = ctx.rows && ctx.rows.length > 0;
  const axisProfile = hasDiagnostic ? computeAxisProfile(ctx.rows!) : null;
  const effectivenessAvg = hasDiagnostic
    ? (ctx.rows!.reduce((s, r) => s + r.effectiveness, 0) / ctx.rows!.length).toFixed(2)
    : null;
  const criteriaStatus = hasDiagnostic && ctx.fixCriteria
    ? computeCriteriaStatus(ctx.rows!, ctx.fixCriteria)
    : null;

  const frontmatterExtras = hasDiagnostic
    ? `effectiveness_avg: ${effectivenessAvg}
criteria_met: ${criteriaStatus!.requiredMet}/${criteriaStatus!.requiredTotal} required
`
    : '';

  const header = `---
date: ${ctx.sessionDate}
sim: ${ctx.simId}
rank_at_time: ${ctx.rankAtTime}
services:
${servicesYaml}
concepts:
${conceptsYaml}
question_types:
${questionTypesYaml}
${frontmatterExtras}tags:
  - session
---

## Session: ${ctx.simId}

Date: ${ctx.sessionDate}
Rank at time: ${ctx.rankAtTime}

`;

  if (!hasDiagnostic) {
    return header + `Services touched: ${serviceLinks}
Concepts surfaced: ${conceptLinks}
`;
  }

  const summary = ctx.investigationSummary?.trim() || '(no summary emitted)';
  const turnTable = renderTurnTable(ctx.rows!);
  const criteriaBlock = ctx.fixCriteria ? renderCriteriaBlock(ctx.fixCriteria, ctx.rows!) : '';
  const axisBlock = renderAxisProfile(axisProfile!);
  const gapsBlock = renderGaps(ctx.rows!);

  return header +
    `## Summary
${summary}

## Turn-by-turn
${turnTable}

${criteriaBlock}## Axis profile
${axisBlock}

${gapsBlock}## Links
Services: ${serviceLinks}
Concepts: ${conceptLinks}
`;
}

function computeAxisProfile(rows: ClassificationRowLike[]): Record<string, { count: number; effective: number }> {
  const axes = ['gather', 'diagnose', 'correlate', 'impact', 'trace', 'fix'];
  const out: Record<string, { count: number; effective: number }> = {};
  for (const axis of axes) {
    const matching = rows.filter(r => r.question_type === axis);
    out[axis] = {
      count: matching.length,
      effective: matching.filter(r => r.effectiveness >= 5).length,
    };
  }
  return out;
}

function computeCriteriaStatus(
  rows: ClassificationRowLike[],
  criteria: FixCriterion[]
): { requiredMet: number; requiredTotal: number; firedBeats: Set<string> } {
  const firedBeats = new Set(rows.flatMap(r => r.beats));
  const requiredTotal = criteria.filter(c => c.required).length;
  const requiredMet = criteria.filter(c => c.required && firedBeats.has(c.id)).length;
  return { requiredMet, requiredTotal, firedBeats };
}

function renderTurnTable(rows: ClassificationRowLike[]): string {
  const header = '| # | Type | Effect | Beat | Services | Note |';
  const sep = '|---|------|--------|------|----------|------|';
  const body = rows.map(r => {
    const beat = r.beats.length > 0 ? r.beats.join(', ') : '-';
    const services = r.services.length > 0 ? r.services.join(', ') : '-';
    const uncertaintyMark = r.uncertainty ? ' (?)' : '';
    return `| ${r.index} | ${r.question_type} | ${r.effectiveness} | ${beat} | ${services} | ${r.note}${uncertaintyMark} |`;
  }).join('\n');
  return [header, sep, body].join('\n');
}

function renderCriteriaBlock(criteria: FixCriterion[], rows: ClassificationRowLike[]): string {
  const fired = new Set(rows.flatMap(r => r.beats));
  const lines = criteria.map(c => {
    const mark = fired.has(c.id) ? '[x]' : '[ ]';
    const tag = c.required ? 'required' : 'optional';
    return `- ${mark} ${c.id} (${tag}): ${c.description}`;
  });
  return `## Criteria\n${lines.join('\n')}\n\n`;
}

function renderAxisProfile(profile: Record<string, { count: number; effective: number }>): string {
  return Object.entries(profile)
    .map(([axis, p]) => `${axis}: ${p.count} turn${p.count === 1 ? '' : 's'} (${p.effective} effective)`)
    .join(' | ');
}

function renderGaps(rows: ClassificationRowLike[]): string {
  const flagged = rows.filter(r => r.uncertainty);
  if (flagged.length === 0) return '';
  const lines = flagged.map(r => `- Turn ${r.index}: ${r.note}`);
  return `## Gaps flagged\n${lines.join('\n')}\n\n`;
}

/**
 * Appends a session bullet under the ## Sessions section of a service note.
 * Creates the section if missing. Idempotent: skips if link already present.
 * Pure, returns a string.
 */
export function appendSessionLinkToService(existing: string, ctx: SessionNoteCtx): string {
  const link = `[[${sessionNoteFilename(ctx)}]]`;
  if (existing.includes(ctx.simId)) return existing;

  const sessionsBullet = `- ${link} (${ctx.sessionDate})`;

  if (!existing) {
    return `---
type: service
tags:
  - service
---

## Sessions
${sessionsBullet}
`;
  }

  if (existing.includes('## Sessions')) {
    return existing.replace('## Sessions\n', `## Sessions\n${sessionsBullet}\n`);
  }

  return existing.trimEnd() + `\n\n## Sessions\n${sessionsBullet}\n`;
}

/**
 * Appends a session link to a concept note.
 * Creates the note if empty. Pure, returns a string.
 */
export function appendSessionLinkToConcept(existing: string, ctx: ConceptCtx): string {
  const link = `[[${sessionNoteFilename(ctx)}]]`;
  if (existing.includes(ctx.simId)) return existing;

  const sessionLine = `- ${link} (${ctx.sessionDate}): concept appeared in sim ${ctx.simId}.`;

  if (!existing) {
    return `---
type: concept
tags:
  - concept
---

## Sessions
${sessionLine}
`;
  }

  if (existing.includes('## Sessions')) {
    return existing.replace('## Sessions\n', `## Sessions\n${sessionLine}\n`);
  }

  return existing.trimEnd() + `\n\n## Sessions\n${sessionLine}\n`;
}

/**
 * Creates or updates the rank note. Prepends the new session link.
 * When ctx.polygon is present, also renders the polygon values and flags
 * the weakest axis. Pure, returns a string.
 */
export function updateRankNote(existing: string, ctx: SessionNoteCtx): string {
  const link = `[[${sessionNoteFilename(ctx)}]]`;
  const sessionLine = `- ${link} (${ctx.sessionDate})`;
  const polygonBlock = ctx.polygon ? renderPolygonBlock(ctx.polygon, ctx.avgQuestionQuality) : '';

  if (!existing) {
    return `---
current_rank: ${ctx.rankAtTime}
sessions_completed: 1
---

${polygonBlock}## Sessions
${sessionLine}
`;
  }

  // Update current_rank in frontmatter.
  let updated = existing.replace(/^current_rank: .+$/m, `current_rank: ${ctx.rankAtTime}`);

  // Replace or insert the polygon block (between frontmatter and ## Sessions).
  if (ctx.polygon) {
    updated = replaceOrInsertPolygon(updated, polygonBlock);
  }

  // Prepend new session link under ## Sessions.
  if (updated.includes('## Sessions')) {
    updated = updated.replace('## Sessions\n', `## Sessions\n${sessionLine}\n`);
  } else {
    updated = updated.trimEnd() + `\n\n## Sessions\n${sessionLine}\n`;
  }

  return updated;
}

function renderPolygonBlock(polygon: Record<string, number>, avgQ?: number): string {
  const axes = ['gather', 'diagnose', 'correlate', 'impact', 'trace', 'fix'];
  const values = axes.map(a => `${a}: ${polygon[a] ?? 0}`).join(' | ');
  const weakest = axes.reduce((min, a) => (polygon[a] ?? 0) < (polygon[min] ?? 0) ? a : min, axes[0]!);
  const avgLine = avgQ !== undefined ? `Avg question quality: ${avgQ.toFixed(2)}\n` : '';
  return `## Skill polygon
${values}
${avgLine}
## Weakest axis
${weakest} (${polygon[weakest] ?? 0} points)

`;
}

function replaceOrInsertPolygon(existing: string, block: string): string {
  const startMarker = '## Skill polygon';
  const endMarker = '## Sessions';
  const startIdx = existing.indexOf(startMarker);
  const endIdx = existing.indexOf(endMarker);

  if (startIdx !== -1 && endIdx !== -1 && startIdx < endIdx) {
    return existing.slice(0, startIdx) + block + existing.slice(endIdx);
  }
  // Insert before ## Sessions.
  if (endIdx !== -1) {
    return existing.slice(0, endIdx) + block + existing.slice(endIdx);
  }
  return existing;
}
