---
tags: [type/reference, scope/security, status/active]
---

# Agent Write Policies

Source of truth: `web/lib/agent-policies.ts`.

## Role matrix

| Role | allowedTools | permissionMode | Writable paths |
| --- | --- | --- | --- |
| Play narrator | Read, Write | default | `learning/sessions/{simId}/` |
| Post-session analysis (Tier 1, classifier) | Read, Write | default | `learning/sessions/{simId}/` |
| Post-session (Tier 2, renderer) | (none, Node fs direct) | n/a | `learning/player-vault/`, `learning/profile.json` |
| generate-openings | (none) | default | none (Node fs.writeFileSync direct) |
| agent-test-runner | (none) | default | none (single-turn grader) |

## Evaluation order

1. `allowedTools` list gates which tool names the agent may call. Any tool not in the list is blocked before `canUseTool` is invoked.
2. `canUseTool(toolName, input, options)` is called for each allowed tool use. For Write, the policy resolves `input.file_path` against `paths.ROOT` and checks it against the role's allowed write prefixes. Paths outside `paths.ROOT` or outside the allowed prefixes return `{ behavior: 'deny' }`.
3. `permissionMode: 'default'` applies after both checks.

Path resolution: relative `file_path` values are resolved with `path.resolve(paths.ROOT, filePath)`. Absolute paths are normalized with `path.resolve(filePath)`. Both sides of any prefix comparison use `path.resolve` to prevent traversal bypasses.

## How to add a new role

1. Open `web/lib/agent-policies.ts`.
2. Add an exported function that returns `AgentPolicy`:
   ```ts
   export function MY_ROLE_POLICY(simId: string): AgentPolicy {
     return {
       allowedTools: ['Read', 'Write'],
       permissionMode: 'default',
       canUseTool: makeWritePolicy(['learning/my-allowed-dir'])
     };
   }
   ```
3. Spread the policy into the `queryOptions` block at the call site:
   ```ts
   const queryOptions = { cwd: paths.ROOT, ...MY_ROLE_POLICY(simId), model, maxTurns };
   ```
4. Add a row to the role matrix above.
5. Add unit tests in `web/test/agent-policies.test.ts` following the existing `describe` blocks.
6. Run `npm test` and `npm run audit:permissions` to verify.
