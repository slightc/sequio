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
npm install @sequio/engine pixi.js
```

`pixi.js` is a **peer dependency** (bring your own single copy). `mediabunny`
(WebCodecs mux/demux) ships as a runtime dependency.

## Quick start

```ts
import { Compositor, VisualTrack, TextClip, RealtimeClock } from '@sequio/engine';

const compositor = new Compositor({ width: 1920, height: 1080 });
const track = new VisualTrack();
track.add(new TextClip({ text: 'Hello, sequio', start: 0, duration: 3 }));
compositor.addTrack(track);

// Preview: best-effort prepare + immediate sync render (may drop frames).
await compositor.renderPreview(0.5);
```

See the [architecture guide](https://github.com/slightc/sequio/blob/main/docs/architecture.md)
and the [`example/`](https://github.com/slightc/sequio/tree/main/packages/engine/example)
demos for the full surface (video/image/audio sources, effects, transitions,
text animation, and the `Exporter`).

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
