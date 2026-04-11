import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
// Tests for the new browser-spec check types: console_clean, network_ok, landmarks_present.
// The test runner is an agent-instruction translator: it parses YAML specs and prints
// step-by-step instructions for a chrome-devtools-driving subagent. These tests assert that
// the schema accepts the new check types and that the agent printer renders them correctly,
// including spec-level allowlists and origin lists.


const ROOT = path.resolve(__dirname, '..', '..');
const CLI = 'npx tsx scripts/test.ts';
const SCHEMA_PATH = path.join(ROOT, 'references/schemas/browser-spec.schema.json');
const SPECS_DIR = path.join(ROOT, 'web/test-specs/browser');

function runWithExit(args: string): { output: string; exitCode: number } {
  try {
    const output = execSync(CLI + ' ' + args, { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
    return { output, exitCode: 0 };
  } catch (err: any) {
    return { output: (err.stdout || '') + (err.stderr || ''), exitCode: err.status ?? 1 };
  }
}

function readSchema(): any {
  return JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
}

describe('browser-spec schema: new check types', () => {
  it('declares console_clean, network_ok, landmarks_present in check item type enum', () => {
    const schema = readSchema();
    const checkItemProps = schema.properties.steps.items.properties.check.items.properties;
    const enumValues = checkItemProps.type.enum;
    assert.ok(enumValues.includes('console_clean'), 'enum should include console_clean');
    assert.ok(enumValues.includes('network_ok'), 'enum should include network_ok');
    assert.ok(enumValues.includes('landmarks_present'), 'enum should include landmarks_present');
  });

  it('declares spec-level consoleAllowlist (array of strings, default [])', () => {
    const schema = readSchema();
    const prop = schema.properties.consoleAllowlist;
    assert.equal(prop.type, 'array');
    assert.equal(prop.items.type, 'string');
    assert.deepEqual(prop.default, []);
  });

  it('declares spec-level network_allowed_origins (array of strings, default ["self"])', () => {
    const schema = readSchema();
    const prop = schema.properties.network_allowed_origins;
    assert.equal(prop.type, 'array');
    assert.equal(prop.items.type, 'string');
    assert.deepEqual(prop.default, ['self']);
  });

  it('allows step.target to be an object carrying landmarks', () => {
    const schema = readSchema();
    const target = schema.properties.steps.items.properties.target;
    assert.ok(target.oneOf, 'target should be a oneOf union');
    const objectVariant = target.oneOf.find((v: any) => v.type === 'object');
    assert.ok(objectVariant, 'target should accept an object variant');
    assert.equal(objectVariant.properties.landmarks.type, 'array');
    assert.equal(objectVariant.properties.landmarks.items.type, 'string');
  });

  it('allows check items without selector when type is set', () => {
    const schema = readSchema();
    const checkItem = schema.properties.steps.items.properties.check.items;
    assert.ok(Array.isArray(checkItem.anyOf), 'check item should declare anyOf required-set');
    const requiredSets = checkItem.anyOf.map((v: any) => JSON.stringify(v.required));
    assert.ok(requiredSets.includes(JSON.stringify(['selector'])));
    assert.ok(requiredSets.includes(JSON.stringify(['type'])));
  });
});

describe('all 7 browser specs: contain the new check types', () => {
  const required = ['accessibility', 'chat', 'dashboard', 'layout', 'navigation', 'settings', 'sim-picker'];

  for (const name of required) {
    it(name + '.yaml has both console_clean and network_ok', () => {
      const file = path.join(SPECS_DIR, name + '.yaml');
      const content = fs.readFileSync(file, 'utf8');
      assert.ok(content.includes('console_clean'), name + ' should declare a console_clean check');
      assert.ok(content.includes('network_ok'), name + ' should declare a network_ok check');
    });
  }

  it('accessibility.yaml asserts main, navigation, complementary landmarks', () => {
    const content = fs.readFileSync(path.join(SPECS_DIR, 'accessibility.yaml'), 'utf8');
    assert.ok(content.includes('landmarks_present'), 'should use landmarks_present check');
    assert.ok(content.includes('main'), 'should require main landmark');
    assert.ok(content.includes('navigation'), 'should require navigation landmark');
    assert.ok(content.includes('complementary'), 'should require complementary landmark');
  });

  it('dashboard.yaml asserts main, navigation landmarks', () => {
    const content = fs.readFileSync(path.join(SPECS_DIR, 'dashboard.yaml'), 'utf8');
    assert.ok(content.includes('landmarks_present'), 'should use landmarks_present check');
    assert.ok(content.includes('main'), 'should require main landmark');
    assert.ok(content.includes('navigation'), 'should require navigation landmark');
  });
});

describe('test runner: prints new check types', () => {
  // Write a temporary spec file in web/test-specs/browser, run dry-run + non-dry-run agent
  // print, capture output, then delete the temp file. We isolate by using a unique name.
  function withTempSpec(name: string, body: string, fn: (file: string) => void): void {
    const file = path.join(SPECS_DIR, '__tmp_' + name + '.yaml');
    fs.writeFileSync(file, body);
    try {
      fn(file);
    } finally {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  }

  it('parses a spec with console_clean check via dry-run', () => {
    withTempSpec('console-clean', [
      'name: tmp-console-clean',
      'description: temp',
      'consoleAllowlist:',
      '  - "ResizeObserver loop"',
      'setup:',
      '  navigate: /',
      'steps:',
      '  - id: navigate-and-check-console',
      '    check:',
      '      - type: console_clean',
      ''
    ].join('\n'), () => {
      const { output, exitCode } = runWithExit('agent --spec __tmp_console-clean --dry-run');
      assert.equal(exitCode, 0, 'dry-run should succeed:\n' + output);
      assert.ok(output.includes('tmp-console-clean'), 'output should mention spec name');
    });
  });

  it('renders console_clean printer line and consoleAllowlist header', () => {
    withTempSpec('console-print', [
      'name: tmp-console-print',
      'description: temp',
      'consoleAllowlist:',
      '  - "benign warning"',
      'setup:',
      '  navigate: /',
      'steps:',
      '  - id: check-console',
      '    check:',
      '      - type: console_clean',
      ''
    ].join('\n'), () => {
      const { output, exitCode } = runWithExit('agent --spec __tmp_console-print');
      assert.equal(exitCode, 0, output);
      assert.ok(output.includes('check: console_clean'), 'should render console_clean check');
      assert.ok(output.includes('list_console_messages'), 'should reference list_console_messages tool');
      assert.ok(output.includes('ConsoleAllowlist:'), 'should print consoleAllowlist header');
      assert.ok(output.includes('benign warning'), 'should include allowlist entry');
    });
  });

  it('renders network_ok printer line and network_allowed_origins header', () => {
    withTempSpec('network-print', [
      'name: tmp-network-print',
      'description: temp',
      'network_allowed_origins:',
      '  - "self"',
      '  - "https://api.example.com"',
      'setup:',
      '  navigate: /',
      'steps:',
      '  - id: check-network',
      '    check:',
      '      - type: network_ok',
      ''
    ].join('\n'), () => {
      const { output, exitCode } = runWithExit('agent --spec __tmp_network-print');
      assert.equal(exitCode, 0, output);
      assert.ok(output.includes('check: network_ok'), 'should render network_ok check');
      assert.ok(output.includes('list_network_requests'), 'should reference list_network_requests tool');
      assert.ok(output.includes('NetworkAllowedOrigins:'), 'should print allowed origins header');
      assert.ok(output.includes('https://api.example.com'), 'should include allowed origin');
    });
  });

  it('renders landmarks_present check with landmarks list from step.target', () => {
    withTempSpec('landmarks-print', [
      'name: tmp-landmarks-print',
      'description: temp',
      'setup:',
      '  navigate: /',
      'steps:',
      '  - id: check-landmarks',
      '    target:',
      '      landmarks: ["main", "navigation", "complementary"]',
      '    check:',
      '      - type: landmarks_present',
      ''
    ].join('\n'), () => {
      const { output, exitCode } = runWithExit('agent --spec __tmp_landmarks-print');
      assert.equal(exitCode, 0, output);
      assert.ok(output.includes('check: landmarks_present'), 'should render landmarks_present check');
      assert.ok(output.includes('"main"'), 'should list main landmark');
      assert.ok(output.includes('"navigation"'), 'should list navigation landmark');
      assert.ok(output.includes('"complementary"'), 'should list complementary landmark');
      assert.ok(output.includes('take_snapshot'), 'should reference take_snapshot tool');
    });
  });

  it('all 7 specs validate via agent --dry-run after the new checks land', () => {
    const { output, exitCode } = runWithExit('agent --dry-run');
    assert.equal(exitCode, 0, 'all specs should parse:\n' + output);
    for (const name of ['accessibility', 'chat', 'dashboard', 'layout', 'navigation', 'settings', 'sim-picker']) {
      assert.ok(output.includes(name), 'dry-run output should mention ' + name);
    }
  });

  it('still renders existing selector-based checks unchanged', () => {
    withTempSpec('selector-print', [
      'name: tmp-selector-print',
      'description: temp',
      'setup:',
      '  navigate: /',
      'steps:',
      '  - id: check-selector',
      '    check:',
      '      - selector: "#foo"',
      '        visible: true',
      ''
    ].join('\n'), () => {
      const { output, exitCode } = runWithExit('agent --spec __tmp_selector-print');
      assert.equal(exitCode, 0, output);
      assert.ok(output.includes('check: #foo'), 'should render selector-based check');
      assert.ok(output.includes('visible=true'), 'should render visible attribute');
    });
  });
});

