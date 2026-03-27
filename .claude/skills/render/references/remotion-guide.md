---
tags:
  - type/reference
  - scope/render
---

# Remotion Customization Guide

Reference for extending the cast-to-video pipeline beyond default rendering.

## Architecture

The video renderer lives in `video/` and uses Remotion 4. Terminal playback uses xterm.js, not asciinema-player (asciinema-player does not render in Remotion's headless Chrome environment). The Terminal component in `video/src/Terminal.tsx` parses .cast files (both v2 and v3 formats) and replays events through xterm.js with frame-accurate seeking.

Terminal colors are customizable via the theme object in `video/src/Terminal.tsx`. Modify the `ITheme` properties there to change the color scheme of rendered videos.

## Remotion Agent Skills

Remotion's official Agent Skills are installed at `.claude/skills/remotion-best-practices/`. These provide detailed guidance on Remotion patterns, APIs, and best practices. Consult them when making changes to the Remotion composition or adding new visual features.

To use: read the skill files in `.claude/skills/remotion-best-practices/` for comprehensive Remotion development patterns.

## Adding Background Music

Use Remotion's `<Audio>` component to add music tracks:

```tsx
import { Audio, staticFile } from "remotion";

// Place audio files in video/public/
<Audio src={staticFile("music.mp3")} volume={0.3} />
```

Key considerations:
- Place audio files in `video/public/`
- Use `volume` prop to keep music subtle behind terminal audio
- Use `startFrom` and `endAt` props to trim audio to match video length
- Remotion handles audio mixing automatically during render

## YouTube Optimization

For YouTube-ready output:

- **Resolution**: 1920x1080 (set composition width/height in `video/src/Root.tsx`)
- **Codec**: h264 (default in the render command)
- **Quality**: crf=18 for final uploads (the "final" preset)
- **Frame rate**: 30fps (Remotion default)

Structure for polished videos:
- **Intro**: 2-3 second title card with sim name and scenario description
- **Main content**: Terminal recording playback
- **Outro**: Summary card with key learnings or next steps

## Text Overlays

Use Remotion's `interpolate()` for animated text:

```tsx
import { interpolate, useCurrentFrame } from "remotion";

const frame = useCurrentFrame();
const opacity = interpolate(frame, [0, 30], [0, 1], {
  extrapolateRight: "clamp",
});

<div style={{ opacity, fontSize: 48, color: "white" }}>
  Incident: S3 Bucket Policy Misconfiguration
</div>
```

Common patterns:
- Fade in/out with opacity interpolation
- Slide in from edges using translateX/translateY
- Scale animations for emphasis
- Spring animations with `spring()` for natural motion

## Scene Transitions

Use Remotion's `<Series>` component to sequence scenes:

```tsx
import { Series } from "remotion";

<Series>
  <Series.Sequence durationInFrames={90}>
    <IntroCard title="S3 Incident Response" />
  </Series.Sequence>
  <Series.Sequence durationInFrames={totalRecordingFrames}>
    <CastVideo />
  </Series.Sequence>
  <Series.Sequence durationInFrames={150}>
    <OutroCard learnings={["Check bucket policies", "Enable CloudTrail"]} />
  </Series.Sequence>
</Series>
```

For cross-fade transitions between scenes, use overlapping `<Sequence>` components with opacity interpolation on both the outgoing and incoming scenes.

## Composition Configuration

The main composition is defined in `video/src/Root.tsx`. To change video dimensions, frame rate, or default props, edit the `<Composition>` element there. The `CastVideo` component in `video/src/index.ts` is the entry point that Remotion renders.

## Rendering Tips

- Draft renders (crf=28) are faster and good for previewing layout changes
- Final renders (crf=18) produce higher quality but take longer
- Use `--log=verbose` flag with `npx remotion render` to debug rendering issues
- The `--frames` flag can render a subset of frames for quick preview of specific sections
