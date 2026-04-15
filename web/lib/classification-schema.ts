export const VALID_QUESTION_TYPES = ['gather', 'diagnose', 'correlate', 'impact', 'trace', 'fix'] as const;
export type QuestionType = typeof VALID_QUESTION_TYPES[number];

export interface ClassificationRow {
  index: number;
  question_type: QuestionType;
  effectiveness: number;
  services: string[];
  concepts: string[];
  beats: string[];
  uncertainty: boolean;
  note: string;
}

export class ClassificationSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClassificationSchemaError';
  }
}

function validateRow(raw: unknown, lineNum: number): ClassificationRow {
  if (typeof raw !== 'object' || raw === null) {
    throw new ClassificationSchemaError(`line ${lineNum}: expected object`);
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.index !== 'number') {
    throw new ClassificationSchemaError(`line ${lineNum}: missing or invalid field "index"`);
  }
  if (typeof obj.question_type !== 'string') {
    throw new ClassificationSchemaError(`line ${lineNum}: missing or invalid field "question_type"`);
  }
  if (!(VALID_QUESTION_TYPES as readonly string[]).includes(obj.question_type)) {
    throw new ClassificationSchemaError(`line ${lineNum}: unknown question_type "${obj.question_type}"`);
  }
  if (typeof obj.effectiveness !== 'number') {
    throw new ClassificationSchemaError(`line ${lineNum}: missing or invalid field "effectiveness"`);
  }

  return {
    index: obj.index,
    question_type: obj.question_type as QuestionType,
    effectiveness: obj.effectiveness,
    services: validateStringArray(obj.services, 'services', lineNum),
    concepts: validateStringArray(obj.concepts, 'concepts', lineNum),
    beats: validateStringArray(obj.beats, 'beats', lineNum),
    uncertainty: validateBoolean(obj.uncertainty, 'uncertainty', lineNum),
    note: validateString(obj.note, 'note', lineNum),
  };
}

function validateBoolean(raw: unknown, field: string, lineNum: number): boolean {
  if (raw === undefined) return false;
  if (typeof raw !== 'boolean') {
    throw new ClassificationSchemaError(`line ${lineNum}: field "${field}" must be a boolean if present`);
  }
  return raw;
}

function validateString(raw: unknown, field: string, lineNum: number): string {
  if (raw === undefined) return '';
  if (typeof raw !== 'string') {
    throw new ClassificationSchemaError(`line ${lineNum}: field "${field}" must be a string if present`);
  }
  return raw;
}

function validateStringArray(raw: unknown, field: string, lineNum: number): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new ClassificationSchemaError(`line ${lineNum}: field "${field}" must be an array if present`);
  }
  for (const v of raw) {
    if (typeof v !== 'string') {
      throw new ClassificationSchemaError(`line ${lineNum}: field "${field}" must contain only strings`);
    }
  }
  return raw as string[];
}

/**
 * Parses JSONL text into ClassificationRow[].
 * Throws ClassificationSchemaError on the first invalid line.
 * Deduplicates by index, keeping the last occurrence.
 */
export function parseClassificationJsonl(text: string): ClassificationRow[] {
  const byIndex = new Map<number, ClassificationRow>();
  const lines = text.split('\n');
  let lineNum = 0;
  for (const line of lines) {
    lineNum++;
    const trimmed = line.trim();
    if (!trimmed) continue;
    const raw = JSON.parse(trimmed) as unknown;
    const row = validateRow(raw, lineNum);
    byIndex.set(row.index, row);
  }
  return Array.from(byIndex.values()).sort((a, b) => a.index - b.index);
}
