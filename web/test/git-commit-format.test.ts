const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

/**
 * Validates commit message format against the contextual commits spec.
 * Spec: .claude/skills/git/references/contextual-commits-spec.md
 */

const VALID_TYPES = ['feat', 'fix', 'improve', 'refactor', 'test', 'chore', 'docs'];
const ACTION_LINE_PATTERN = /^(intent|decision|rejected|constraint|learned)\([a-z][a-z0-9_-]*\):/;
const HEADER_PATTERN = /^([a-z]+)\(([a-z][a-z0-9_-]*)\): .+/;
const ISSUE_REF_PATTERN = /^(Closes|Ref) #\d+$/;

function parseCommitMessage(msg) {
  const lines = msg.trim().split('\n');
  const header = lines[0];
  const headerMatch = header.match(HEADER_PATTERN);

  if (!headerMatch) {
    return { valid: false, error: `Invalid header: "${header}"` };
  }

  const type = headerMatch[1];
  const scope = headerMatch[2];

  if (!VALID_TYPES.includes(type)) {
    return { valid: false, error: `Invalid type: "${type}"` };
  }

  if (header.endsWith('.')) {
    return { valid: false, error: 'Subject must not end with a period' };
  }

  const actionLines = [];
  const issueRefs = [];
  let hasIntent = false;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (ISSUE_REF_PATTERN.test(line)) {
      issueRefs.push(line);
      continue;
    }

    if (ACTION_LINE_PATTERN.test(line)) {
      const actionMatch = line.match(ACTION_LINE_PATTERN);
      actionLines.push({ type: actionMatch[1], scope: actionMatch[2] });
      if (actionMatch[1] === 'intent') hasIntent = true;
      continue;
    }

    // Continuation lines (indented) are allowed after action lines
    if (lines[i].startsWith('  ') && actionLines.length > 0) {
      continue;
    }
  }

  return {
    valid: true,
    type,
    scope,
    actionLines,
    issueRefs,
    hasIntent
  };
}

describe('parseCommitMessage', () => {
  it('parses a valid full commit message', () => {
    const msg = `feat(play): include correlate category in hexagon update

Closes #7

intent(scoring): fix hexagon so correlate progress is visible
decision(scoring): add correlate to category list in Phase 3
rejected(scoring): full recalculation would be slower`;

    const result = parseCommitMessage(msg);
    assert.equal(result.valid, true);
    assert.equal(result.type, 'feat');
    assert.equal(result.scope, 'play');
    assert.equal(result.hasIntent, true);
    assert.equal(result.actionLines.length, 3);
    assert.equal(result.issueRefs.length, 1);
    assert.equal(result.issueRefs[0], 'Closes #7');
  });

  it('parses a minimal commit (type + scope + intent only)', () => {
    const msg = `chore(git): update config

intent(git): sync config with new defaults`;

    const result = parseCommitMessage(msg);
    assert.equal(result.valid, true);
    assert.equal(result.type, 'chore');
    assert.equal(result.hasIntent, true);
    assert.equal(result.actionLines.length, 1);
  });

  it('rejects invalid type', () => {
    const msg = 'build(git): add webpack config';
    const result = parseCommitMessage(msg);
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('Invalid type'));
  });

  it('rejects header ending with period', () => {
    const msg = 'feat(play): add new feature.';
    const result = parseCommitMessage(msg);
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('period'));
  });

  it('rejects missing scope', () => {
    const msg = 'feat: no scope here';
    const result = parseCommitMessage(msg);
    assert.equal(result.valid, false);
  });

  it('parses Ref issue references', () => {
    const msg = `fix(web): patch API endpoint

Ref #12

intent(web): fix 500 error on dashboard load`;

    const result = parseCommitMessage(msg);
    assert.equal(result.valid, true);
    assert.equal(result.issueRefs[0], 'Ref #12');
  });

  it('handles multi-line action values with indentation', () => {
    const msg = `feat(sim): add new scenario

intent(sim): cover DynamoDB throttling
decision(sim): use CloudWatch metrics approach
  instead of raw API error counts because
  errors miss throttled reads entirely`;

    const result = parseCommitMessage(msg);
    assert.equal(result.valid, true);
    assert.equal(result.actionLines.length, 2);
  });

  it('recognizes all 5 action line types', () => {
    const msg = `feat(play): complex change

intent(play): goal
decision(play): approach
rejected(play): alternative
constraint(play): limit
learned(play): quirk`;

    const result = parseCommitMessage(msg);
    assert.equal(result.valid, true);
    assert.equal(result.actionLines.length, 5);
    const types = result.actionLines.map(a => a.type);
    assert.deepEqual(types, ['intent', 'decision', 'rejected', 'constraint', 'learned']);
  });
});

// Export for potential reuse by other tests or scripts
module.exports = { parseCommitMessage, VALID_TYPES, HEADER_PATTERN, ACTION_LINE_PATTERN };
