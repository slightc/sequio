---
name: sequio
description: >-
  Build, preview, and export/render video with sequio (@sequio/engine +
  @sequio/runtime + @sequio/cli). Use this whenever a task involves composing
  video/motion-graphics programmatically — creating a timeline of tracks and
  clips (text, image, video, shapes), animating them (keyframes or GSAP),
  applying effects/transitions, mixing audio, and exporting to MP4/WebM or
  rendering server-side. Triggers: "sequio", "video editor SDK", "compose a
  video", "timeline / track / clip", "render an mp4 from code", "TextClip",
  "Compositor", "defineComposition".
---

# Using sequio

sequio is a **command-style object-graph engine** for building video on top of
**PixiJS v8**. You construct a tree of `Track / Clip / Effect` objects and drive
a clock; the SDK owns decode, composite, audio, and export. It is *not*
declarative JSON — you write ordinary imperative TypeScript with the engine's own
classes, so anything that runs in a demo runs everywhere (browser preview,
browser export, server render).

## Decide the entry point first

Pick the package that matches the task before writing code:

| Goal | Use | Import from |
|---|---|---|
| Drive an object graph in an app you control | **engine** directly | `@sequio/engine` |
| Author a self-contained composition file that previews **and** renders | **runtime** authoring API | `@sequio/engine` + `@sequio/runtime` |
| Turn a composition file into an `.mp4`, a single-frame PNG, or a live preview from a terminal | **cli** | `sequio render` / `sequio frame` / `sequio preview` |
| Render a composition to a file on a server (no browser) | **server** Route B | `@sequio/server/route-b` |

For most "make me a video from code" tasks, author a **composition file** (runtime
API) and drive it with the **CLI** — that is the path the examples use.

## The mental model (do not fight these)

sequio rests on five invariants. Respect them and everything composes; break them
and preview/export diverge:

1. **Async `prepare` / sync `render`.** Decoding is async; a frame is a pure sync
   render once inputs are ready. You rarely call these directly — the Compositor,
   preview clock, and Exporter do.
2. **`render(t)` is a pure function of (object graph, `t`).** No dependence on the
   previous frame or wall-clock. This is what makes export reproducible. Never
   store per-frame mutable state that a later `render(t)` reads back.
3. **Preview and export share one render core** — same resolution and color
   pipeline. A composition that looks right in preview renders identically.
4. **Explicit resource ownership.** Every SDK object has `dispose()`. Long-lived
   apps must dispose what they create; a one-shot render is torn down for you.
5. **Invalidate / dirty-flag.** The engine never repaints on its own. Mutating a
   property marks the graph dirty; the host schedules a repaint.

## Author a composition (the common path)

A composition is a TS/JS module whose default export is `defineComposition(builder)`.
Inside the builder you `new` engine classes exactly like a demo — no `env`
plumbing. Times are **seconds** at the API boundary.

```ts
import { Compositor, VisualTrack, TextClip, ShapeClip, easeInOutCubic } from '@sequio/engine';
import { defineComposition } from '@sequio/runtime';

export default defineComposition(async () => {
  const compositor = new Compositor({ width: 1280, height: 720, fps: 30, background: 0x0b0b0e });
  await compositor.init();

  // A background rectangle for the whole timeline.
  const bg = new VisualTrack();
  const backdrop = new ShapeClip({ kind: 'rect', width: 1280, height: 720, fill: 0x0f172a });
  backdrop.start = 0;
  backdrop.end = 4;
  backdrop.transform.anchor.setStatic([0, 0]);
  backdrop.transform.position.setStatic([0, 0]);
  bg.add(backdrop);
  compositor.addTrack(bg);

  // A title on a higher track (z-index stacks tracks).
  const text = new VisualTrack();
  text.zIndex = 1;
  const title = new TextClip({ text: 'sequio', fontSize: 72, fill: 0xffffff });
  title.start = 0;
  title.end = 4;
  title.transform.anchor.setStatic([0.5, 0.5]);
  // Keyframe the position (values interpolate with the given easing).
  title.transform.position.setKeyframes([
    { time: 0, value: [640, 300] },
    { time: 4, value: [640, 420], easing: easeInOutCubic },
  ]);
  text.add(title);
  compositor.addTrack(text);

  return { compositor, duration: 4 }; // `duration` optional — derived from clip ends
});
```

Then, from the workspace root:

```bash
sequio preview composition.ts --watch                    # live in-browser preview, reloads on edit
sequio frame   composition.ts --time 2 --out shot.png     # export ONE frame at t=2s as a PNG (fast visual check)
sequio audio   composition.ts --out track.mp3            # export ONLY the audio mix (mp3 default; also m4a/wav/ogg/webm)
sequio render  composition.ts --out out.mp4              # encode the whole thing to video (pure-Node WebGPU)
sequio render  composition.ts --out out.mp4 --scale 2    # 2× resolution (sharp text/edges)
```

`sequio render`, `sequio frame` and `sequio audio` need a WebGPU host — a real GPU or the Mesa
**lavapipe** software driver (`apt install mesa-vulkan-drivers`; then
`export VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json`). Without one they
throw a clear error.

### Check your work fast: export a single frame

When iterating on a composition **without** a live browser (e.g. you're an agent
editing code), don't render the whole video to see if it's right — export one
frame and look at it:

```bash
sequio frame composition.ts --time 2.5 --out /tmp/check.png    # then open/view the PNG
```

`frame` runs the **same render core** as `render` (contract #3), so the PNG is
exactly what the video would contain at that instant — the fast way to confirm
layout, position, and color before committing to a full render. `--time` is
clamped to `[0, duration]`; `--scale N` renders at N× like `render`. This is the
recommended verify loop: edit → `sequio frame` at a few representative times →
eyeball → then `sequio render` once it looks right.

## Core building blocks

- **`Compositor({ width, height, fps?, background?, timebase? })`** — the root. Call
  `await compositor.init()` before adding tracks; `compositor.addTrack(track)`.
- **Tracks**: `VisualTrack` (stacked by `.zIndex`) and `AudioTrack`. A track holds
  clips: `track.add(clip)`.
- **Clips** carry `.start` / `.end` (seconds) and a `.transform` (a `Transform2D`
  with `position`, `scale`, `rotation`, `anchor`, `alpha` — each an
  `AnimatableProperty` you drive with `.setStatic(v)` or `.setKeyframes([...])`):
  - `TextClip({ text, fontFamily?, fontSize?, fill? })`
  - `ImageClip` / `VideoClip` (backed by an `ImageSource` / `VideoSource`)
  - `ShapeClip({ kind: 'rect' | 'ellipse' | ..., width, height, fill })`
  - `GroupClip` — nest clips and transform them together.
- **`anchor`** is normalized (`[0.5, 0.5]` = center); `position` is in pixels.

## Animation

- **Keyframes** — `prop.setKeyframes([{ time, value, easing? }, ...])`. Easings are
  exported: `linear`, `easeInOutCubic`, `cubicBezier(...)`, etc.
- **GSAP** — the engine ships *no* gsap dependency but has a binding. The host
  injects gsap; the CLI already does, so a composition can just:
  ```ts
  import gsap from 'gsap';
  import { gsapClipAnimator } from '@sequio/engine';
  clip.animator = gsapClipAnimator(gsap, (tl, o) => tl.from(o, { y: -60, alpha: 0, ease: 'back.out(1.7)' }));
  ```
  The binding seeks a **paused** timeline, keeping `render(t)` pure.
- **Text motion** — `TextClip.split` + `TextClip.textAnimator` (`StaggerTextAnimator`
  / `gsapTextAnimator`) animate per line/word/char (e.g. a staggered drop-in).
- **Bring your own** — the four seams are subclass/implement points: subclass
  `Effect` / `Transition` (or an engine effect) and implement `ClipAnimator`
  (`clip.animator`) / `TextAnimator` (`textClip.textAnimator`). Build on the
  engine's own classes and no `pixi.js` is needed — same in preview and render.
  See recipe 7b and `packages/cli/example/custom-fx/`.

## Media, fonts, effects, audio, export — quick pointers

- **Media**: `new VideoSource({ src })` / `new ImageSource({ src })` accept a URL or
  a `Blob`. For a file next to the composition, use runtime's
  `await loadAsset('./clip.mp4')` (host provides the bytes; never bundled).
- **Fonts**: `await fonts.load({ family, src })` before using the family in a
  `TextClip`. Load an explicit web font so preview and Node render match — system
  defaults differ per platform.
- **Effects/Transitions**: `ColorEffect`, `BlurEffect`, `BulgeEffect`,
  `CrossfadeTransition`, etc. (some — chroma/LUT/wipe — are still TODO). Attach an
  effect with `clip.effects.push(fx)`; bind a transition with
  `track.addTransition(new T(frames).between(a, b))` over the clips' overlap.
  Roll your own by subclassing — see recipe 7b.
- **Audio**: `AudioTrack` + `AudioSource`; `AudioEngine` mixes (Web Audio live,
  OfflineAudioContext for export).
- **Export in an app** (not the CLI): use `Exporter` from `@sequio/engine`
  (`export(...)` → video, `exportFrame(t, ...)` → one still image, `exportAudio(...)`
  → audio-only file), or a runtime `Composer`'s `composer.export(...)`. Audio-only
  on the CLI is `sequio audio composition.ts` (recipe 11).

## Before you finish

- Load `references/api.md` for the exact public surface (every exported class/type)
  and `references/recipes.md` for fuller copy-paste patterns.
- Keep the public API surface honest: it is whatever
  `packages/engine/src/index.ts` exports.
- If a code path throws "not implemented", that milestone is unbuilt — see the
  pointer in the error and `todo/`. Do not paper over it.
