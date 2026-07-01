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
  media/       MediaSource + Video/Image/Audio, FrameCache   🚧 video (Mediabunny) + image decode done, audio TODO
  texture/     TextureManager (GPU budget + LRU)             ✅ implemented
  text/        FontManager (web-font loading)                ✅ implemented
  compositor/  Compositor, Track, Clip(s), GroupClip, Reconciler  🚧 graph + render core + grouping + multitrack + clips + overlap-driven transitions done
  effects/     Effect, EffectRegistry, Transition            🚧 color/blur + warp (bulge/perspective/displacement) + crossfade done, chroma/LUT/wipe TODO
  audio/       AudioEngine + scheduling                      ✅ implemented (Web Audio + OfflineAudioContext)
  export/      Exporter (FixedStep loop + Mediabunny mux)     ✅ implemented (MP4/WebM, video + audio; golden-frame diff is a follow-up)
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
pnpm verify:decode  # Puppeteer e2e: real WebCodecs decode via VideoSource
pnpm verify:render  # Puppeteer e2e: multi-track stacking / opacity / blendMode
pnpm verify:clips   # Puppeteer e2e: Image / Text / Shape clips on screen
pnpm verify:font    # Puppeteer e2e: custom/Google web-font renders in a TextClip
pnpm verify:audio   # Puppeteer e2e: AudioEngine offline mix + AudioSource decode
pnpm verify:effects # Puppeteer e2e: color/blur effect on a clip + crossfade blend
pnpm verify:export  # Puppeteer e2e: Exporter → MP4/WebM, decoded back and checked
```

Browser e2e (`verify:*`) needs a WebCodecs-capable browser. Playwright's
bundled Chromium lacks WebCodecs, so we use Puppeteer's Chrome-for-Testing —
fetch it once with `pnpm exec puppeteer browsers install chrome`. Both scripts
share `scripts/verify-page.cjs` (spawns Vite, asserts a page's `window.*` result).

## Working agreement

- Pick the next milestone from [`todo/`](todo/); milestones are ordered and the
  ordering matters (e.g. texture/frame budget must land before multi-track or
  it will OOM).
- When you implement a stub, remove its `throw … not implemented` and add a
  test where the logic is deterministic.
- Keep `index.ts` the single source of truth for the public API.
- Don't add persistence / undo / UI to the SDK — that's the consumer's job.

## Tests & docs are part of "done" (not optional)

Every milestone and every functional change must land with tests and docs in
the same change. A stub is not "implemented" until both exist.

- **Tests per milestone.** Each milestone in [`todo/`](todo/) ships with tests
  that cover its acceptance criteria (验收标准). Add/extend tests under
  `tests/` (vitest) before marking the milestone done; a milestone with no
  passing tests for its new behavior is not complete. For GPU/render paths that
  can't run in a headless unit test, cover the deterministic logic (reconcile,
  timing, budgets, idempotence of `render(t)`) and note what is verified
  manually in the `example/`.
- **Docs update with the code.** Any implementation, signature, or behavior
  change must update the relevant docs **in the same commit**: at minimum
  [`docs/architecture.md`](docs/architecture.md) when structure/contracts/public
  surface change, the milestone file's status line + the progress table in
  [`todo/README.md`](todo/README.md), and the module-status markers in the
  [Layout](#layout) section above (e.g. `🚧 → ✅`). Don't leave docs describing
  the old skeleton after the behavior has changed.
- **Definition of done for a change:** code + tests + docs all updated, and
  `pnpm typecheck` and `pnpm test` pass.
