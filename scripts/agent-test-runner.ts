import { query } from '@anthropic-ai/claude-agent-sdk';

const MODEL = 'claude-sonnet-4-6';
const TIMEOUT_MS = 60000;

interface Finding {
  dimension: string;
  pass: boolean;
  detail: string;
}

interface AgentCheckResult {
  pass: boolean;
  findings: Finding[];
  usage: { input_tokens: number; output_tokens: number } | null;
  error: string | null;
  rawText?: string;
}

interface AgentCheckOptions {
  prompt: string;
  systemPrompt?: string;
}

interface ParsedResponse {
  pass: boolean;
  findings?: Finding[];
}

interface QueryOptions {
  model: string;
  permissionMode: string;
  maxTurns: number;
  systemPrompt?: string;
}

interface ContentBlock {
  type: string;
  text?: string;
}

interface AssistantMessage {
  type: 'assistant';
  message: { content?: ContentBlock[] };
}

interface ResultMessage {
  type: 'result';
  usage?: { input_tokens?: number; output_tokens?: number };
}

type QueryMessage = AssistantMessage | ResultMessage | { type: string };

/**
 * Parse a JSON object from agent response text.
 * Handles: bare JSON, ```json fenced blocks, JSON within prose.
 * Returns parsed object or null if no valid JSON found.
 */
function parseAgentJSON(text: string): ParsedResponse | null {
  if (!text) return null;

  // Try ```json fenced block first
  const fenced = text.match(/```json\s*\n([\s\S]*?)\n```/);
  if (fenced) {
    try { return JSON.parse(fenced[1]!) as ParsedResponse; } catch {}
  }

  // Try bare JSON object
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try { return JSON.parse(braceMatch[0]) as ParsedResponse; } catch {}
  }

  return null;
}

/**
 * Run an agent-in-the-loop check.
 * Sends prompt to Sonnet, expects structured JSON response.
 */
async function runAgentCheck({ prompt, systemPrompt }: AgentCheckOptions): Promise<AgentCheckResult> {
  const queryOptions: QueryOptions = {
    model: MODEL,
    permissionMode: 'bypassPermissions',
    maxTurns: 1
  };

  if (systemPrompt) {
    queryOptions.systemPrompt = systemPrompt;
  }

  let fullText = '';
  let usage: { input_tokens: number; output_tokens: number } | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Agent check timed out after ${TIMEOUT_MS / 1000}s`));
    }, TIMEOUT_MS);
    if (timer.unref) timer.unref();
  });

  const run = async (): Promise<void> => {
    for await (const msg of query({ prompt, options: queryOptions as Parameters<typeof query>[0]['options'] }) as AsyncIterable<QueryMessage>) {
      if (msg.type === 'assistant' && 'message' in msg) {
        const assistantMsg = msg as AssistantMessage;
        for (const block of (assistantMsg.message.content || [])) {
          if (block.type === 'text') {
            fullText += block.text;
          }
        }
      } else if (msg.type === 'result') {
        const resultMsg = msg as ResultMessage;
        const u = resultMsg.usage || {};
        usage = {
          input_tokens: u.input_tokens || 0,
          output_tokens: u.output_tokens || 0
        };
      }
    }
  };

  try {
    await Promise.race([run(), timeoutPromise]);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      pass: false,
      findings: [{ dimension: 'agent_error', pass: false, detail: message }],
      usage,
      error: message
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

export { runAgentCheck, parseAgentJSON };
export type { AgentCheckResult, AgentCheckOptions, Finding, ParsedResponse };
