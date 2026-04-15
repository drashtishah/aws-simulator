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
    // Gate both Write and Edit. Edit also mutates files, so any write-scoping
    // policy must cover it. NotebookEdit is not currently in use; add here if
    // that changes.
    if (toolName !== 'Write' && toolName !== 'Edit') {
      return { behavior: 'allow' };
    }
    const filePath = typeof input.file_path === 'string' ? input.file_path : '';
    const resolved = path.isAbsolute(filePath)
      ? path.resolve(filePath)
      : path.resolve(paths.ROOT, filePath);

    if (!resolved.startsWith(rootWithSep) && resolved !== paths.ROOT) {
      return { behavior: 'deny', message: `${toolName} denied: path outside workspace root` };
    }

    for (const absPrefix of absPrefixes) {
      if (resolved.startsWith(absPrefix + path.sep) || resolved === absPrefix) {
        return { behavior: 'allow' };
      }
    }

    return { behavior: 'deny', message: `${toolName} denied: ${filePath} is outside allowed write directories` };
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
  const writePolicy = makeWritePolicy([`learning/sessions/${simId}`]);
  const verifierPath = path.resolve(paths.ROOT, 'scripts', 'verify-classification.ts');
  const allowedVerifierCommand = new RegExp(
    `^(/[^\\s]+/)?npx\\s+tsx\\s+${escapeRegex(verifierPath)}\\s+${escapeRegex(simId)}\\s*$`
  );

  return {
    allowedTools: ['Read', 'Write', 'Bash'],
    permissionMode: 'default',
    canUseTool: async (toolName, input, options) => {
      if (toolName === 'Bash') {
        const command = typeof input.command === 'string' ? input.command : '';
        if (allowedVerifierCommand.test(command.trim())) {
          return { behavior: 'allow' };
        }
        return {
          behavior: 'deny',
          message: `Bash denied: only the classification verifier command is allowed (npx tsx ${verifierPath} ${simId})`
        };
      }
      return writePolicy(toolName, input, options);
    }
  };
}

export function CONSOLIDATOR_POLICY(): AgentPolicy {
  return {
    allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
    permissionMode: 'default',
    canUseTool: makeWritePolicy(['learning/player-vault/insights']),
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
