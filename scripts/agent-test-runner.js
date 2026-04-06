const { query } = require('@anthropic-ai/claude-agent-sdk');

const MODEL = 'claude-sonnet-4-6';
const TIMEOUT_MS = 60000;

/**
 * Parse a JSON object from agent response text.
 * Handles: bare JSON, ```json fenced blocks, JSON within prose.
 * Returns parsed object or null if no valid JSON found.
 */
function parseAgentJSON(text) {
  if (!text) return null;

  // Try ```json fenced block first
  const fenced = text.match(/```json\s*\n([\s\S]*?)\n```/);
  if (fenced) {
    try { return JSON.parse(fenced[1]); } catch {}
  }

  // Try bare JSON object
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try { return JSON.parse(braceMatch[0]); } catch {}
  }

  return null;
}

/**
 * Run an agent-in-the-loop check.
 * Sends prompt to Sonnet, expects structured JSON response.
 *
 * @param {object} opts
 * @param {string} opts.prompt - The full prompt including context and instructions
 * @param {string} [opts.systemPrompt] - Optional system prompt
 * @returns {Promise<{ pass: boolean, findings: Array, usage: object|null, error: string|null }>}
 */
async function runAgentCheck({ prompt, systemPrompt }) {
  const queryOptions = {
    model: MODEL,
    permissionMode: 'bypassPermissions',
    maxTurns: 1
  };

  if (systemPrompt) {
    queryOptions.systemPrompt = systemPrompt;
  }

  let fullText = '';
  let usage = null;

  const timeoutPromise = new Promise((_, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Agent check timed out after ${TIMEOUT_MS / 1000}s`));
    }, TIMEOUT_MS);
    if (timer.unref) timer.unref();
  });

  const run = async () => {
    for await (const msg of query({ prompt, options: queryOptions })) {
      if (msg.type === 'assistant' && msg.message) {
        for (const block of (msg.message.content || [])) {
          if (block.type === 'text') {
            fullText += block.text;
          }
        }
      } else if (msg.type === 'result') {
        const u = msg.usage || {};
        usage = {
          input_tokens: u.input_tokens || 0,
          output_tokens: u.output_tokens || 0
        };
      }
    }
  };

  try {
    await Promise.race([run(), timeoutPromise]);
  } catch (err) {
    return {
      pass: false,
      findings: [{ dimension: 'agent_error', pass: false, detail: err.message }],
      usage,
      error: err.message
    };
  }

  const parsed = parseAgentJSON(fullText);
  if (!parsed) {
    return {
      pass: false,
      findings: [{ dimension: 'parse_error', pass: false, detail: 'Failed to parse JSON from agent response' }],
      usage,
      error: 'JSON parse failure',
      rawText: fullText
    };
  }

  return {
    pass: Boolean(parsed.pass),
    findings: parsed.findings || [],
    usage,
    error: null
  };
}

module.exports = { runAgentCheck, parseAgentJSON };
