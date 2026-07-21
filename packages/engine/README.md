# @sequio/engine

**A command-style object-graph engine for building video editors on top of
[PixiJS v8](https://pixijs.com/).**

You construct a tree of `Track / Clip / Effect` objects and drive a clock; the
engine owns the low-level runtime — **decode, composite, audio, export**.
Persistence, schema, undo, collaboration and UI are intentionally out of scope;
they belong to the layer above.

> **Invariant**: `render(t)` is a pure function of the object graph + `t` — the
> same tree and the same `t` always produce the same frame. That is what makes
> export reproducible and golden-frame testing possible.

## Install

```bash
npm install @sequio/engine
```

Both runtime dependencies — [`pixi.js`](https://pixijs.com/) (the renderer) and
`mediabunny` (WebCodecs mux/demux) — are installed for you. They stay **external**
in the engine's own bundle, so if your app already imports `pixi.js` directly the
package manager dedupes to a single copy (Pixi is stateful — two copies break).

## Quick start

```ts
import { Compositor, VisualTrack, TextClip } from '@sequio/engine';

const compositor = new Compositor({ width: 1920, height: 1080 });
await compositor.init();                    // create the GPU renderer
document.body.append(compositor.view);      // the output <canvas>

const track = new VisualTrack();
const title = new TextClip({ text: 'Hello, sequio', fontSize: 96 });
title.start = 0;
title.end = 3;
track.add(title);
compositor.addTrack(track);

// Preview: best-effort prepare + immediate sync render (may drop frames).
compositor.renderPreview(0.5);
```

## Render to a canvas (complete example)

The engine never repaints on its own (contract #5): you build a graph, drive a
clock, and each tick renders one frame to the compositor's `<canvas>`. This is a
full, self-contained loop — a shape and a title, animated over three seconds, on
screen with playback:

```ts
import {
  Compositor,
  VisualTrack,
  ShapeClip,
  TextClip,
  RealtimeClock,
  Timebase,
} from '@sequio/engine';

const WIDTH = 1280;
const HEIGHT = 720;
const DURATION = 3; // seconds

async function main() {
  // 1. Create the compositor and its GPU renderer, then mount the <canvas>.
  const compositor = new Compositor({
    width: WIDTH,
    height: HEIGHT,
    timebase: new Timebase(30), // 30 fps
    background: 0x0b0b0e,
  });
  await compositor.init();               // WebGPU preferred, WebGL fallback
  document.body.append(compositor.view); // compositor.view is the output canvas

  // 2. Build the object graph: a track carrying a moving box and a title.
  const track = new VisualTrack();

  const box = new ShapeClip({ kind: 'rect', width: 160, height: 160, fill: 0x2b6cff });
  box.start = 0;
  box.end = DURATION;
  box.transform.anchor.setStatic([0.5, 0.5]);
  // Keyframed motion + a full rotation over the clip's life.
  box.transform.position.setKeyframes([
    { time: 0, value: [220, HEIGHT / 2] },
    { time: DURATION, value: [WIDTH - 220, HEIGHT / 2] },
  ]);
  box.transform.rotation.setKeyframes([
    { time: 0, value: 0 },
    { time: DURATION, value: Math.PI * 2 },
  ]);
  track.add(box);

  const title = new TextClip({ text: 'sequio', fontSize: 120, fill: 0xffffff });
  title.start = 0;
  title.end = DURATION;
  title.transform.anchor.setStatic([0.5, 0.5]);
  title.transform.position.setStatic([WIDTH / 2, HEIGHT - 120]);
  track.add(title);

  compositor.addTrack(track);

  // 3. Drive a clock; every tick renders that frame to the canvas. Passing the
  //    compositor's timebase makes it tick once per frame (not per display
  //    refresh) and frame-snap seeks.
  const clock = new RealtimeClock(compositor.timebase);
  clock.duration = DURATION;
  clock.onTick((t) => compositor.renderPreview(t)); // best-effort prepare + render
  clock.seek(0);   // paint the first frame immediately
  clock.play();    // animate to the end (holds the last frame there)
}

main();
```

`renderPreview(t)` is the preview path (best-effort decode, may drop frames).
For a frame-accurate encode to a video file, drive a `FixedStepClock` through the
[`Exporter`](https://github.com/slightc/sequio/blob/main/docs/architecture.md)
instead — same render core, but it `await`s every decode so no frame is dropped.

See the [architecture guide](https://github.com/slightc/sequio/blob/main/docs/architecture.md)
and the [`example/`](https://github.com/slightc/sequio/tree/main/packages/engine/example)
demos for the full surface (video/image/audio sources, effects, transitions,
text animation, and the `Exporter`). A runnable version of the example above
lives at [`example/render-to-canvas.html`](https://github.com/slightc/sequio/blob/main/packages/engine/example/render-to-canvas.ts).

## Running the demos locally

The `example/` folder is a set of runnable pages — full demos (an AV player,
multi-track compositing, effects, export, a GSAP-driven timeline) and the
`*-test` pages that back the `pnpm verify:*` browser e2e checks. Start the Vite
dev server and open any page in a WebCodecs-capable browser:

```bash
pnpm install          # from the workspace root, once
pnpm dev:engine       # serves this package on http://localhost:6173

# or from inside packages/engine:
pnpm dev
```

Then open <http://localhost:6173> — `index.html` is a directory of every demo
and verify page. WebCodecs (used for video decode/export) is required, so use a
current Chrome/Edge; Safari and Firefox coverage varies.

To run the automated browser checks headlessly instead of clicking through the
pages, use the `verify:*` scripts (they drive the same `*-test` pages with
Puppeteer's Chrome-for-Testing — fetch it once with
`pnpm exec puppeteer browsers install chrome`):

```bash
pnpm verify:render    # multi-track stacking / opacity / blend mode
pnpm verify:clips     # image / text / shape clips on screen
pnpm verify:effects   # color/blur effect + crossfade
pnpm verify:export    # Exporter → MP4/WebM, decoded back and checked
# …see package.json for the full verify:* list
```

## The five contracts

1. **Async `prepare` / sync `render` split** — preview does best-effort
   `prepare(t)` then `renderSync(t)`; export `await`s `prepare(t)` and never
   drops a frame.
2. **`render(t)` is pure** in (object graph, t) — no hidden frame-to-frame or
   wall-clock state.
3. **Preview and export share one render core** — same resolution and color
   pipeline (sRGB↔linear, premultiplied alpha).
4. **Explicit resource ownership** — `VideoFrame` / `Texture` / `RenderTexture`
   and decoders are disposed explicitly, each with a budget + LRU eviction.
5. **Invalidate / dirty-flag** — the engine never repaints on its own; mutations
   mark dirty and the host schedules the repaint.

## License

MIT © [slightc](https://github.com/slightc/sequio)
