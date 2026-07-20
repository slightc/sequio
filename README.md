# Sequio

**Programmable timelines for web video and AI.**

A **pnpm monorepo** for a PixiJS-based video-editor runtime, split into five
core packages in a clean dependency DAG — `engine ← runtime ← server ← studio`
and `engine ← {server, studio, cli}` — plus the project website:

| Package | Name | What it is |
|---|---|---|
| [`packages/engine`](packages/engine) | `@sequio/engine` | The SDK: a command-style object-graph runtime — **decode, composite, audio, export**. The published library. |
| [`packages/runtime`](packages/runtime) | `@sequio/runtime` | Compile + run multi-file TS/JS (virtual or real filesystem) → a `Composer` that previews, exports, or feeds server rendering. Depends on engine. |
| [`packages/server`](packages/server) | `@sequio/server` | **The server-side render environment** — `serverEnv`, a pure-Node (PixiJS WebGPU / Dawn) bootstrap that runs the engine's render core outside a browser. Depends on engine + runtime. |
| [`packages/studio`](packages/studio) | `@sequio/studio` | A reference **multi-track editor** app (timeline, canvas manipulation, forked export, Code Mode, Server Render). Depends on engine + runtime + headless (for the `TimelineSpec` types). |
| [`packages/cli`](packages/cli) | `@sequio/cli` | The `sequio` command line: `check` / `render` / `frame` / `audio` a composition (pure-Node WebGPU, Route B) and `preview` it live in-browser. Owns the code-bundle render helpers. Depends on engine + runtime + server. |
| [`packages/website`](packages/website) | `@sequio/website` | The project **website**: home, a demo gallery whose covers are live sequio renders, an in-browser Code Mode, the engine API reference, and the studio showcase. Depends on engine + runtime. |
| [`packages/skill`](packages/skill) | `@sequio/skill` | An installable **AI Agent Skill** (`SKILL.md`) + **`llms.txt`** that teach an AI assistant how to use sequio. Docs only — no runtime code, no engine dependency. |

The **engine** is a command-style object-graph engine on top of
[PixiJS v8](https://pixijs.com/): you build a tree of `Track / Clip / Effect`
objects and drive a clock; it owns the low-level runtime. Persistence, schema,
undo, collaboration and UI are left to the layer above — the `studio` package is
a reference consumer, not part of the SDK surface.

> **Invariant**: `render(t)` is a pure function of the object graph + `t` — the
> same tree and the same `t` always produce the same frame. That is what makes
> export reproducible and golden-frame testing possible.

## Status

The engine is functional end-to-end: real WebCodecs/Mediabunny decode, the
PixiJS render core, multi-track compositing, audio, effects and MP4/WebM export
all work, and the runtime + server + CLI are wired on top. A few pieces remain
in progress (some transitions/effects, golden-frame full-file diffing); they're
tracked in [`todo/`](todo/). Unimplemented paths `throw` with a pointer to the
milestone that fills them.

| Module | Status |
|---|---|
| `time/` — Timebase, Clock (Realtime / FixedStep) | ✅ implemented |
| `animation/` — AnimatableProperty, Transform2D, Easing, Clip/Text animators + GSAP binding | ✅ implemented |
| `media/` — VideoSource (Mediabunny), ImageSource, FrameCache | ✅ · audio decode ✅ |
| `texture/` — GPU byte budget + LRU | ✅ implemented |
| `text/` — FontManager (web fonts) + text layout (line/word/char) | ✅ implemented |
| `compositor/` — graph + Reconciler + multi-track + clips + transitions | ✅ · some transitions 🚧 |
| `effects/` — Effect registry, color/blur/warp, crossfade | 🚧 chroma/LUT/wipe TODO |
| `audio/` — AudioEngine (Web Audio + OfflineAudioContext) | ✅ implemented |
| `export/` — Exporter (FixedStep loop + Mediabunny mux) | ✅ · golden-frame diff follow-up |

See the milestone-by-milestone progress table in [`todo/README.md`](todo/README.md).

## Install

The engine is published to npm as [`@sequio/engine`](https://www.npmjs.com/package/@sequio/engine):

```bash
npm install @sequio/engine
```

`pixi.js` ships as a direct dependency, so it is installed automatically — no
separate install needed.

The rest of the stack is published alongside it (each ships built ESM + `.d.ts`):

| Package | Install | What it adds |
| --- | --- | --- |
| [`@sequio/runtime`](https://www.npmjs.com/package/@sequio/runtime) | `npm i @sequio/runtime` | Compile + run multi-file TS/JS into a `Composer`. Also exposes a Node filesystem adapter at `@sequio/runtime/node-fs`. |
| [`@sequio/server`](https://www.npmjs.com/package/@sequio/server) | `npm i @sequio/server` | `serverEnv` — the pure-Node (PixiJS WebGPU) render environment that runs the engine outside a browser (its native bindings are `optionalDependencies`). |
| [`@sequio/cli`](https://www.npmjs.com/package/@sequio/cli) | `npm i -g @sequio/cli` | The `sequio` command: `check` / `render` / `frame` / `audio` / `preview`, plus the Route B code-bundle render helpers. |
| [`@sequio/skill`](https://www.npmjs.com/package/@sequio/skill) | `npm i @sequio/skill` | An installable AI Agent Skill + `llms.txt` (docs only). |

Server-side rendering has two routes. **Route B** (pure-Node WebGPU) runs the
composition's code on the server via the CLI (`sequio render`), under
`@sequio/server`'s `serverEnv`. **Route A** (headless Chrome) plus the
serializable `TimelineSpec` protocol + RPC live in the repo-internal
`@sequio/headless` harness — **not** published.

## Quick start

Commands run from the workspace root and fan out to the packages:

```bash
pnpm install     # install + link the workspace
pnpm test        # vitest across every package (pnpm -r test)
pnpm typecheck   # tsc --noEmit across every package
pnpm build       # build the engine library (ESM + CJS + d.ts)
pnpm dev         # run the studio editor (dev:engine / dev:server / dev:runtime for the others)
pnpm dev:website # run the project website (home · demos + Code Mode · API · studio showcase)
```

Build a timeline imperatively with the engine's own classes and drive it with a clock:

```ts
import { Timebase, RealtimeClock, Compositor, VisualTrack } from '@sequio/engine';

const timebase = new Timebase(30);
const compositor = new Compositor({ width: 1920, height: 1080, timebase });
compositor.addTrack(new VisualTrack());

const clock = new RealtimeClock();
clock.onTick((t) => compositor.renderPreview(t)); // wire clock → preview
clock.start();
```

Or author a composition as a file and render / preview it with the CLI:

```bash
pnpm sequio render composition.ts --out out.mp4      # encode to video (pure-Node WebGPU; needs a GPU or Mesa lavapipe)
pnpm sequio frame composition.ts --time 2 --out shot.png  # export one frame as a PNG for a quick visual check
pnpm sequio preview composition.ts --watch           # live in-browser preview, reloads on change
```

## Docs

- [Architecture & design](docs/architecture.md) — the five contracts, modules, public surface
- [Runtime](docs/runtime.md) — compile + run TS/JS into a `Composer`
- [Server-side rendering](docs/server-side-rendering.md) — the `TimelineSpec` protocol and both render routes
- [CLI](docs/cli.md) — `sequio render` / `sequio preview`
- [Text animation](docs/text-animation.md) — clip/text animators, split motion, GSAP binding
- [AI Agent Skill + llms.txt](packages/skill) — an installable skill teaching an assistant how to use sequio
- [Contributor / agent guide](AGENT.md) (`CLAUDE.md` symlinks to it)
- [Roadmap & tasks](todo/)

## Releasing

`@sequio/engine` is published by the [`Release`](.github/workflows/release.yml)
GitHub Actions workflow. Bump `packages/engine/package.json`, then either push a
matching `engine-v<version>` tag or run the workflow manually
(`workflow_dispatch`). The workflow builds, packs, and runs `pnpm publish`; it
needs a repository secret `NPM_TOKEN` (an npm automation token with publish
rights to the `@sequio` scope). Trigger it with `dry_run: true` to build + pack
without publishing.

The other four packages — `@sequio/runtime`, `@sequio/server`, `@sequio/cli`
and `@sequio/skill` — are published by the
[`Release packages`](.github/workflows/release-packages.yml) workflow
(`workflow_dispatch`, same `NPM_TOKEN`). Bump the versions you want to release,
then run it: `dry_run: true` builds + packs everything; `dry_run: false`
publishes in dependency order (`runtime → server → cli`), skipping any package
whose version is already on npm. Their cross-package deps use the
`workspace:^` protocol, which `pnpm publish` rewrites to the concrete published
version range.

## License

MIT
