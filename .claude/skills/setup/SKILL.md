---
name: setup
description: Initialize the local workspace for a new player. Creates the learning directory, profile, journal, and feedback files. Verifies sim packages and MCP configuration. Use when user says "setup", "initialize", or on first clone.
---

# setup Skill

Prepares the workspace for a new player. Run once after cloning.

---

## Steps

### 1. Check learning directory

If `learning/` does not exist, create it. If `learning/sessions/` does not exist, create it.

### 2. Create profile

If `learning/profile.json` does not exist, create it:

```json
{
  "current_level": 1,
  "completed_sims": [],
  "unlocked_levels": [1],
  "service_exposure": {},
  "question_patterns": {
    "first_action_frequency": {},
    "avg_questions_before_fix": 0,
    "audit_trail_check_rate": 0,
    "multi_service_investigation_rate": 0
  },
  "weaknesses": [],
  "strengths": [],
  "total_sessions": 0,
  "last_session": null
}
```

If it already exists, leave it. Do not overwrite.

### 3. Create journal

If `learning/journal.md` does not exist, create it:

```markdown
---
tags:
  - type/learning-journal
  - domain/aws-simulator
---

# Learning Journal

Progress entries are added automatically after each completed simulation.
```

### 4. Create feedback log

If `learning/feedback.md` does not exist, create it:

```markdown
---
tags:
  - type/log
  - scope/feedback
---

# Simulation Feedback

Feedback collected during play sessions via /feedback. Processed after each sim resolution.
```

### 5. Create services catalog

If `learning/catalog.csv` does not exist, generate it with a starter set of high-priority services extracted from `references/exam-topics.md`. Each row uses the merged format:

```csv
service,full_name,category,cert_relevance,knowledge_score,sims_completed,last_practiced,notes
```

All progress columns default to `0,0,,`.

If `learning/catalog.csv` already exists, leave it. Do not overwrite.

### 6. Verify sim packages

Read `sims/registry.json`. Count the entries. If the file is missing, warn the user: "No simulations found. The sims/ directory may be incomplete."

### 7. Verify MCP configuration

Check that `.mcp.json` exists and contains `aws-knowledge-mcp-server`. If missing, warn the user: "The AWS Knowledge MCP server is not configured. Some features of /create-sim will be limited."

This is not a blocker. The MCP server enriches sim creation but is not required for playing existing sims.

### 8. Check recording tools

Check whether `asciinema`, `agg`, and `ffmpeg` are available on the system PATH:

```bash
command -v asciinema; command -v agg; command -v ffmpeg
```

If all three are found:

> Recording tools are installed. Run ./record to capture a session for YouTube.

If any are missing, detect the player's platform by checking which package manager is available, then give the appropriate install command:

- `brew` exists: `brew install {missing tools}`
- `apt` exists: `sudo apt install {missing tools}` (note: agg may need to be downloaded from https://github.com/asciinema/agg/releases)
- `pacman` exists: `pacman -S {missing tools}` (agg from AUR or GitHub releases)
- `dnf` exists: `sudo dnf install {missing tools}`
- None found: list each tool with its install page (asciinema.org, github.com/asciinema/agg, ffmpeg.org)

Format as a single install command the player can copy-paste. Example:

> Recording tools (optional): asciinema and agg not found. Install with:
>   brew install asciinema agg
> This is only needed if you want to record sessions for YouTube.

This is not a blocker. Recording is optional.

### 8b. Check asciinema authentication

If asciinema was found in Step 8, check whether it is linked to an account:

```bash
test -f ~/.config/asciinema/install-id && echo "authenticated" || echo "not authenticated"
```

If not authenticated:

> asciinema is installed but not linked to an account. To publish recordings later, run:
>
>     asciinema auth
>
> This opens a browser to link your CLI. You can skip this now and do it when you first run /publish.

If authenticated:

> asciinema is authenticated. Run /publish after recording a session to upload it.

This step is informational only. It does not block setup.

### 9. Welcome

Print the number of available sims and current profile state. Use flat, quiet tone:

> Everything is in order. {n} simulations are loaded. Your profile is fresh -- level 1, nothing completed. Run /play when you are ready.

If the profile already had progress:

> Workspace verified. {n} simulations loaded. You have completed {completed} so far, currently at level {level}. Run /play to continue.

---

## Rules

1. No emojis.
2. Do not modify any existing files. Only create missing ones.
3. Do not start a simulation. Setup is setup.
