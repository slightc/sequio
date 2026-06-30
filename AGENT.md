# AGENT.md

Guidance for AI coding agents (and humans) working in this repository.
`CLAUDE.md` is a symlink to this file.

## What this project is

`video-editor-canvas` is a **command-style object-graph engine** for building
video editors on top of **PixiJS v8**. Consumers construct a tree of
`Track / Clip / Effect` objects and drive a clock; the SDK owns the low-level
runtime: **decode, composite, audio, export**. Persistence, schema, undo,
collaboration and UI are explicitly **out of scope** — they belong to the layer
above.

Read [`docs/architecture.md`](docs/architecture.md) before making structural
changes.

## The five contracts (do not break these)

These are the invariants the whole design rests on. Any change must preserve them:

1. **Async `prepare` / sync `render` split.** Decoding is async. Preview does
   best-effort `prepare(t)` then `renderSync(t)` immediately (may drop frames).
   Export does `await prepare(t)` then renders (never drops a frame).
2. **`render(t)` is a pure function of (object graph, t).** No hidden
   dependence on the previous frame or wall-clock time. This is what makes
   export reproducible and golden-frame tests possible.
3. **Preview and export share one render core.** Same resolution, color
   pipeline (sRGB↔linear, premultiplied alpha) and filter params.
4. **Explicit resource ownership.** `VideoFrame`, `Texture`, `RenderTexture`
   and decoders are disposed explicitly; each of the three resource classes has
   a budget + LRU eviction. Every SDK object implements `dispose()`.
5. **Invalidate / dirty-flag.** The SDK never repaints on its own. Mutations
   mark dirty; the upper layer schedules `renderPreview` to repaint on demand.

## Layout

```
src/
  core/        Disposable / Subscription primitives
  time/        Timebase, Clock (Realtime / FixedStep)        ✅ implemented
  animation/   Easing, AnimatableProperty, Transform2D       ✅ implemented
  media/       MediaSource + Video/Image/Audio, FrameCache   🚧 cache done, decode TODO
  texture/     TextureManager (GPU budget + LRU)             🚧 budget done, upload TODO
  compositor/  Compositor, Track, Clip(s), Reconciler        🚧 graph done, render core TODO
  effects/     Effect, EffectRegistry, Transition            🚧 abstractions only
  audio/       AudioEngine                                   🚧 interface only
  export/      Exporter                                      🚧 interface only
  index.ts     public barrel
tests/         vitest unit tests (pure-logic modules)
docs/          architecture & design
todo/          milestone task tracking (start here for "what's next")
```

Unimplemented methods `throw` with a pointer to the relevant `todo/*.md` file,
so callers fail loudly rather than rendering silent black frames.

## Conventions

- **TypeScript, strict.** `noUnusedLocals/Parameters` are temporarily relaxed
  while the SDK is a skeleton (many fields are stored for not-yet-built
  milestones); re-enable them as stubs get filled.
- **`pixi.js` is a peer dependency** and stays external in the build. Never
  bundle it.
- **Public surface** is whatever `src/index.ts` exports. Internal helpers
  (`Reconciler`, `FrameCache`, `TextureManager`, demuxers, muxers) are exported
  for advanced extension but are not stable API — see the table in
  `docs/architecture.md`.
- **Times are seconds at the API boundary**, quantized to frames internally via
  `Timebase`. Never thread raw float seconds through without quantizing.
- Pure-logic modules (time, animation, caches) must have unit tests.

## Commands

```bash
pnpm install        # install deps
pnpm test           # run vitest once
pnpm test:watch     # watch mode
pnpm typecheck      # tsc --noEmit
pnpm build          # typecheck + vite library build (ESM + CJS + d.ts)
pnpm dev            # vite dev server (for example/playground)
```

## Working agreement

- Pick the next milestone from [`todo/`](todo/); milestones are ordered and the
  ordering matters (e.g. texture/frame budget must land before multi-track or
  it will OOM).
- When you implement a stub, remove its `throw … not implemented` and add a
  test where the logic is deterministic.
- Keep `index.ts` the single source of truth for the public API.
- Don't add persistence / undo / UI to the SDK — that's the consumer's job.
