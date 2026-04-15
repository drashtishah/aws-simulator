#!/usr/bin/env tsx
/**
 * Verifies that classification.jsonl for a given sim is complete and valid.
 *
 * Usage: npx tsx scripts/verify-classification.ts <sim_id>
 *
 * Exit codes:
 *   0: valid
 *   1: invalid (prints one error per issue, then exits)
 *
 * Run by the Tier 1 post-session classifier agent as a self-check after
 * writing classification.jsonl. If non-zero, the agent fixes the file and
 * re-runs until zero.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseClassificationJsonl, ClassificationSchemaError } from '../web/lib/classification-schema.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function fail(messages: string[]): never {
  for (const m of messages) console.error(`FAIL: ${m}`);
  process.exit(1);
}

function pass(message: string): never {
  console.log(`OK: ${message}`);
  process.exit(0);
}

const simId = process.argv[2];
if (!simId) fail(['missing argument: sim_id (e.g. 001-ec2-unreachable)']);

const classificationPath = path.join(ROOT, 'learning', 'sessions', simId, 'classification.jsonl');
const turnsPath = path.join(ROOT, 'learning', 'sessions', simId, 'turns.jsonl');

if (!fs.existsSync(classificationPath)) fail([`missing file: ${classificationPath}`]);
if (!fs.existsSync(turnsPath)) fail([`missing file: ${turnsPath}`]);

const turnsText = fs.readFileSync(turnsPath, 'utf8');
const turnCount = turnsText.split('\n').filter(l => l.trim()).length;

const classificationText = fs.readFileSync(classificationPath, 'utf8');
const errors: string[] = [];

let rows;
try {
  rows = parseClassificationJsonl(classificationText);
} catch (err) {
  if (err instanceof ClassificationSchemaError) fail([err.message]);
  throw err;
}

// Count vs. turns.
if (rows.length !== turnCount) {
  errors.push(`row count mismatch: classification.jsonl has ${rows.length} rows, turns.jsonl has ${turnCount} player turns`);
}

// Index coverage 1..N, no duplicates.
const expected = new Set(Array.from({ length: turnCount }, (_, i) => i + 1));
const seen = new Set<number>();
for (const r of rows) {
  if (seen.has(r.index)) errors.push(`duplicate index: ${r.index}`);
  seen.add(r.index);
  expected.delete(r.index);
}
for (const missing of expected) errors.push(`missing index: ${missing}`);

// Per-row semantic checks beyond the schema (ranges, non-trivial notes).
for (const r of rows) {
  if (!Number.isInteger(r.effectiveness) || r.effectiveness < 1 || r.effectiveness > 8) {
    errors.push(`line for index ${r.index}: effectiveness must be integer 1-8, got ${r.effectiveness}`);
  }
  // note is required to be informative for non-meta turns (those with any service/concept/beat).
  const nonMeta = r.services.length + r.concepts.length + r.beats.length > 0;
  if (nonMeta && r.note.trim().length < 10) {
    errors.push(`line for index ${r.index}: note must be >= 10 chars for non-meta turns (current: "${r.note}")`);
  }
}

if (errors.length > 0) fail(errors);
pass(`classification.jsonl valid: ${rows.length} rows matching ${turnCount} turns`);
