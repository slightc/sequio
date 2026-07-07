# Sequio

**Programmable timelines for web video and AI.**

A **pnpm monorepo** for a PixiJS-based video editor, split into three packages:

| Package | Name | What it is |
|---|---|---|
| [`packages/engine`](packages/engine) | `@sequio/engine` | The SDK: a command-style object-graph runtime — **decode, composite, audio, export**. The published library. |
| [`packages/server`](packages/server) | `@sequio/server` | **Server-side rendering** — a serializable `TimelineSpec` protocol plus two render routes (headless Chrome / pure-Node WebGPU). Depends on engine. |
| [`packages/studio`](packages/studio) | `@sequio/studio` | A reference **multi-track editor** app (timeline, canvas manipulation, forked export, Server Render). Depends on engine + server. |

The **engine** is a command-style object-graph engine on top of
[PixiJS v8](https://pixijs.com/): you build a tree of `Track / Clip / Effect`
objects and drive a clock; it owns the low-level runtime. Persistence, schema,
undo, collaboration and UI are left to the layer above — the `studio` package is
a reference consumer, not part of the SDK surface.

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

Commands run from the workspace root and fan out to the packages:

```bash
pnpm install     # install + link the workspace
pnpm test        # vitest across every package (pnpm -r test)
pnpm typecheck   # tsc --noEmit across every package
pnpm build       # build the engine library (ESM + CJS + d.ts)
pnpm dev         # run the studio editor (dev:engine / dev:server for the others)
```

```ts
import { Timebase, RealtimeClock, Compositor, VisualTrack } from '@sequio/engine';

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
