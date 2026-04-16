---
name: play
description: Run an AWS incident simulation via the web app. Starts the server, opens the browser, and hands off to the web-based game loop. Use when user says "play", "start sim", "run simulation", "practice AWS", or "let's play".
effort: low
references_system_vault: true
---

# play Skill

Launches the AWS Incident Simulator web app. All gameplay, coaching, scoring, and learning updates happen through the web app and its Agent SDK integration.

## Steps

### 0. Check Workspace

If any of the following are missing, tell the user: "Run `/setup` first to initialize your workspace." and stop.

- `learning/` directory
- `learning/profile.json`

### 1. Clean Up Stale Lock

Check if `learning/logs/.web-active.lock` exists.

- Read the lock file to get the PID
- Check if the PID is still running: `kill -0 {pid} 2>/dev/null && echo running || echo stopped`
- If running: tell the player "The simulator is already running at http://localhost:{port}." and stop.
- If NOT running: the lock is stale. Delete it and continue.

### 2. Install Dependencies

If `node_modules/` does not exist, run `npm install`.

### 3. Start the Server

Run `npm start` in the background using Bash (do not wait for it to exit).

### 4. Open the Browser

Wait 2 seconds for the server to start, then run `open http://localhost:3200`.

### 5. Done

Tell the user: "The simulator is running at http://localhost:3200. Play from your browser. When you are done, press Ctrl+C in the terminal to stop the server."

Stop. Do not proceed further. The web app handles the entire game loop.
