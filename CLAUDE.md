# AWS Incident Simulator

Interactive AWS incident-response game played through Claude Code skills.

## Skills

- `/setup` -- run once after cloning to create player profile in learning/
- `/play` -- run a simulation; the main game loop
- `/create-sim` -- generate new sim packages (for authors, not players)
- `/feedback` -- log a note during play about the sim system
- `/fix` -- apply accumulated feedback to skills

## Conventions

- No emojis
- Flat, quiet narrative tone
- AWS console responses in native format (JSON, log lines, metric tables)
- All player data lives in learning/ (gitignored)
- Static service reference in services/catalog.csv; player progress in learning/catalog.csv
