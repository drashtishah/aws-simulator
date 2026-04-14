import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');

const plannerYml = fs.readFileSync(
  path.join(ROOT, '.github', 'workflows', 'planner.yml'), 'utf8'
);
const criticYml = fs.readFileSync(
  path.join(ROOT, '.github', 'workflows', 'critic.yml'), 'utf8'
);
const implementerYml = fs.readFileSync(
  path.join(ROOT, '.github', 'workflows', 'implementer.yml'), 'utf8'
);
const verifierYml = fs.readFileSync(
  path.join(ROOT, '.github', 'workflows', 'verifier.yml'), 'utf8'
);
const evaluatorYml = fs.readFileSync(
  path.join(ROOT, '.github', 'workflows', 'evaluator.yml'), 'utf8'
);
const criticMd = fs.readFileSync(
  path.join(ROOT, 'references', 'pipeline', 'critic.md'), 'utf8'
);
const pipelineMd = fs.readFileSync(
  path.join(ROOT, 'references', 'architecture', 'gha-pipeline.md'), 'utf8'
);

describe('planner auto-apply type label', () => {
  it('extracts Files to change section before grepping for web/', () => {
    assert.ok(
      plannerYml.includes('change_section'),
      'planner.yml auto-apply step must extract change_section before grepping'
    );
  });

  it('greps change_section not raw body for web/ paths', () => {
    const autoApplyBlock = plannerYml.slice(
      plannerYml.indexOf('Auto-apply type label')
    );
    const webGrep = autoApplyBlock.match(/echo "\$(\w+)" \| grep -qE 'web\//);
    assert.ok(webGrep, 'expected a grep for web/ in auto-apply step');
    assert.equal(
      webGrep![1], 'change_section',
      'web/ grep must target $change_section, not $body'
    );
  });

  it('greps change_section not raw body for sims/ paths', () => {
    const autoApplyBlock = plannerYml.slice(
      plannerYml.indexOf('Auto-apply type label')
    );
    const simsGrep = autoApplyBlock.match(/echo "\$(\w+)" \| grep -qE 'sims\//);
    assert.ok(simsGrep, 'expected a grep for sims/ in auto-apply step');
    assert.equal(
      simsGrep![1], 'change_section',
      'sims/ grep must target $change_section, not $body'
    );
  });
});

describe('critic label validation', () => {
  it('critic.yml tool allowlist includes gh issue edit', () => {
    assert.ok(
      criticYml.includes('Bash(gh issue edit:*)'),
      'critic.yml must grant Bash(gh issue edit:*) so the critic can correct labels'
    );
  });

  it('critic.md references labels.md for label definitions', () => {
    assert.ok(
      criticMd.includes('references/pipeline/labels.md'),
      'critic.md must point to labels.md for label routing rules'
    );
  });

  it('critic.md instructs label correction via gh issue edit', () => {
    assert.ok(
      criticMd.includes('gh issue edit {{ISSUE}}'),
      'critic.md must instruct label correction via gh issue edit'
    );
  });

  it('gha-pipeline.md documents critic edit capability', () => {
    assert.ok(
      pipelineMd.includes('Bash(gh issue view/comment/edit)') ||
      pipelineMd.includes('view/comment/edit'),
      'gha-pipeline.md critic tools row must include edit'
    );
  });
});

describe('pipeline gates allow claude[bot]-authored decomposed children', () => {
  const gates: Array<[string, string]> = [
    ['planner.yml', plannerYml],
    ['critic.yml', criticYml],
    ['implementer.yml', implementerYml],
    ['verifier.yml', verifierYml],
    ['evaluator.yml', evaluatorYml],
  ];

  for (const [name, yml] of gates) {
    it(`${name} top-level if allows claude[bot] as issue author`, () => {
      const ifBlock = yml.match(/if: \|([\s\S]*?)runs-on:/);
      assert.ok(ifBlock, `${name} must have a top-level if block`);
      assert.ok(
        ifBlock![1].includes("'claude[bot]'"),
        `${name} gate must allowlist 'claude[bot]' so pipeline-authored decomposed children are not stranded`
      );
    });

    it(`${name} still restricts sender to repository owner`, () => {
      const ifBlock = yml.match(/if: \|([\s\S]*?)runs-on:/);
      assert.ok(
        ifBlock![1].includes('github.event.sender.login == github.repository_owner'),
        `${name} must keep sender == owner so only the owner can promote claude[bot] issues into the pipeline`
      );
    });
  }
});
