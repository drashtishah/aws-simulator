import path from 'node:path';
import * as paths from './paths.js';
import type { CanUseTool, PermissionResult } from '@anthropic-ai/claude-agent-sdk';

export interface AgentPolicy {
  allowedTools: string[];
  permissionMode: string;
  canUseTool: CanUseTool;
}

function makeWritePolicy(allowedRelPrefixes: string[]): CanUseTool {
  const absPrefixes = allowedRelPrefixes.map(p =>
    path.isAbsolute(p) ? p : path.resolve(paths.ROOT, p)
  );
  const rootWithSep = paths.ROOT + path.sep;

  return async (toolName: string, input: Record<string, unknown>): Promise<PermissionResult> => {
    if (toolName !== 'Write') {
      return { behavior: 'allow' };
    }
    const filePath = typeof input.file_path === 'string' ? input.file_path : '';
    const resolved = path.isAbsolute(filePath)
      ? path.resolve(filePath)
      : path.resolve(paths.ROOT, filePath);

    if (!resolved.startsWith(rootWithSep) && resolved !== paths.ROOT) {
      return { behavior: 'deny', message: `Write denied: path outside workspace root` };
    }

    for (const absPrefix of absPrefixes) {
      if (resolved.startsWith(absPrefix + path.sep) || resolved === absPrefix) {
        return { behavior: 'allow' };
      }
    }

    return { behavior: 'deny', message: `Write denied: ${filePath} is outside allowed write directories` };
  };
}

export function PLAY_AGENT_POLICY(simId: string): AgentPolicy {
  return {
    allowedTools: ['Read', 'Write'],
    permissionMode: 'default',
    canUseTool: makeWritePolicy([`learning/sessions/${simId}`])
  };
}

export function POST_SESSION_POLICY(simId: string): AgentPolicy {
  return {
    allowedTools: ['Read', 'Write'],
    permissionMode: 'default',
    canUseTool: makeWritePolicy([`learning/sessions/${simId}`])
  };
}
