# /fix parallel fetching tasks

/fix dispatches these six fetching tasks in one parallel batch via
`superpowers:dispatching-parallel-agents` as the first step of its
Flow (see `.claude/skills/fix/SKILL.md`). Each task runs in its own
subagent so the raw bytes never land in main context. Each task
returns a compact summary under ~300 words containing ONLY what the
main-context grouping needs.

Synthesis (step 5 grouping and splitting) stays in main context per
the "never delegate understanding" rule. These subagents are pure
fetchers, not judges.

Reason: Issue #124. Serial fetching in main context burned tokens
unnecessarily and ran slower than the six independent reads required.

## Dispatch contract

- All six tasks are independent (no shared state, no cross-dependencies).
- Each task receives the exact prompt below, verbatim.
- Each task returns its summary as a plain-text block; /fix concatenates
  the six blocks into the input bundle.
- Token budget per task: 300 words of output, hard cap. If the raw source
  has more than 300 words of relevant content, the subagent summarizes
  by date range or by rank. Raw dumps are forbidden.
- Verification of the bundle (are all six summaries present and
  well-formed?) happens in main context after the parallel dispatch
  returns.

## Task 1: open Issues

Prompt (verbatim):

> Run `gh issue list --state open --json number,title,labels,body --limit 200`. For each returned Issue, output one line in the form `#N [label1,label2] title` where labels come from the `labels[].name` field. Then add a second line with at most 12 words of the Issue body as a one-line hook, quoted. Sort by Issue number ascending. Do not return the full body. Hard cap: 300 words total.

Output schema:

```
#N [label,label] one-line title
  "first 12 words of body..."
```

## Task 2: feedback deltas

Prompt (verbatim):

> Read `learning/feedback.md`. Then list every file under `learning/system-vault/feedback/` that has an `mtime` newer than the last /fix run's decision article under `learning/system-vault/decisions/` (find the newest decisions/*.md and compare). For each feedback entry or article, output one line: `YYYY-MM-DD: theme (source)` where source is either the feedback.md heading or the article filename. Note whether each theme matches an existing Issue (by grep over the open-Issue titles supplied in Task 1's output, if you have it; otherwise mark "unmatched"). Hard cap: 300 words.

Output schema:

```
YYYY-MM-DD: theme (source) [matched #N | orphan]
```

## Task 3: vault prior art

Prompt (verbatim):

> Given the themes list from Tasks 1 and 2 (if available, otherwise the latest feedback themes), run `system-vault-query` against each theme to find prior decisions, findings, and workarounds. For each hit, output one line: `theme -> learning/system-vault/<subdir>/<article>.md: one-line relevance`. Do not quote article bodies. If a theme has no hits, output `theme -> no prior art`. Hard cap: 300 words.

Output schema:

```
theme -> learning/system-vault/<subdir>/<article>.md: one-line relevance
```

## Task 4: top health findings

Prompt (verbatim):

> Read the tail of `learning/logs/health-scores.jsonl` (last line only). Parse the `findings[]` array. Sort by `expected_gain_if_fixed` descending. Output the top 10 as one line each: `<bucket> <metric> <file>:<line> gain=<expected_gain_if_fixed> -- <description in <= 15 words>`. Hard cap: 300 words.

Output schema:

```
<bucket> <metric> <file>:<line> gain=<n> -- <description>
```

## Task 5: contradictory-instructions scanner

Prompt (verbatim):

> Sweep `CLAUDE.md`, every `.claude/skills/*/SKILL.md` `## Rules` section, and per-user memory files under `~/.claude/projects/-Users-drashti-experiments-aws-simulator/memory/` for rules that conflict on the same topic (e.g., two different cadences for the same test, two different commit-author rules, two different "never do X" rules that disagree). For each conflict, output one line: `CONFLICT: file1:line1 vs file2:line2 -- one-line topic`. If no conflicts found, output `CONFLICT: none`. Hard cap: 300 words.

Output schema:

```
CONFLICT: file1:line1 vs file2:line2 -- topic
```

## Task 6: old-plan staleness scanner

Prompt (verbatim):

> List every file under the gitignored `.claude/plans/` directory. For each plan file, run `grep -oE '[a-zA-Z_/.-]+\.(md|ts|json|jsonl|py)' <plan>` and check which referenced paths no longer exist. Output one line per plan: `<plan path>: <N> missing refs` with the first 3 missing paths listed inline, or `<plan path>: fresh` if all references still resolve. Hard cap: 300 words.

Output schema:

```
.claude/plans/<slug>.md: N missing refs (path1, path2, path3)
.claude/plans/<slug>.md: fresh
```

## Why 300 words per task

A 300-word cap is empirically enough to carry the grouping signal
forward (Issue titles, dates, paths, scores) while small enough that
six summaries concatenated stay under ~2k words total. Serial
fetching in main context previously spent 10x to 50x that on raw
Issue bodies, vault article contents, and full health-scores JSON
payloads, none of which the grouping heuristics needed.
