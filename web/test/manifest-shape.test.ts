import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');
const SIMS_DIR = path.join(ROOT, 'sims');

function eachManifest(): Array<{ id: string; manifest: Record<string, unknown> }> {
  return fs.readdirSync(SIMS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => ({
      id: e.name,
      manifest: JSON.parse(fs.readFileSync(path.join(SIMS_DIR, e.name, 'manifest.json'), 'utf8'))
    }));
}

describe('manifest shape (new schema)', () => {
  const manifests = eachManifest();

  it('every manifest has glossary at top level', () => {
    for (const { id, manifest } of manifests) {
      assert.ok(manifest.glossary, `${id} missing glossary`);
    }
  });

  it('every manifest has system at top level with what_broke', () => {
    for (const { id, manifest } of manifests) {
      assert.ok(manifest.system, `${id} missing system`);
      assert.ok((manifest.system as Record<string, unknown>).what_broke, `${id} missing system.what_broke`);
    }
  });

  it('every manifest has consoles at top level with capabilities preserved', () => {
    for (const { id, manifest } of manifests) {
      assert.ok(Array.isArray(manifest.consoles), `${id} missing consoles`);
      for (const c of manifest.consoles as Array<Record<string, unknown>>) {
        assert.ok(Array.isArray(c.capabilities), `${id} console ${c.service} missing capabilities`);
      }
    }
  });

  it('every manifest has progressive_clues array', () => {
    for (const { id, manifest } of manifests) {
      assert.ok(Array.isArray(manifest.progressive_clues), `${id} missing progressive_clues`);
    }
  });

  it('no manifest has team.narrator wrapper', () => {
    for (const { id, manifest } of manifests) {
      const team = manifest.team as Record<string, unknown> | undefined;
      assert.ok(!team?.narrator, `${id} still has team.narrator`);
    }
  });

  it('no manifest has deleted narrator subfields anywhere', () => {
    for (const { id, manifest } of manifests) {
      const blob = JSON.stringify(manifest);
      assert.ok(!blob.includes('"personality"'), `${id} still has personality`);
      assert.ok(!blob.includes('"story_beats"'), `${id} still has story_beats`);
      assert.ok(!blob.includes('"narrative_arc"'), `${id} still has narrative_arc`);
      assert.ok(!blob.includes('"max_hints_before_nudge"'), `${id} still has max_hints_before_nudge`);
    }
  });

  it('resolution block unchanged', () => {
    for (const { id, manifest } of manifests) {
      const r = manifest.resolution as Record<string, unknown>;
      assert.ok(r.root_cause, `${id} missing resolution.root_cause`);
      assert.ok(Array.isArray(r.fix_criteria), `${id} missing resolution.fix_criteria`);
      assert.ok(Array.isArray(r.learning_objectives), `${id} missing learning_objectives`);
      assert.ok(Array.isArray(r.sop_steps), `${id} missing sop_steps`);
      assert.ok(Array.isArray(r.related_failure_modes), `${id} missing related_failure_modes`);
      assert.ok(Array.isArray(r.sop_practices), `${id} missing sop_practices`);
    }
  });
});
