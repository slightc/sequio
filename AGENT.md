# AGENT.md

Guidance for AI coding agents (and humans) working in this repository.
`CLAUDE.md` is a symlink to this file.

## What this project is

`sequio` is a **command-style object-graph engine** for building
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

This is a **pnpm workspace** (`pnpm-workspace.yaml`) split into five core
packages, in a clean dependency DAG — `engine ← runtime ← server ← studio`, and
`engine ← {server, studio, cli}` — plus the project website, and two non-published
harness/docs packages (`headless`, `skill`):

```
packages/
  engine/   @sequio/engine    the SDK runtime (the published library)
  runtime/  @sequio/runtime   compile+run TS/JS → a Composer (depends on engine)
  server/   @sequio/server    server-side rendering: TimelineSpec protocol + Route B pure-Node WebGPU (depends on engine + runtime)
  headless/ @sequio/headless  Route A server-side rendering: headless-Chrome (Puppeteer) worker → video (depends on engine + runtime + server; repo-internal harness, NOT published)
  studio/   @sequio/studio    reference multi-track editor (depends on engine + server + runtime)
  cli/      @sequio/cli       the `sequio` command line: check + render + frame + preview (depends on engine + runtime + server)
  website/  @sequio/website   the project website: home · demo gallery (sequio-rendered covers) + Code Mode · engine API reference · studio showcase (depends on engine + runtime)
  skill/    @sequio/skill     an installable AI Agent Skill (SKILL.md) + llms.txt teaching how to use sequio (docs only; no runtime code, no deps)
docs/       architecture & design (workspace-level)
todo/       milestone task tracking (start here for "what's next")
```

Tooling (TypeScript, Vite, Vitest, Puppeteer, tsx) lives in the **root**
`devDependencies`; each package declares only its own runtime deps. Consumer
packages import the engine as `@sequio/engine` and resolve it
**straight from source** (tsconfig `paths` + a Vite/Vitest alias), so
`pnpm typecheck` / `pnpm test` never need a prior `pnpm build`.

### `packages/engine` — the SDK

```
src/
  core/        Disposable / Subscription primitives
  time/        Timebase, Clock (Realtime / FixedStep)        ✅ implemented
  animation/   Easing, AnimatableProperty, Transform2D + ClipAnimator/TextAnimator seam  ✅ implemented (keyframes + Stagger/Tween animators + GSAP binding, engine has no gsap dep)
  media/       MediaSource + Video/Image/Audio, FrameCache   ✅ video (Mediabunny) + image + audio decode done
  texture/     TextureManager (GPU budget + LRU)             ✅ implemented
  text/        FontManager (web-font loading) + text-layout (split into line/word/char parts)  ✅ implemented
  compositor/  Compositor, Track, Clip(s), GroupClip, Reconciler  🚧 graph + render core + grouping + multitrack + clips + overlap-driven transitions + clip animators + TextClip.split motion done
  effects/     Effect, EffectRegistry, Transition            🚧 color/blur + warp (bulge/perspective/displacement) + crossfade done, chroma/LUT/wipe TODO
  audio/       AudioEngine + scheduling                      ✅ implemented (Web Audio + OfflineAudioContext)
  export/      Exporter (FixedStep loop + Mediabunny mux)     ✅ implemented (MP4/WebM video+audio, single-frame image, audio-only mux; golden-frame diff is a follow-up)
  env.ts       EngineEnv + setDefaultEngineEnv: process-wide out-of-browser defaults (renderer/resolution/mediabunny/frameImageExtractor/setup) — Compositor consumes them, explicit CompositorOptions win  ✅ implemented
  index.ts     public barrel
tests/         vitest unit tests (pure-logic modules)
example/       demos + browser e2e verify pages (verify:* harness)
```

### `packages/server` — server-side rendering

```
src/            TimelineSpec protocol + buildTimeline (the serializable JSON contract) + rpc.ts
                (transport-agnostic Endpoint/expose/wrap/windowEndpoint) + render-service.ts
                (RenderService/RenderResult contract); barrel = src/index.ts
route-b/        Route B: pure Node, PixiJS WebGPU (render.ts, env.ts, server-env.ts, export-node.ts,
                fonts-node.ts, render-bundle.ts, frame-node.ts, audio-node.ts + verify-*); index.ts =
                (server-env.ts: nodeServerEnv() packages the Node bootstrap into one injectable RuntimeEnv
                whose setup() registers the WebGPU renderer + scale at the engine layer via
                setDefaultEngineEnv — the render/frame/audio entries all inject it)
                @sequio/server/route-b node-only barrel (renderTimelineToFile / renderBundleToFile —
                the latter powers `sequio render`; renderBundleFrameToFile → `sequio frame`;
                exportBundleAudioToFile → `sequio audio`)
tests/          headless spec→graph unit tests
```

### `packages/headless` — Route A server-side rendering (repo-internal harness)

```
ssr-render.html/.ts   the SSR page: runs inside headless Chrome (WebGL + WebCodecs); `expose`s a typed
                      RenderService (render/renderBundle/sample) over the @sequio/server RPC — the old
                      window.__SSR__ global is gone. imports @sequio/server (protocol + RPC) + @sequio/runtime
ssr-worker.ts         the Node worker (tsx): spawns Vite + drives Puppeteer (Chrome-for-Testing), `wrap`s the
                      page's RenderService over a Puppeteer-bridged Endpoint, feeds --timeline / --bundle,
                      writes the bytes to --out (`pnpm ssr:render`); onProgress rides the RPC across CDP
scripts/              verify-page.cjs (the shared browser-e2e runner; `pnpm verify:ssr`)
```

**Not published** (`private: true`, no `vite build`): Route A is the productized form of the
`verify:*` harness — full-fidelity SSR that reuses the exact browser render core (contract #3), at the
cost of a Chrome process per task. It was split out of `packages/server/route-a/` so `server` owns only
the protocol + the pure-Node Route B. A transport-agnostic RPC layer (for both the Puppeteer bridge and
iframe) is the next milestone — see [`docs/environments-and-rpc.md`](docs/environments-and-rpc.md) §D.

### `packages/runtime` — code runtime

```
src/
  vfs.ts             FileSystem interface + InMemoryFileSystem (browser-safe)   ✅ implemented
  node-fs.ts         NodeFileSystem — inject a real filesystem (out of barrel)  ✅ implemented
  compile.ts         per-file TS/JS → CommonJS via `typescript` transpileModule ✅ implemented
  module-runtime.ts  tiny CJS linker: resolve relative imports + externals      ✅ implemented
  assets.ts          local-media contract: loadAsset hook + resolveAssetPath     ✅ implemented
  composition.ts     defineComposition(builder) authoring API (imperative)      ✅ implemented
  env.ts             RuntimeEnv: one injectable host env (setup/externals/loadAsset/compositorOptions) + setEnv  ✅ implemented
  composer.ts        Composer: preview / export (client) + toBundle (server)    ✅ implemented
  runtime.ts         Runtime.run() → compile+link+run the entry → Composer      ✅ implemented
  index.ts           public barrel (browser-safe; node-fs is a subpath export)
tests/               vitest unit tests (VFS, compile, linker, composition, run)
example/             runtime-test.html/.ts (verify:runtime e2e)
```

Takes a set of TS/JS source files (an in-memory {@link InMemoryFileSystem} or an
injected real one), transpiles + links them, and runs the entry. The program
builds its video **imperatively with the engine's own classes** (`new Compositor()`,
`new VisualTrack()`, `track.add(new TextClip(...))` — same style as `example/`, so
a user can bring their own `Clip`/`Effect` subclasses) inside
`defineComposition(builder)`; the runtime injects the real `@sequio/engine`
namespace as a sandbox module so the code can `new` it. Third-party libraries a
composition imports (e.g. `gsap`) are reachable the same way via
`RuntimeOptions.externals` (bare-specifier → module value); the `sequio` CLI ships
gsap and injects it in both `render` and `preview`. Environment options a host
needs (a Node renderer, an output scale) are folded into `new Compositor(...)`
**implicitly** (`engineForEnv` subclasses `Compositor` per build), so the code reads
exactly like a demo — no `env` plumbing. The result is a **`Composer`**
that (1) previews and (2) exports in the browser and whose (3) `toBundle()` returns
the **source files themselves** — the SSR routes re-run that code on the server
(no spec to serialize/keep in sync). One object, three destinations (client preview /
client export / server render). Browser-safe (only `typescript` + `engine` barrels);
the `node:fs` adapter is the `@sequio/runtime/node-fs` subpath, kept out
of the browser barrel. See [`docs/runtime.md`](docs/runtime.md).

### `packages/studio` — reference editor

```
index.html      the editor page
code.html       "Code Mode" — author a composition as multi-file TS/JS code
src/            main.ts (the editor app), editor-export.ts (forked offscreen export),
                code-mode.ts (the Code Mode page: Runtime → Composer → preview/export/spec)
example/        editor e2e verify pages + video-import test
tests/          editor-export unit tests
```

Unimplemented methods `throw` with a pointer to the relevant `todo/*.md` file,
so callers fail loudly rather than rendering silent black frames.

### `packages/cli` — the `sequio` command line

```
bin/sequio.js   the `sequio` binary — launches src/cli.ts through tsx (no build step)
src/
  args.ts       pure argv → CliCommand parser (unit-tested)              ✅ implemented
  bundle.ts     entry file on disk → RuntimeBundle (skips binary assets) ✅ implemented
  assets.ts     which files are binary assets + their MIME (bundle/serve) ✅ implemented
  assets-node.ts nodeAssetLoader: read local media off disk → Blob        ✅ implemented
  check.ts      `check <file> [--json]` → GPU-free static validation (null renderer; Diagnostic[]) ✅ implemented
  render.ts     `render <file>` → video, pure Node WebGPU (server Route B) ✅ implemented
  frame.ts      `frame <file> [--time t]` → single-frame PNG (Route B)     ✅ implemented
  audio.ts      `audio <file> [--format mp3]` → audio-only file (Route B)  ✅ implemented
  preview.ts    `preview <file> [--watch]` → Vite dev server             ✅ implemented
  cli.ts        dispatch + process lifecycle;  index.ts = programmatic barrel
preview/        the preview page (index.html + preview.ts: fetch /__bundle → Runtime → preview();
                assets.ts = browserAssetLoader fetching the dev server's /__asset/…)
scripts/        verify-cli.ts (e2e: check + render + frame + audio + preview against example/)
example/        a sample composition (index.ts + scene.ts + font.ts: embedded data: URL font);
                custom-fx/ (author your own effect · transition · animation — fx.ts: FocusPull/
                PopEffect (Effect), EasedCrossfade (Transition), OrbitAnimator (ClipAnimator),
                DropInTextAnimator (TextAnimator); index.ts shows each as a labelled chapter —
                effect on a shape, transition between two images, animation on a shape, per-char text);
                yc-spot/ (editorial 15s poster) + valentine/ (vertical 9:16 "Valentine's Day
                Sale" reel: echo-stack/arc/outline text + arch-masked network photos) +
                handbag-promo/ (vertical 9:16 15s retro fashion spot recreated from a real ad:
                four chapters — FASHIONABLE HANDBAG · MINIMALIST/RETRO-STYLE · LUXURIOUS ·
                GET IT NOW — pulsing solid↔hollow display type, punch-in/push-in camera moves,
                film/polaroid framing, torn-paper sunburst + whip-spin + light-leak cuts, over
                real studio photography referenced by URL + procedural textures) showcases;
                media-network/ (image+video from URLs) + media-local/ (loadAsset('./video.mp4'),
                git-ignored media) demos — neither commits any media asset
tests/          args + bundle + check + example-demos (link every demo) unit tests
```

Five commands, all thin front-ends over infrastructure the other packages own:
`check` compiles + links + runs the builder with a **null renderer** (no WebGPU,
no network) and statically walks the object graph — the first, cheapest ring of
the `check → frame → render` verify loop, catching illegal clip times, dead
keyframes, unregistered fonts, non-overlapping transitions, out-of-range anchors
and missing local assets before any render; `render` snapshots the composition
into a {@link RuntimeBundle} and hands it to
the server's **Route B** `renderBundleToFile` (`@sequio/server/route-b`) — pure
Node, PixiJS WebGPU, no browser (needs a GPU or Mesa lavapipe); `frame` runs the
same Route B path but seeks to one time and writes a single PNG
(`renderBundleFrameToFile`) — a fast visual check without a full render; `audio`
runs the same Route B path but exports only the `AudioEngine` offline mix to an
audio-only file (`exportBundleAudioToFile` → `Exporter.exportAudio`, m4a/mp3/wav/
ogg/webm); `preview` boots a Vite dev server (programmatic `createServer`) whose
page runs the same `Runtime` → `Composer` → `preview()` path in-browser, with
`--watch` reloading on any project-file change. See [`docs/cli.md`](docs/cli.md).

### `packages/skill` — the AI Agent Skill

```
skills/sequio/
  SKILL.md              the skill (YAML frontmatter: name + description) — how to use sequio
  references/api.md     the full public surface, grouped by module
  references/recipes.md copy-paste composition patterns
llms.txt                the llms.txt (llmstxt.org) index — links to the canonical docs
tests/                  validates the frontmatter + that every on-disk link resolves
```

**Docs only — no runtime code and no engine dependency.** An installable
[Agent Skill](https://docs.claude.com/en/docs/claude-code/skills) plus an
`llms.txt`: another project drops `skills/sequio/` into its `.claude/skills/` and
the AI working there knows the API and the five contracts. The skill's source of
truth is the engine barrel (`packages/engine/src/index.ts`) — keep
`references/api.md` in sync when the public surface changes; the package's vitest
tests assert the frontmatter is well-formed and no link dangles. See its
[`README.md`](packages/skill/README.md).

## Conventions

- **TypeScript, strict.** `noUnusedLocals/Parameters` are temporarily relaxed
  while the SDK is a skeleton (many fields are stored for not-yet-built
  milestones); re-enable them as stubs get filled.
- **`pixi.js` is a peer dependency** and stays external in the build. Never
  bundle it.
- **Only `engine` imports `pixi.js` / `mediabunny` directly.** Upper packages
  (`server`, `runtime`, `studio`) import from `@sequio/engine` only: Pixi types
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
- **Publishing.** `engine`, `runtime`, `server` and `cli` each build to `dist/`
  (Vite lib + `vite-plugin-dts`) and publish to npm; `skill` is docs-only (ships
  its markdown via `files`). Dev/test/typecheck still resolve `@sequio/*`
  **straight from source** via the tsconfig `paths` + Vite aliases, so the
  `dist`-pointing `exports` never affect in-repo work and no prior build is
  needed. Cross-package deps use the `workspace:^` protocol (rewritten to a
  concrete range by `pnpm publish`). Route B's Node-native bindings
  (`@napi-rs/canvas`, `webgpu`, `jsdom`, …) are `optionalDependencies` of
  `server` so `npm i @sequio/server` never fails on an unsupported platform.
  Route A (headless Chrome) is a repo-internal verify harness — not published.
  `engine` is released by `.github/workflows/release.yml`; the other four by
  `.github/workflows/release-packages.yml`.

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
pnpm build:packages # build every publishable package (engine + runtime + server + cli) → dist/
pnpm dev            # studio: vite dev server for the editor + Code Mode (dev:engine / dev:server / dev:runtime for the others)
pnpm sequio check <file> [--json]                                  # CLI: GPU-free static validation of a composition (offline lint; the pre-flight before frame/render)
pnpm sequio render <file> [--out out.mp4] [--scale 2] [--verify]   # CLI: encode a composition to video (pure Node WebGPU; needs a GPU or Mesa lavapipe)
pnpm sequio frame <file> [--time 2] [--out frame.png] [--scale 2]  # CLI: export a single frame at a time as a PNG (quick visual check; same Route B render core)
pnpm sequio audio <file> [--format mp3] [--out out.mp3] [--bitrate 192000]  # CLI: export just the audio mix to an audio-only file (mp3/m4a/wav/ogg/webm)
pnpm sequio preview <file> [--watch] [--port 6180]     # CLI: serve a live in-browser preview (re-runs on change)
pnpm verify:cli     # Puppeteer e2e: `sequio render` → valid MP4 + `sequio frame` → valid PNG + `sequio audio` → valid m4a + `sequio preview` runs in-browser
pnpm verify:runtime # Puppeteer e2e: compile+run multi-file TS → Composer → preview + export
pnpm verify:decode  # Puppeteer e2e: real WebCodecs decode via VideoSource
pnpm verify:render  # Puppeteer e2e: multi-track stacking / opacity / blendMode
pnpm verify:clips   # Puppeteer e2e: Image / Text / Shape clips on screen
pnpm verify:text-anim # Puppeteer e2e: per-character drop-in (TextClip.split + StaggerTextAnimator)
pnpm verify:gsap    # Puppeteer e2e: clips driven by a real (paused, seeked) GSAP timeline via the binding
pnpm verify:font    # Puppeteer e2e: custom/Google web-font renders in a TextClip
pnpm verify:audio   # Puppeteer e2e: AudioEngine offline mix + AudioSource decode
pnpm verify:reverse # Puppeteer e2e: 倒放 — reversed offline audio mix == forward flipped + reversed source-time map
pnpm verify:reverse-decode # Puppeteer e2e: 倒放解码 — backward playback serves a forward-decoded GOP batch (marker order mirrors forward, one prepare fills a window)
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
pnpm ssr:render-node -- --bundle <bundle.json> [--scale 2] --out out.mp4  # SSR worker B, code path: re-run a RuntimeBundle in pure Node (same renderBundleToFile `sequio render` uses)
```

Browser e2e (`verify:*`) needs a WebCodecs-capable browser. Playwright's
bundled Chromium lacks WebCodecs, so we use Puppeteer's Chrome-for-Testing —
fetch it once with `pnpm exec puppeteer browsers install chrome`. The engine,
studio and headless each carry a copy of `scripts/verify-page.cjs` (spawns Vite in
that package, asserts a page's `window.*` result).

**Server-side rendering** (render a timeline to a video file on a server) has two
routes: **A) headless Chrome** — the `@sequio/headless` package's `ssr-worker.ts`
`wrap`s the `RenderService` the `ssr-render.html` page `expose`s over the
`@sequio/server` RPC (full fidelity, reuses the verify path);
and **B) pure Node** — `packages/server/route-b/` renders via PixiJS WebGPU (Dawn)
with **filters** and **media sources** (video/image decode), no browser (needs a
GPU or Mesa lavapipe). Both share the `packages/server/src/` timeline protocol
(`@sequio/server`). The SDK
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
