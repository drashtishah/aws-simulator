---
name: render
description: Convert terminal recordings (.cast files) to MP4 video using Remotion and xterm.js. Lists recordings with metadata, renders with configurable speed and quality. Use when user says "render", "make video", "convert recording", "export mp4", or "render cast".
---

# render Skill

Converts asciinema .cast recordings to MP4 video files.

---

## Prerequisites

Before rendering, verify:

1. **Node.js**: `command -v node`. If missing, stop and tell the player to install Node.js.
2. **video/node_modules**: Check if `video/node_modules` exists. If missing, run `cd video && npm install`.
3. **Recordings**: Check `learning/recordings/` for `.cast` files. If none found, tell the player: "No recordings found in learning/recordings/. Record a session with asciinema first."

---

## Steps

### 1. List recordings with metadata

Scan `learning/recordings/*.cast` and display a table with:

- Filename
- Date (from filename or file mtime)
- Duration (sum of relative timestamps from events)
- Terminal size (cols x rows from header)
- Render status (whether a matching .mp4 exists)

Use python3 to extract metadata from .cast files. For v3 format, read the header line for `term.cols` and `term.rows`, then sum relative timestamps from event lines for duration. For v2 format, read `width` and `height` from the JSON header, and use the last event timestamp for duration.

```bash
python3 -c "
import json, sys, os

cast_file = sys.argv[1]
with open(cast_file) as f:
    first_line = f.readline().strip()
    header = json.loads(first_line)

    # v2 format
    if 'width' in header:
        cols = header['width']
        rows = header['height']
        # read all lines, last timestamp is duration
        last_ts = 0
        for line in f:
            line = line.strip()
            if line:
                event = json.loads(line)
                last_ts = event[0]
        print(f'{cols}x{rows},{last_ts:.1f}s')
    # v3 format
    else:
        cols = header.get('term', {}).get('cols', '?')
        rows = header.get('term', {}).get('rows', '?')
        duration = 0
        for line in f:
            line = line.strip()
            if line:
                parts = line.split(' ', 2)
                if len(parts) >= 1:
                    try:
                        duration += float(parts[0])
                    except ValueError:
                        pass
        print(f'{cols}x{rows},{duration:.1f}s')
" FILE
```

Present the table and ask which recording to render (if more than one).

### 2. Configure render options

Ask the player (or accept defaults):

- **Speed multiplier**: Default 1x. Higher values compress playback (e.g., 2x plays twice as fast, producing a shorter video).
- **Quality preset**: `draft` (crf=28, faster) or `final` (crf=18, best quality). Default is `draft`.

### 3. Extract metadata

Copy the selected .cast file to `video/public/recording.cast`:

```bash
cp learning/recordings/SELECTED.cast video/public/recording.cast
```

Extract cast metadata for the Remotion composition:

```bash
cd video && npx tsx -e "
import { getCastMeta } from './src/cast-utils';
const meta = await getCastMeta('public/recording.cast');
console.log(JSON.stringify(meta));
"
```

This returns `{ durationInSeconds, cols, rows }` which determines the frame count.

### 4. Render

Calculate total frames: `durationInSeconds / speedMultiplier * 30` (30 fps).

Run the Remotion render:

```bash
cd video && npx remotion render src/index.ts CastVideo \
  --output ../learning/recordings/OUTPUT_NAME.mp4 \
  --props='{"speed": SPEED_MULTIPLIER}' \
  --frames=0-TOTAL_FRAMES \
  --codec=h264 \
  --crf=CRF_VALUE
```

Output filename: same as the .cast file but with `.mp4` extension. Place it in `learning/recordings/`.

### 5. Clean up

Remove the temporary copy:

```bash
rm video/public/recording.cast
```

Report success with the output path, file size, and duration.

---

## Creative Customization

For advanced video customization (adding music, text overlays, intro/outro sequences, scene transitions), read `references/remotion-guide.md` in this skill directory. The rendering pipeline uses xterm.js (not asciinema-player) for terminal rendering. Terminal colors are customizable via the theme object in `video/src/Terminal.tsx`.

---

## Rules

1. No emojis.
2. Never delete original .cast files. Only the temporary copy in video/public/ gets removed.
3. Always clean up video/public/recording.cast after render (success or failure).
4. All rendered output goes to learning/recordings/.
5. If the render fails, show the error output and suggest checking that video/node_modules is up to date.
