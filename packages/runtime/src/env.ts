/**
 * A {@link RuntimeEnv} is the single object that captures **everything that
 * differs about the host a composition runs in** — a one-time `setup()`, the
 * extra bare modules user code may import, the local-media resolver, and the
 * `compositorOptions` folded into every `new Compositor(...)` (an injected
 * renderer, an output scale).
 *
 * The runtime owns only this **interface** (browser-safe); concrete envs are
 * supplied by hosts:
 *  - `browserEnv` (below) — the default: no bootstrap, no overrides, so preview
 *    and export behave exactly as they always have.
 *  - a future sandbox env (VM / iframe) — see `docs/environments-and-rpc.md`.
 *
 * Server-side rendering does **not** go through a `RuntimeEnv`: `@sequio/server`'s
 * `serverEnv()` bootstraps the Node host and registers the WebGPU renderer at the
 * *engine* layer (`setDefaultEngineEnv`), so the host does `serverEnv().setup()`,
 * then runs the runtime (passing `externals` / `loadAsset` directly), then builds.
 *
 * Install one via `new Runtime({ env })` or `runtime.setEnv(env)`; the
 * {@link Composer} runs `setup()` once, then folds `resolveCompositorOptions()`
 * into each build's {@link CompositionEnv} — so the three destinations (client
 * preview / client export / server render) share one environment model.
 */
import type { CompositorOptions } from '@sequio/engine';
import type { AssetLoader } from './assets';
import type { CompositionEnv } from './composition';
import type { Externals } from './module-runtime';

export interface RuntimeEnv {
  /** Human-readable name, for diagnostics. */
  readonly name?: string;
  /**
   * Where builds run — folded into {@link CompositionEnv.target} so user code can
   * branch (e.g. output scale). Defaults to `'export'` when omitted.
   */
  readonly target?: CompositionEnv['target'];
  /**
   * One-time host bootstrap run **before the first build** (install browser
   * globals, pin codecs, bridge fonts). The {@link Composer} caches it, so it
   * runs once per Composer regardless of how many graphs are built; implementers
   * should still make it idempotent (multiple envs may share a host).
   */
  setup?(): Promise<void> | void;
  /**
   * Extra bare modules user code may `import`, merged under the built-in
   * `@sequio/engine` / `@sequio/runtime` (an explicit `RuntimeOptions.externals`
   * wins over these). This is how an env makes e.g. `gsap` resolvable.
   */
  readonly externals?: Externals;
  /**
   * Resolver for a composition's local media (`loadAsset('./clip.mp4')`). An
   * explicit `RuntimeOptions.loadAsset` takes precedence.
   */
  readonly loadAsset?: AssetLoader;
  /**
   * Per-build `Compositor` option overrides — the injected renderer and output
   * scale. Called on every {@link Composer.build}; the returned options are
   * folded implicitly into the user's `new Compositor(...)` (via `engineForEnv`),
   * so portable code needs no `env` plumbing.
   */
  resolveCompositorOptions?(): Promise<Partial<CompositorOptions>> | Partial<CompositorOptions>;
  /** Optional teardown for host resources the env owns. */
  dispose?(): Promise<void> | void;
}

/**
 * The default environment: a plain browser with no bootstrap and no compositor
 * overrides. Installing it is equivalent to installing nothing — preview and
 * export run exactly as before.
 */
export const browserEnv: RuntimeEnv = { name: 'browser', target: 'preview' };
