import path from 'node:path';
import fs from 'node:fs';
import * as paths from './paths.js';

export const COLLECT_TIMEOUT_MS = 120000;

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
  id?: string;
}

interface SDKMsg {
  type: string;
  subtype?: string;
  session_id?: string;
  model?: string;
  message?: { content?: ContentBlock[] };
  usage?: { input_tokens?: number; output_tokens?: number };
  duration_ms?: number;
  is_error?: boolean;
  error?: unknown;
  terminal_reason?: string;
}

interface ToolCall {
  name: string;
  input: unknown;
  id: string;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  duration_ms?: number;
}

export interface ParsedMessages {
  claudeSessionId: string | null;
  claudeModel: string | null;
  fullText: string;
  toolCalls: ToolCall[];
  hasToolUse: boolean;
  usage: Usage | null;
  resultError: { subtype?: string; error: unknown } | null;
  terminalReason: string | null;
}

export interface ParsedEvent {
  type: string;
  content: string;
  label?: string;
  open?: boolean;
}

export interface ParsedEvents {
  events: ParsedEvent[];
  sessionComplete: boolean;
}

export function parseAgentMessages(messages: SDKMsg[]): ParsedMessages {
  let claudeSessionId: string | null = null;
  let claudeModel: string | null = null;
  const textParts: string[] = [];
  const toolCalls: ToolCall[] = [];
  let usage: Usage | null = null;

  for (const msg of messages) {
    if (msg.type === 'system' && msg.subtype === 'init') {
      claudeSessionId = msg.session_id ?? null;
      if (msg.model) claudeModel = msg.model;
    } else if (msg.type === 'assistant' && msg.message) {
      const content = msg.message.content ?? [];
      for (const block of content) {
        if (block.type === 'text') {
          textParts.push(block.text ?? '');
        } else if (block.type === 'tool_use') {
          toolCalls.push({ name: block.name!, input: block.input, id: block.id! });
        }
      }
    } else if (msg.type === 'result') {
      const u = msg.usage ?? {};
      usage = {
        input_tokens: u.input_tokens ?? 0,
        output_tokens: u.output_tokens ?? 0
      };
      if (msg.duration_ms) usage.duration_ms = msg.duration_ms;
    }
  }

  let resultError: { subtype?: string; error: unknown } | null = null;
  let terminalReason: string | null = null;

  for (const msg of messages) {
    if (msg.type === 'result') {
      if (msg.is_error || (msg.subtype && msg.subtype.startsWith('error_'))) {
        resultError = { subtype: msg.subtype, error: msg.error ?? null };
      }
      if (msg.terminal_reason) {
        terminalReason = msg.terminal_reason;
      }
    }
  }

  return {
    claudeSessionId,
    claudeModel,
    fullText: textParts.join(''),
    toolCalls,
    hasToolUse: toolCalls.length > 0,
    usage,
    resultError,
    terminalReason
  };
}

export function parseEvents(fullText: string): ParsedEvents {
  const events: ParsedEvent[] = [];
  const dropdownRegex = /\[DROPDOWN(?:\s+([^\]]*))?\]([\s\S]*?)\[\/DROPDOWN\]/g;
  let match: RegExpExecArray | null;
  let lastIndex = 0;

  while ((match = dropdownRegex.exec(fullText)) !== null) {
    if (match.index > lastIndex) {
      const text = fullText.slice(lastIndex, match.index);
      if (text.trim()) events.push({ type: 'text', content: text });
    }
    const attrs = parseAttrs(match[1] ?? '');
    events.push({
      type: 'dropdown',
      content: (match[2] ?? '').trim(),
      label: attrs.label ?? 'Details',
      open: attrs.open === 'true'
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < fullText.length) {
    const rest = fullText.slice(lastIndex);
    if (rest.trim()) events.push({ type: 'text', content: rest });
  }

  if (events.length === 0) {
    events.push({ type: 'text', content: fullText });
  }

  const sessionComplete = fullText.includes('[SESSION_COMPLETE]');
  if (sessionComplete) {
    for (const event of events) {
      if (event.content) {
        event.content = event.content.replace('[SESSION_COMPLETE]', '').trim();
      }
    }
  }

  return { events, sessionComplete };
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /(\w+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    attrs[m[1]!] = m[2]!;
  }
  return attrs;
}

export function logTurn(simId: string, turn: number, playerMessage: string, assistantMessage: string, usage?: Usage | null): void {
  const turnsPath = paths.turnsFile(simId);
  const dir = path.dirname(turnsPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const entry = {
    ts: new Date().toISOString(),
    turn,
    player_message: playerMessage,
    assistant_message: assistantMessage,
    usage: usage ?? {}
  };

  fs.appendFileSync(turnsPath, JSON.stringify(entry) + '\n');
}

export async function collectMessages<T>(asyncIterator: AsyncIterable<T>, timeoutMs = COLLECT_TIMEOUT_MS): Promise<T[]> {
  const messages: T[] = [];

  const timeout = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      const iter = asyncIterator as AsyncIterableIterator<T>;
      if (iter.return) {
        iter.return().catch(() => {});
      }
      reject(new Error(`AGENT_TIMEOUT: Response exceeded ${timeoutMs / 1000} seconds`));
    }, timeoutMs);
    if (timer.unref) timer.unref();
  });

  const collect = async (): Promise<T[]> => {
    for await (const message of asyncIterator) {
      messages.push(message);
    }
    return messages;
  };

  return Promise.race([collect(), timeout]);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  { maxAttempts = 3, delays = [1000, 2000, 4000] }: { maxAttempts?: number; delays?: number[] } = {}
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      const errObj = err as { status?: number; message?: string; headers?: { get?(k: string): string | null } };
      const isRateLimit = errObj.status === 429 || errObj.status === 529 || (errObj.message?.includes('rate_limit') ?? false);

      if (attempt === maxAttempts - 1) throw err;

      let delay = delays[attempt] ?? delays[delays.length - 1] ?? 4000;
      if (isRateLimit) {
        const retryAfter = errObj.headers?.get?.('retry-after');
        delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : Math.max(5000, delay);
      }

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
