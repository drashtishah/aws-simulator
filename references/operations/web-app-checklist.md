---
tags:
  - type/reference
  - scope/web-app
---

# Web App Breakage Checklist

Before making any change to `sims/`, `themes/`, `.claude/skills/`, `learning/` schemas, or `web/`, scan this checklist. For each item, ask: does my change affect this? If yes, handle it.

## Server and Subprocess

- [ ] Port 3200 is not hardcoded elsewhere (fallback tries 3201, 3202)
- [ ] `which claude` check runs on startup
- [ ] `sims/registry.json` existence check runs on startup
- [ ] Claude subprocess uses `--append-system-prompt-file`, not `--system-prompt`
- [ ] Claude subprocess uses `--dangerously-skip-permissions` and `--allowedTools "Read,Write"`
- [ ] Claude subprocess uses `--model opus` for play (per scripts/model-config.json)
- [ ] Environment variables CLAUDECODE, CLAUDE_CODE_ENTRYPOINT, CLAUDE_CODE_SESSION, CLAUDE_CODE_PARENT_SESSION are stripped from subprocess env
- [ ] Only one active session at a time (startSession ends previous)
- [ ] `--resume` uses the Claude session ID, not our session ID
- [ ] Retry without `--resume` on "unknown session" error
- [ ] Temp prompt files written to `/tmp/aws-sim-prompt-{uuid}.txt`
- [ ] Temp prompt files cleaned up on endSession and sessionComplete
- [ ] 120s timeout per subprocess with SIGTERM then SIGKILL
- [ ] Subprocess stdin is closed after writing the message
- [ ] Process exit is awaited before reading stdout
- [ ] Non-zero exit code with empty stdout is treated as crash
- [ ] PATH must include claude binary location

## Prompt Builder

- [ ] Template extracted from triple-backtick fence in agent-prompts.md
- [ ] `{narrator.personality}` replaced with JSON.stringify of personality object
- [ ] `{company.name}`, `{company.industry}`, `{company.size}` replaced
- [ ] `{story.md contents}` placeholder replaced with full story.md
- [ ] `{artifacts/context.txt contents}` replaced
- [ ] `{artifacts/architecture-hint.txt contents}` replaced
- [ ] `{artifacts/architecture-resolution.txt contents}` replaced
- [ ] Fix criteria loop expanded from manifest.resolution.fix_criteria
- [ ] Hints loop expanded with text, relevant_services, skip_if_queried
- [ ] `{narrator.max_hints_before_nudge}` replaced (appears twice in template)
- [ ] Story beats loop expanded with trigger and section/facts/message
- [ ] Narrative arc fields expanded (call, threshold, trials, revelation, return)
- [ ] `{theme.base}` replaced with _base.md content (frontmatter stripped)
- [ ] `{theme.voice}` replaced with theme file content (frontmatter stripped)
- [ ] Glossary loop expanded as term/definition pairs
- [ ] System narration: data_flow, components loop, what_broke
- [ ] Console data: service name, capabilities, artifact contents inline
- [ ] `{sim_id}` replaced globally (appears in session file paths)
- [ ] Web session rules appended at end
- [ ] Unresolved `{...}` placeholders logged as PROMPT_PLACEHOLDER_UNRESOLVED
- [ ] Missing artifact files logged as ARTIFACT_MISSING with fallback text
- [ ] Null/undefined manifest fields handled without crashing
- [ ] Hints use `hint.hint` field (not `hint.text`) per manifest schema

## File I/O

- [ ] JSON.parse wrapped in try/catch for all external file reads
- [ ] profile.json returns default `{ skill_polygon: {}, completed_sims: [] }` if missing/corrupt
- [ ] registry.json returns `{ sims: [] }` if missing/corrupt
- [ ] sessions directory missing returns empty array
- [ ] journal.md empty or missing returns empty array
- [ ] journal.md parser splits on `## ` headers
- [ ] Theme files read at request time, not cached
- [ ] Manifest read at sim-start time, not cached
- [ ] File reads use UTF-8 encoding
- [ ] Paths resolved relative to project root, not __dirname
- [ ] No file writes from server.js (all writes via Claude subprocess)

## SSE Streaming

- [ ] Content-Type: text/event-stream header set
- [ ] Cache-Control: no-cache header set
- [ ] Each SSE event is `data: {json}\n\n` (double newline)
- [ ] First event for /game/start is `type: session` with sessionId
- [ ] Last event is `type: done`
- [ ] `type: complete` sent when [SESSION_COMPLETE] detected
- [ ] `type: error` sent on subprocess failure
- [ ] Response stream ended with res.end() after done
- [ ] `[CONSOLE_START]`/`[CONSOLE_END]` markers parsed into `type: console` events
- [ ] `[COACHING_START]`/`[COACHING_END]` markers parsed into `type: coaching` events

## Frontend

- [ ] localStorage reads wrapped in try/catch
- [ ] Default UI theme: dracula
- [ ] Default narrative theme: calm-mentor
- [ ] Theme CSS loaded via `<link>` tag with id="ui-theme"
- [ ] Sim picker grid uses `repeat(auto-fill, minmax(280px, 1fr))`
- [ ] Chat messages use `role="log" aria-live="polite"`
- [ ] Nav tabs use `role="tablist"` and `aria-selected`
- [ ] Settings button has `aria-label`
- [ ] Input textarea auto-resizes up to 120px max-height
- [ ] Enter sends message, Shift+Enter inserts newline
- [ ] Typing indicator shown during subprocess wait
- [ ] Auto-scroll pinned to bottom unless user scrolled up
- [ ] "New messages" pill shown when not scrolled to bottom
- [ ] Quit button shows confirm dialog

## Data Contracts

- [ ] profile.json: rank_title, skill_polygon, polygon_last_advanced, completed_sims, challenge_runs, rank_history
- [ ] session state: sim_id, status, criteria_met, criteria_remaining, last_active, investigation_summary, hints_used, questions_asked, story_beats_fired, services_queried
- [ ] journal.md: entries split by `## ` headers, Date and Key Takeaway fields
- [ ] registry.json: version, sims array with id, title, difficulty, category, services, estimated_minutes
- [ ] manifest.json: id, title, company, team.narrator, team.consoles, resolution
- [ ] catalog.csv: service, full_name, category, cert_relevance, knowledge_score, sims_completed, last_practiced, notes

## Observability

- [ ] All events logged to learning/logs/activity.jsonl (shared hook + web logger)
- [ ] Hook script at .claude/hooks/log-hook.js
- [ ] Hooks configured in .claude/settings.local.json (PreToolUse, PostToolUse, Stop)
- [ ] learning/logs/ in .gitignore
- [ ] Warning thresholds: context >80%, latency >30s, tool loop >5
- [ ] Autosave verification after each turn
- [ ] Autosave fail count resets on success, logs error at count >= 3

## Tests

- [ ] `test run` passes all unit tests
- [ ] `test agent` passes all YAML browser specs
- [ ] `test personas` produces findings for all 5 personas
- [ ] All API endpoints have unit tests (GET and POST routes)
- [ ] Game endpoints tested for 400 (validation) and 503 (no claude-process)
- [ ] Logger thresholds tested (context, latency, tool loop)
- [ ] parseStreamJson tested for all marker types (console, coaching, complete)
- [ ] verifyAutosave tested for all failure modes
- [ ] buildPrompt tested with all registered sims and themes
- [ ] Browser specs: navigation, dashboard, sim picker, chat, settings all covered
- [ ] Browser specs: layout assertions for responsive breakpoints (1280px, 480px, 375px)
- [ ] Browser specs: ARIA roles, attributes, keyboard navigation covered
- [ ] Guard coverage: `web/test-specs/` in NEVER_WRITABLE_DIRS
- [ ] Color contrast meets WCAG 2.1 AA (4.5:1 minimum)
- [ ] All catch blocks in server.js log descriptive errors (endpoint, entity ID, cause)
