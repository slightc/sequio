# video-editor-canvas

A **command-style object-graph engine** for building video editors on top of
[PixiJS v8](https://pixijs.com/). You build a tree of `Track / Clip / Effect`
objects and drive a clock; the SDK owns the low-level runtime — **decode,
composite, audio, export**. Persistence, schema, undo, collaboration and UI are
left to the layer above.

> **Invariant**: `render(t)` is a pure function of the object graph + `t` — the
> same tree and the same `t` always produce the same frame. That is what makes
> export reproducible and golden-frame testing possible.

## Status

Early scaffold. The architecture, public API surface and pure-logic modules
(time, animation, caches) are in place and tested; the heavy runtime pieces
(WebCodecs decode, PixiJS render core, audio, export) are stubbed and tracked in
[`todo/`](todo/). Stubs `throw` with a pointer to the milestone that fills them.

| Module | Status |
|---|---|
| `time/` — Timebase, Clock | ✅ implemented |
| `animation/` — AnimatableProperty, Transform2D, Easing | ✅ implemented |
| `media/` — FrameCache | ✅ implemented · decode 🚧 |
| `texture/` — budget + LRU | 🚧 |
| `compositor/` — graph + Reconciler | ✅ · render core 🚧 |
| `effects/`, `audio/`, `export/` | 🚧 interfaces only |

## Quick start

```bash
pnpm install
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit
pnpm build       # ESM + CJS + d.ts
```

```ts
import { Timebase, RealtimeClock, Compositor, VisualTrack } from 'video-editor-canvas';

const timebase = new Timebase(30);
const compositor = new Compositor({ width: 1920, height: 1080, timebase });
compositor.addTrack(new VisualTrack());

const clock = new RealtimeClock();
clock.onTick((t) => compositor.renderPreview(t)); // wire clock → preview
clock.start();
```

`pixi.js` is a **peer dependency** — install it in the consuming app.

## Docs

- [Architecture & design](docs/architecture.md)
- [Contributor / agent guide](AGENT.md) (`CLAUDE.md` symlinks to it)
- [Roadmap & tasks](todo/)

## License

MIT
