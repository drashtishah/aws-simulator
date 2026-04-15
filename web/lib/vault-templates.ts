export interface SessionNoteCtx {
  simId: string;
  sessionDate: string;
  rankAtTime: string;
  services: string[];
  concepts: string[];
  questionTypes: string[];
}

export interface ConceptCtx extends SessionNoteCtx {
  concept: string;
}

function sessionNoteFilename(ctx: SessionNoteCtx): string {
  return `sessions/${ctx.sessionDate}-${ctx.simId}`;
}

/**
 * Renders a session note. Pure, returns a string.
 */
export function renderSessionNote(ctx: SessionNoteCtx): string {
  const serviceLinks = ctx.services.map(s => `[[services/${s}]]`).join(', ');
  const conceptLinks = ctx.concepts.map(c => `[[concepts/${c}]]`).join(', ');
  const servicesYaml = ctx.services.map(s => `  - ${s}`).join('\n');
  const conceptsYaml = ctx.concepts.map(c => `  - ${c}`).join('\n');
  const questionTypesYaml = ctx.questionTypes.map(q => `  - ${q}`).join('\n');

  return `---
date: ${ctx.sessionDate}
sim: ${ctx.simId}
rank_at_time: ${ctx.rankAtTime}
services:
${servicesYaml}
concepts:
${conceptsYaml}
question_types:
${questionTypesYaml}
tags:
  - session
---

## Session: ${ctx.simId}

Date: ${ctx.sessionDate}
Rank at time: ${ctx.rankAtTime}

Services touched: ${serviceLinks}
Concepts surfaced: ${conceptLinks}
`;
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
 * Pure, returns a string.
 */
export function updateRankNote(existing: string, ctx: SessionNoteCtx): string {
  const link = `[[${sessionNoteFilename(ctx)}]]`;
  const sessionLine = `- ${link} (${ctx.sessionDate})`;

  if (!existing) {
    return `---
current_rank: ${ctx.rankAtTime}
sessions_completed: 1
---

## Sessions
${sessionLine}
`;
  }

  // Update current_rank in frontmatter.
  let updated = existing.replace(/^current_rank: .+$/m, `current_rank: ${ctx.rankAtTime}`);

  // Prepend new session link under ## Sessions.
  if (updated.includes('## Sessions')) {
    updated = updated.replace('## Sessions\n', `## Sessions\n${sessionLine}\n`);
  } else {
    updated = updated.trimEnd() + `\n\n## Sessions\n${sessionLine}\n`;
  }

  return updated;
}
