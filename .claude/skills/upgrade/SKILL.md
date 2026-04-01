---
name: upgrade
description: Scan Claude Code ecosystem sources for updates and surface improvements relevant to this workspace. USE WHEN upgrade, check updates, what's new, ecosystem changes, claude code updates, new features, source check.
---

# Upgrade

Check what's new in the Claude Code ecosystem and find improvements for this workspace.

## Step 1: Load Workspace Context

Before checking sources, read these files to build a context summary describing what this workspace uses:

| File | What to extract |
|------|----------------|
| `CLAUDE.md` | Project type, conventions, skills list, tooling commands |
| `.mcp.json` | MCP servers in use: aws-knowledge, chrome-devtools, shadcn-ui, stitch |
| `.claude/settings.local.json` | Plugins (superpowers, playground, cli-anything), agent teams flag |
| `.claude/hooks/guard-write.js` | Hook type (PreToolUse Write), protection model (skill ownership, protected paths) |
| `.claude/hooks/log-hook.js` | Hook types (PostToolUse, SessionStart/End, PreCompact, PostCompact, UserPromptSubmit, PostToolUseFailure), JSONL logging pattern |
| `references/workspace-map.md` | Component diagram, data flow, shared data files, test layers |
| `package.json` | Scripts (test, health, extract-paths, design:*, feedback:personas), dependencies (express, js-yaml, acorn, commander) |
| `references/testing-system.md` | 3-layer test architecture: deterministic (node --test), agent browser (YAML specs + Chrome DevTools MCP), agent persona (JSON profiles) |
| `.claude/skills/*/SKILL.md` | Frontmatter only: name + description of each skill (play, create-sim, setup, fix, sim-test) |

If `.claude/skills/upgrade/references/workspace-context.md` exists and is recent, use it directly instead of re-reading all files. Only rebuild context from source files if the workspace has changed significantly.

Produce a structured summary to pass as context to each source-checking agent.

## Step 2: Source Checking (3 parallel agents)

Load `.claude/skills/upgrade/references/sources.json` and `.claude/skills/upgrade/state/last-check.json`, then launch 3 agents in parallel.

### Agent 1: GitHub Releases and Commits

```
Check GitHub repositories for new releases and commits since last check.

Load state from: .claude/skills/upgrade/state/last-check.json
Load sources from: .claude/skills/upgrade/references/sources.json

For each repo in sources.github_repos:
  If check_releases is true:
    Run: gh api "repos/{owner}/{repo}/releases?per_page=5" --jq '.[] | {tag_name, published_at, body, html_url}'
    Compare tag_name against state.github["https://github.com/{owner}/{repo}"].last_release_tag
    For NEW releases only: extract version, date, full release notes body

  If check_commits is true:
    Run: gh api "repos/{owner}/{repo}/commits?per_page=10&since={state.github[key].last_commit_date or 14_days_ago}" --jq '.[] | {sha, commit: {message: .commit.message, date: .commit.author.date}, html_url}'
    Compare SHA against state.github["https://github.com/{owner}/{repo}"].last_commit_sha
    For NEW commits only: extract SHA, message, date

WORKSPACE CONTEXT:
{workspace_context_summary}

For each finding, assess:
- Does this affect hooks? (this workspace uses PreToolUse guard-write + 6-event log-hook)
- Does this affect skills? (5 skills: play, create-sim, setup, fix, sim-test)
- Does this affect MCP? (uses aws-knowledge, chrome-devtools, shadcn-ui, stitch)
- Does this affect testing? (3-layer: node --test, agent browser YAML specs, agent personas)
- Does this affect plugins? (superpowers, playground, cli-anything, agent teams)

Return format per finding:
{
  "source": "anthropics/claude-code v1.0.20",
  "type": "release",
  "title": "...",
  "date": "...",
  "url": "...",
  "details": "... (quoted release notes or commit message)",
  "workspace_relevance": "HIGH/MEDIUM/LOW/NONE",
  "relevance_reason": "Affects guard-write.js because...",
  "affected_files": [".claude/hooks/guard-write.js"]
}

Filter out findings with workspace_relevance = NONE.
```

### Agent 2: Changelogs and Documentation

```
Check changelog and documentation pages for new content.

Load state from: .claude/skills/upgrade/state/last-check.json
Load sources from: .claude/skills/upgrade/references/sources.json

For each source in sources.changelogs:
  WebFetch the URL
  Extract entries/sections that are newer than state.changelogs[name].last_date
  For each new entry: extract the specific feature, code pattern, or config change

For each source in sources.documentation (only HIGH priority):
  WebFetch the URL
  Compare content hash against state.documentation[name].content_hash
  If changed: identify what sections are new or modified

WORKSPACE CONTEXT:
{workspace_context_summary}

EXTRACTION RULES:
- Pull specific techniques: command flags, API signatures, config options, hook patterns
- Quote the actual documentation text
- Do NOT return vague summaries like "new features added"
- If a changelog entry has no extractable technique relevant to this workspace, skip it

Return format per finding:
{
  "source": "Claude Code CHANGELOG v1.0.20",
  "type": "changelog",
  "title": "PreToolUse hooks support additionalContext",
  "date": "...",
  "details": "> PreToolUse hooks can now return { additionalContext: '...' } to inject reasoning context before tool execution",
  "workspace_relevance": "HIGH/MEDIUM/LOW",
  "relevance_reason": "guard-write.js currently returns allow/block. additionalContext would let it inject warnings instead of hard-blocking.",
  "affected_files": [".claude/hooks/guard-write.js"],
  "technique": "return { decision: 'allow', additionalContext: 'WARNING: Protected file.' };"
}
```

### Agent 3: Blogs and Community

```
Check Anthropic blogs for new posts relevant to this workspace.

Load sources from: .claude/skills/upgrade/references/sources.json
Load state from: .claude/skills/upgrade/state/last-check.json

For each source in sources.blogs:
  WebFetch the URL
  Scan for posts newer than state.blogs[name].last_date
  For new posts: extract title, date, URL, and a 1-2 sentence summary of what's announced

WORKSPACE CONTEXT:
{workspace_context_summary}

Only return posts that have potential relevance to:
- Claude Code skills, hooks, or MCP (this workspace is skill-heavy)
- Agent workflows or multi-agent patterns (this workspace uses agent teams)
- Testing patterns for AI-driven tools (this workspace has 3-layer agent testing)
- Express web apps with Claude integration (this workspace has web/ with Claude subprocess)

For each relevant post, if possible WebFetch the full post and extract specific techniques.

Return format per finding:
{
  "source": "Anthropic News",
  "type": "blog",
  "title": "...",
  "date": "...",
  "url": "...",
  "summary": "...",
  "workspace_relevance": "HIGH/MEDIUM/LOW",
  "relevance_reason": "...",
  "technique": "... (if extractable, otherwise null)"
}
```

## Step 3: Synthesis and Scoring

After all 3 agents return, merge findings and score:

| Factor | Weight | Scale |
|--------|--------|-------|
| Workspace relevance (does it touch files we have?) | 3x | HIGH=10, MEDIUM=5, LOW=2 |
| Impact (how much does it improve things?) | 2x | 1-10 |
| Effort (how easy to adopt?) | 1x | 10=trivial, 1=major refactor |

Priority tiers based on weighted score:
- HIGH (score >= 40): Act on these. Fixes gaps or unlocks capabilities.
- MEDIUM (score 20-39): When convenient. Useful but not urgent.
- LOW (score < 20): Awareness. Nice to know, may become relevant later.

## Step 4: Output Report

```markdown
# Upgrade Report
**Generated:** [timestamp]
**Workspace:** aws-simulator
**Last check:** [previous timestamp or "first run"]
**Sources checked:** [N] repos | [N] changelogs | [N] blogs/docs
**New findings:** [N] relevant | [N] skipped

---

## Discoveries

| # | What's New | Source | Why It Matters Here |
|---|-----------|--------|---------------------|
| 1 | [specific feature/change] | [repo/changelog/blog] | [names specific workspace file it affects] |

---

## Recommendations

### HIGH
| # | What to Do | Why | Effort | Files |
|---|-----------|-----|--------|-------|

### MEDIUM
| # | What to Do | Why | Effort | Files |
|---|-----------|-----|--------|-------|

### LOW
| # | What to Do | Why | Effort | Files |
|---|-----------|-----|--------|-------|

---

## Details

### [N]. [Feature Name]
**Source:** [exact source with version/date]
**Priority:** HIGH | MEDIUM | LOW

**What it is:**
[16-32 words describing the feature/change]

**How it helps this workspace:**
[16-32 words naming specific files and what improves]

**The technique:**
> [quoted source content, code example, or config pattern]

**Applies to:** `[file path]`
**Implementation:**
// before (current pattern)
...
// after (with this technique)
...

---

## Skipped

| Item | Source | Why Skipped |
|------|--------|-------------|
| [thing] | [source] | [not relevant to this workspace / no extractable technique] |

---

## Sources Processed

[list of what was checked with counts]
```

## Step 5: State Update

After outputting the report, update `.claude/skills/upgrade/state/last-check.json`:

```
For each github repo checked:
  state.github["https://github.com/{owner}/{repo}"].last_release_tag = latest tag seen
  state.github["https://github.com/{owner}/{repo}"].last_commit_sha = latest SHA seen
  state.github["https://github.com/{owner}/{repo}"].last_commit_date = latest commit date

For each changelog:
  state.changelogs[name].last_date = latest entry date seen

For each blog:
  state.blogs[name].last_date = latest post date seen

For each doc:
  state.documentation[name].content_hash = hash of content

state.last_check_timestamp = now
```

## Output Rules

1. Extract, don't summarize: show actual code patterns, config changes, API signatures
2. Map to workspace: every recommendation must name a specific file in this project
3. Quote the source: include the actual documentation text or code
4. Skip boldly: if something has no technique relevant here, put it in Skipped
5. No "check out this link" recommendations: extract the technique itself
6. Two descriptions per detail (16-32 words each): "What it is" and "How it helps this workspace"

Anti-patterns to reject:
- "Check out the new release" (no technique extracted)
- "This could be useful" (no specific file named)
- "Several updates available" (no specifics)

## Git Discipline

When implementing recommendations from the upgrade report, follow `.claude/skills/git/references/commit-procedure.md` after each change. Create GitHub Issues per `.claude/skills/git/references/issue-workflow.md` for each recommendation being implemented.
