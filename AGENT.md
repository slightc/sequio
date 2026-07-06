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

## Monorepo layout

This is a **pnpm workspace** (`pnpm-workspace.yaml`) split into three packages,
in a clean dependency DAG — `engine ← server ← studio`, `engine ← studio`:

```
packages/
  engine/   @video-editor-canvas/engine   the SDK runtime (the published library)
  server/   @video-editor-canvas/server   server-side rendering (depends on engine)
  studio/   @video-editor-canvas/studio   reference multi-track editor (depends on engine + server)
docs/       architecture & design (workspace-level)
todo/       milestone task tracking (start here for "what's next")
```

Tooling (TypeScript, Vite, Vitest, Puppeteer, tsx) lives in the **root**
`devDependencies`; each package declares only its own runtime deps. Consumer
packages import the engine as `@video-editor-canvas/engine` and resolve it
**straight from source** (tsconfig `paths` + a Vite/Vitest alias), so
`pnpm typecheck` / `pnpm test` never need a prior `pnpm build`.

### `packages/engine` — the SDK

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
example/       demos + browser e2e verify pages (verify:* harness)
```

### `packages/server` — server-side rendering

```
src/            TimelineSpec protocol + buildTimeline (the serializable JSON contract; barrel = src/index.ts)
route-a/        Route A: headless Chrome (ssr-render.html/.ts + ssr-render.cjs worker)
route-b/        Route B: pure Node, PixiJS WebGPU (render.ts, env.ts, export-node.ts, fonts-node.ts + verify-*)
tests/          headless spec→graph unit tests
```

### `packages/studio` — reference editor

```
index.html      the editor page
src/            main.ts (the editor app), editor-export.ts (forked offscreen export)
example/        editor e2e verify pages + video-import test
tests/          editor-export unit tests
```

Unimplemented methods `throw` with a pointer to the relevant `todo/*.md` file,
so callers fail loudly rather than rendering silent black frames.

## Conventions

- **TypeScript, strict.** `noUnusedLocals/Parameters` are temporarily relaxed
  while the SDK is a skeleton (many fields are stored for not-yet-built
  milestones); re-enable them as stubs get filled.
- **`pixi.js` is a peer dependency** and stays external in the build. Never
  bundle it.
- **Only `engine` imports `pixi.js` / `mediabunny` directly.** Upper packages
  (`server`, `studio`) import from `@video-editor-canvas/engine` only: Pixi types
  that leak into the public surface (`Renderer`, `AutoDetectOptions`,
  `BLEND_MODES`) are re-exported type-only from `index.ts`, and the mediabunny
  module is reached via `loadMediabunny()`. The sole exception is
  `packages/server/route-b/env.ts` — Route B's Node environment adapter, which
  must touch both libraries at runtime to bootstrap the environment (patch Pixi's
  `DOMAdapter`/`CanvasSource`, `require('mediabunny')` for the dual-package
  hazard).
- **Public surface** is whatever `packages/engine/src/index.ts` exports. Internal
  helpers (`Reconciler`, `FrameCache`, `TextureManager`, demuxers, muxers) are
  exported for advanced extension but are not stable API — see the table in
  `docs/architecture.md`.
- **Times are seconds at the API boundary**, quantized to frames internally via
  `Timebase`. Never thread raw float seconds through without quantizing.
- Pure-logic modules (time, animation, caches) must have unit tests.

## Commands

All commands run **from the workspace root** and delegate to the owning package
via `pnpm -F <pkg>` (or `pnpm -r` for all). You can also `cd packages/<pkg>` and
run the same script locally.

```bash
pnpm install        # install workspace deps + link packages
pnpm test           # run vitest once across every package (pnpm -r test)
pnpm test:watch     # engine watch mode
pnpm typecheck      # tsc --noEmit across every package (pnpm -r typecheck)
pnpm build          # build the engine library (ESM + CJS + d.ts)
pnpm dev            # studio: vite dev server for the editor (dev:engine / dev:server for the others)
pnpm verify:decode  # Puppeteer e2e: real WebCodecs decode via VideoSource
pnpm verify:render  # Puppeteer e2e: multi-track stacking / opacity / blendMode
pnpm verify:clips   # Puppeteer e2e: Image / Text / Shape clips on screen
pnpm verify:font    # Puppeteer e2e: custom/Google web-font renders in a TextClip
pnpm verify:audio   # Puppeteer e2e: AudioEngine offline mix + AudioSource decode
pnpm verify:effects # Puppeteer e2e: color/blur effect on a clip + crossfade blend
pnpm verify:export  # Puppeteer e2e: Exporter → MP4/WebM, decoded back and checked
pnpm verify:editor-export # Puppeteer e2e: editor's forked export (video+text+shape) → decoded back
pnpm verify:video-import  # Puppeteer e2e: import estimates fps from a packet prefix (no full-file scan)
pnpm verify:editor-audio  # Puppeteer e2e: video imports with sound; export muxes the audio track
pnpm verify:origin        # Puppeteer e2e: origin=[0.5,0.5] renders position [0,0] at the canvas centre
pnpm verify:ssr           # Puppeteer e2e: server-side render (Route A) — headless Chrome renders a timeline to video
pnpm ssr:render -- --timeline <spec.json> --out out.mp4       # SSR worker A (headless Chrome): timeline JSON → video file
pnpm verify:ssr-node      # Pure-Node SSR (Route B): PixiJS WebGPU (Dawn) renders a filtered timeline to MP4, no browser
pnpm verify:ssr-node-audio# Route B audio: synth tone + shape → MP4, decoded back asserts video+audio tracks
pnpm verify:ssr-node-font # Route B fonts: load a Google font (Roboto) in Node and assert glyphs rendered
pnpm verify:ssr-node-media# Route B media: decode a video + a data-URL image in pure Node and composite them
pnpm ssr:render-node -- --timeline <spec.json> [--scale 2] --out out.mp4  # SSR worker B (Node WebGPU): --scale N = N× resolution; needs a GPU or Mesa lavapipe
```

Browser e2e (`verify:*`) needs a WebCodecs-capable browser. Playwright's
bundled Chromium lacks WebCodecs, so we use Puppeteer's Chrome-for-Testing —
fetch it once with `pnpm exec puppeteer browsers install chrome`. The engine,
studio and server each carry a copy of `scripts/verify-page.cjs` (spawns Vite in
that package, asserts a page's `window.*` result).

**Server-side rendering** (render a timeline to a video file on a server) lives in
`packages/server` and has two routes: **A) headless Chrome** —
`packages/server/route-a/ssr-render.cjs` drives `route-a/ssr-render.html` (full
fidelity, reuses the verify path); and **B) pure Node** — `packages/server/route-b/`
renders via PixiJS WebGPU (Dawn) with **filters** and **media sources**
(video/image decode), no browser (needs a GPU or Mesa lavapipe). Both share the
`packages/server/src/` timeline protocol (`@video-editor-canvas/server`). The SDK
hooks that enable Route B
(all no-ops in the browser): `CompositorOptions.createRenderer` (inject a renderer),
`loadMediabunny()`/`setMediabunnyModule()` (pin one mediabunny instance — dual-package
hazard), `setFrameImageExtractor()` (how a decoded frame becomes a texture). Design,
protocol, the Route B shims and usage are in
[`docs/server-side-rendering.md`](docs/server-side-rendering.md).

## Working agreement

- Pick the next milestone from [`todo/`](todo/); milestones are ordered and the
  ordering matters (e.g. texture/frame budget must land before multi-track or
  it will OOM).
- When you implement a stub, remove its `throw … not implemented` and add a
  test where the logic is deterministic.
- Keep `packages/engine/src/index.ts` the single source of truth for the engine's
  public API.
- Don't add persistence / undo / UI to the engine — that's the consumer's job
  (the `studio` package is a reference consumer, not part of the SDK surface).

## Tests & docs are part of "done" (not optional)

Every milestone and every functional change must land with tests and docs in
the same change. A stub is not "implemented" until both exist.

- **Tests per milestone.** Each milestone in [`todo/`](todo/) ships with tests
  that cover its acceptance criteria (验收标准). Add/extend tests under the owning
  package's `tests/` (vitest) before marking the milestone done; a milestone with
  no passing tests for its new behavior is not complete. For GPU/render paths that
  can't run in a headless unit test, cover the deterministic logic (reconcile,
  timing, budgets, idempotence of `render(t)`) and note what is verified
  manually in that package's `example/`.
- **Docs update with the code.** Any implementation, signature, or behavior
  change must update the relevant docs **in the same commit**: at minimum
  [`docs/architecture.md`](docs/architecture.md) when structure/contracts/public
  surface change, the milestone file's status line + the progress table in
  [`todo/README.md`](todo/README.md), and the module-status markers in the
  [Monorepo layout](#monorepo-layout) section above (e.g. `🚧 → ✅`). Don't leave
  docs describing the old skeleton after the behavior has changed.
- **Definition of done for a change:** code + tests + docs all updated, and
  `pnpm typecheck` and `pnpm test` pass.
