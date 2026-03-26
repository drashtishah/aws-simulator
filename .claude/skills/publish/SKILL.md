---
name: publish
description: Upload, list, delete, and manage terminal recordings on asciinema.org. Use when user says "publish", "upload recording", "list recordings", "share session", "delete recording", or "how many videos".
---

# publish Skill

Manages terminal recordings on asciinema.org. Upload, list, delete, change visibility.

---

## Steps

### 1. Check prerequisites

Verify asciinema is installed:

```bash
command -v asciinema
```

If missing: "asciinema is not installed. Run /setup for install instructions." Stop.

Check authentication (mandatory). asciinema v3 stores the install-id in a different location than v2:

```bash
# v3 path (check first)
test -f ~/.local/state/asciinema/install-id && echo "authenticated" || \
# v2 path (fallback)
test -f ~/.config/asciinema/install-id && echo "authenticated" || echo "not authenticated"
```

If not authenticated:

> You are not authenticated with asciinema.org. Publishing requires authentication. Run this in your terminal:
>
>     asciinema auth
>
> This prints a connect URL. Open that URL in your browser while logged in to your asciinema.org account.
>
> If you are not sure whether you have an account, go to asciinema.org and sign up or log in first. Your profile page will be at a URL like `https://asciinema.org/~your-username` -- keep that handy to verify the connection worked.
>
> Run /publish again when done.

Stop. Do not proceed without authentication.

### 2. Load state

Read `learning/recordings/published.json`. If the file does not exist, treat as empty:

```json
{"recordings": []}
```

Read the install-id for API calls (check v3 path first, then v2 fallback):

```bash
cat ~/.local/state/asciinema/install-id 2>/dev/null || cat ~/.config/asciinema/install-id
```

Store this value -- it is needed for all API requests as HTTP Basic Auth password.

### 3. Ask what the user wants to do

Present options:
1. List recordings -- local files and their publish status
2. Publish a recording -- upload a .cast file (unlisted, shareable link)
3. Delete a published recording -- remove from asciinema.org
4. Make a recording public -- change visibility on asciinema.org

Wait for the user's choice.

### 4a. List recordings

For each `.cast` file in `learning/recordings/`, extract metadata:

```bash
# Recording date (from JSON header timestamp field)
head -1 FILE.cast | python3 -c "import sys,json; from datetime import datetime; d=json.load(sys.stdin); print(datetime.fromtimestamp(d['timestamp']).strftime('%Y-%m-%d %H:%M'))"

# Duration in seconds (first element of last line)
tail -1 FILE.cast | python3 -c "import sys,json; print(f'{json.load(sys.stdin)[0]:.0f}s')"

# File size (portable)
wc -c < FILE.cast
```

Format duration as `Xm Ys`. Format size as KB or MB.

Check if the filename appears in `published.json`. If yes, show the URL and visibility.

Present as a table:

```
File                      Date              Duration   Size     Status
20260326_140748.cast      2026-03-26 14:07  12m 34s    1.0 MB   not published
20260327_091500.cast      2026-03-27 09:15  8m 12s     640 KB   unlisted: https://asciinema.org/a/abc123
20260328_110000.cast      2026-03-28 11:00  5m 45s     400 KB   public: https://asciinema.org/a/def456
```

### 4b. Publish a recording

List `.cast` files that do not appear in `published.json`. If all are already published, say so and stop.

If only one unpublished file exists, confirm it. If multiple, ask the user to select one.

Ask for an optional title (free text). If skipped, omit the --title flag.

Upload as unlisted (always -- the link is shareable immediately):

```bash
asciinema upload --visibility unlisted [--title "TITLE"] learning/recordings/FILENAME.cast
```

If the command fails, show the error output and stop. Do not update published.json.

If it succeeds, parse the URL from the output -- it is the line starting with `https://`. Extract the recording ID from the URL (the last path segment, e.g., `abc123` from `https://asciinema.org/a/abc123`).

Add an entry to published.json:

```json
{
  "file": "FILENAME.cast",
  "id": "abc123",
  "url": "https://asciinema.org/a/abc123",
  "title": "TITLE or null",
  "visibility": "unlisted",
  "uploaded_at": "2026-03-26T15:30:00Z"
}
```

Write the updated JSON to `learning/recordings/published.json`.

Report the URL to the user:

> Published. Share this link: https://asciinema.org/a/abc123

### 4c. Delete a published recording

List recordings from `published.json`. If none, say so and stop.

Ask the user to select one. Show the URL and title for context.

Ask for confirmation: "This will delete the recording from asciinema.org. The local .cast file stays. Continue?"

If confirmed, delete via API:

```bash
INSTALL_ID=$(cat ~/.config/asciinema/install-id)
curl -s -o /dev/null -w "%{http_code}" -X DELETE -u ":${INSTALL_ID}" https://asciinema.org/api/v1/recordings/RECORDING_ID
```

If the response is 204, remove the entry from published.json and write the file. Report success.

If the response is anything else, show the status code and do not modify published.json.

### 4d. Make a recording public

List recordings from `published.json` that have visibility "unlisted" or "private". If none, say so and stop.

Ask the user to select one.

Confirm: "This will make the recording visible in public listings on asciinema.org. Continue?"

If confirmed, update via API:

```bash
INSTALL_ID=$(cat ~/.config/asciinema/install-id)
curl -s -o /dev/null -w "%{http_code}" -X PATCH \
  -u ":${INSTALL_ID}" \
  -H "Content-Type: application/json" \
  -d '{"visibility":"public"}' \
  https://asciinema.org/api/v1/recordings/RECORDING_ID
```

If the response is 200, update the visibility in published.json and write the file. Report success.

If the response is anything else, show the status code and do not modify published.json.

---

## Rules

1. No emojis.
2. Do not delete or move .cast files. This skill manages upload state only.
3. Never upload without authentication. If install-id is missing, stop and direct the user to run asciinema auth.
4. Always upload as unlisted. Never upload as public directly.
5. If asciinema upload or any API call fails, show the error and do not update published.json.
6. All paths are relative to the project root.
7. The install-id is sensitive. Do not print it to the user. Use it only in curl commands.
