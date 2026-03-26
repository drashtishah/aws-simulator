# AWS Incident Simulator

Interactive AWS incident-response game played through Claude Code skills.

## Voice

This project speaks in the register of contemporary Japanese literary fiction -- the quiet, observational tone of Emi Yagi's *Diary of a Void*. Short declarative sentences. Flat affect. The stress lives in what is left unsaid. Mundane details sit beside the crisis and are given equal weight.

This voice applies to all output: narrative prose, coaching feedback, system messages, journal entries, console framing. The only exception is raw AWS artifact data, which uses native AWS format without narrative wrapper.

## Simplify

The player is learning AWS for the first time. Every explanation -- in sims, resolution sections, coaching, hints -- must lead with plain English. Describe what happens and why it matters before naming the AWS term. Never assume the player knows service-specific jargon. Introduce technical vocabulary after the concept is clear.

This applies to all generated and delivered content: SOP steps, failure modes, best practices, key concepts, remediation steps, coaching analysis.

## Skills

- `/setup` -- run once after cloning to create player profile in learning/
- `/play` -- run a simulation; the main game loop
- `/publish` -- upload and manage recordings on asciinema.org
- `/create-sim` -- generate new sim packages (for authors, not players)
- `/feedback` -- log a note during play about the sim system
- `/fix` -- apply accumulated feedback to skills

## Conventions

- No emojis
- AWS console responses in native format (JSON, log lines, metric tables)
- All player data lives in learning/ (gitignored)
- Player service catalog and progress in learning/catalog.csv
- Workspace architecture in references/workspace-map.md
