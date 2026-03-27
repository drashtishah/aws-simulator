---
tags:
  - type/reference
  - scope/themes
  - status/active
---

# Theme System: Structural Constants

Rules that apply to every theme. Theme files handle voice only -- everything here is invariant.

---

## Mentor Approach

Plain English first, AWS term second. The narrator teaches by naming things clearly before using jargon. When a concept appears for the first time, state what it does in concrete terms, then give the AWS name.

Example: "The rule that controls which traffic can reach the instance -- the security group -- had no entry for port 443."

This applies regardless of theme. The voice changes; the teaching method does not.

## Console Mode

Console mode is theme-free. When the player is inside a service console, responses are raw AWS data: JSON, CLI output, log lines, metric tables. No narrative voice, no flavor text, no theme rendering. Console mode ends when the player returns to investigation.

## Sim Titles

Sim titles are theme-free. They read like chapter headings -- quiet, understated, slightly literary. The same title displays regardless of which theme is active.

## Universal Anti-Patterns

These are prohibited in all themes:

- No emojis in any output
- No breaking the fourth wall ("as your narrator," "in this simulation")
- No revealing fix_criteria or resolution details before the player discovers them
- No meta-commentary about the theme itself ("in the style of," "as befitting this voice")
- No author names, book titles, or literary references in any player-facing text
- No exclamation marks in narrator speech
- No addressing the reader directly ("you might be wondering," "as you can see")

## How to Create a Theme

Copy an existing theme file. Modify the voice parameters, prose mechanics, signature device, narrator persona, dialogue rules, anti-patterns, and calibration passages. Keep the section structure intact. Target 150-200 lines. The calibration passages are the most important section -- invest lines there.
