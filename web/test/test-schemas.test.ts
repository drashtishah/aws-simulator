import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

/**
 * Schema validation tests for the test CLI JSON outputs and the
 * persona-finding file format. Derived from Issue #31.
 *
 * Each test runs a dry-run command in JSON mode, feeds the parsed output
 * through ajv against its schema, and asserts the document validates. When
 * the CLI output shape drifts, this test fails and the schema (or the CLI)
 * has to be updated deliberately.
 */

const ROOT = path.resolve(__dirname, '..', '..');
const SCHEMAS_DIR = path.join(ROOT, 'web/lib/schemas');

function loadSchema(name: string): object {
  return JSON.parse(fs.readFileSync(path.join(SCHEMAS_DIR, name), 'utf8'));
}

function runCliJson(args: string): unknown {
  const out = execSync(`npx tsx scripts/test.ts ${args}`, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Strip npm notice noise that may leak from npx.
  const jsonStart = out.indexOf('{');
  return JSON.parse(out.slice(jsonStart));
}

function freshAjv(): Ajv {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv;
}

describe('test output JSON schemas', () => {
  const ajv = freshAjv();

  it('test personas --dry-run --json matches personas-output.schema.json', () => {
    const schema = loadSchema('personas-output.schema.json');
    const validate = ajv.compile(schema);
    const data = runCliJson('personas --dry-run --json');
    const ok = validate(data);
    assert.equal(ok, true, `validation errors: ${JSON.stringify(validate.errors)}`);
  });

  it('test agent --dry-run --json matches agent-specs-output.schema.json', () => {
    const schema = loadSchema('agent-specs-output.schema.json');
    const validate = ajv.compile(schema);
    const data = runCliJson('agent --dry-run --json');
    const ok = validate(data);
    assert.equal(ok, true, `validation errors: ${JSON.stringify(validate.errors)}`);
  });

  it('persona-finding schema accepts a minimal well-formed document', () => {
    const schema = loadSchema('persona-finding.schema.json');
    const validate = freshAjv().compile(schema);
    const sample = {
      persona: 'hostile-user',
      ts: '2026-04-08T00:00:00.000Z',
      findings: [
        {
          severity: 'high',
          category: 'xss',
          description: 'user input rendered as HTML',
          reproduction: 'send <script>alert(1)</script> as a chat message',
          suggested_guardrail: 'textContent-only rendering',
        },
      ],
    };
    const ok = validate(sample);
    assert.equal(ok, true, `validation errors: ${JSON.stringify(validate.errors)}`);
  });

  it('persona-finding schema rejects an unknown severity', () => {
    const schema = loadSchema('persona-finding.schema.json');
    const validate = freshAjv().compile(schema);
    const bad = {
      persona: 'hostile-user',
      findings: [{ severity: 'catastrophic', category: 'xss', description: 'bad' }],
    };
    assert.equal(validate(bad), false);
  });

  it('persona-finding schema rejects extra finding fields (typo guard)', () => {
    const schema = loadSchema('persona-finding.schema.json');
    const validate = freshAjv().compile(schema);
    const bad = {
      persona: 'hostile-user',
      findings: [
        {
          severity: 'high',
          category: 'xss',
          description: 'bad',
          reproductionnn: 'typo field',
        },
      ],
    };
    assert.equal(validate(bad), false);
  });
});
