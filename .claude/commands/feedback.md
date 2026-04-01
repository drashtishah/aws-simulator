Log a feedback note for the simulation system.

Append the following entry to `learning/feedback.md`:

```
### $CURRENT_DATE

$ARGUMENTS
```

If a sim session is active (any `.json` file exists in `learning/sessions/`), read the session file to get the `sim_id` and prefix the entry:

```
### $CURRENT_DATE (during {sim_id})

$ARGUMENTS
```

Also append `$ARGUMENTS` to the `feedback_notes` array in that session file.

After appending, confirm: "Noted."

Do not analyze the feedback. Do not modify any skill files. Just log and continue.
