/**
 * The **engine-level environment** — a single object describing how the engine
 * runs *outside a browser*, installed once as a process-wide default.
 *
 * The engine needs a handful of host capabilities that a browser supplies for
 * free but Node does not: a GPU renderer, the `mediabunny` codec instance, and a
 * way to turn a decoded frame into a texture source. Historically each was its
 * own global seam (`setMediabunnyModule`, `setFrameImageExtractor`) plus a
 * per-`Compositor` `createRenderer` option. {@link EngineEnv} bundles them into
 * one **engine-layer** default so a host (a server) sets the environment in a
 * single call:
 *
 * ```ts
 * import { setDefaultEngineEnv } from '@sequio/engine';
 * setDefaultEngineEnv(nodeServerEnv());   // from @sequio/server/route-b
 * const c = new Compositor({ width, height });
 * await c.init();                         // uses the env's renderer + setup
 * ```
 *
 * Resolution rule: an **explicit `CompositorOptions` value always wins**; the
 * engine env is only the *default* fallback. So concurrent renders that each
 * need a different renderer still pass `createRenderer` per `Compositor` and are
 * unaffected by the global (contract-friendly isolation). Setting the default is
 * process-wide mutable state, best for single-tenant / sequential rendering.
 */
import type { AutoDetectOptions, Renderer } from 'pixi.js';
import { setFrameImageExtractor, type FrameImageExtractor } from './media/mediabunny-decoder';
import { setMediabunnyModule, type MediabunnyModule } from './media/mediabunny-loader';

export interface EngineEnv {
  /**
   * One-time host bootstrap, run once by {@link Compositor.init} before the
   * renderer is created (install browser globals, WebGPU, etc.). Idempotent.
   */
  setup?(): Promise<void> | void;
  /**
   * Default GPU renderer factory, used by {@link Compositor.init} when no
   * per-compositor `createRenderer` is given. Receives the same options
   * `autoDetectRenderer` would; must return an initialized `Renderer`.
   */
  createRenderer?: (options: Partial<AutoDetectOptions>) => Promise<Renderer>;
  /** Default backing-store scale, used when `CompositorOptions.resolution` is unset. */
  resolution?: number;
  /** The `mediabunny` instance the SDK's decode/encode should use (dual-package pin). */
  mediabunny?: MediabunnyModule;
  /** How a decoded video frame becomes a texture source (Node has no `VideoFrame`). */
  frameImageExtractor?: FrameImageExtractor;
}

/** The process-wide default engine environment. */
let current: EngineEnv = {};
/** Cached `current.setup()` — reset whenever the env is replaced. */
let setupPromise: Promise<void> | null = null;

/**
 * Install (or clear, with `null`) the process-wide default {@link EngineEnv}.
 * The `mediabunny` / `frameImageExtractor` seams are applied immediately (they're
 * read outside `init` too); `createRenderer` / `resolution` / `setup` are consumed
 * by {@link Compositor}. An explicit `CompositorOptions` value always wins over
 * the default.
 */
export function setDefaultEngineEnv(env: EngineEnv | null): void {
  current = env ?? {};
  setupPromise = null;
  if (current.mediabunny) setMediabunnyModule(current.mediabunny);
  if (current.frameImageExtractor) setFrameImageExtractor(current.frameImageExtractor);
  if (env === null) {
    setMediabunnyModule(undefined);
    setFrameImageExtractor(null);
  }
}

/** The current default {@link EngineEnv} (empty `{}` if none installed). */
export function getDefaultEngineEnv(): EngineEnv {
  return current;
}

/**
 * Run the default env's `setup()` at most once (until the env is replaced).
 * Called by {@link Compositor.init} before the renderer is created.
 */
export function ensureEngineEnvSetup(): Promise<void> {
  if (!current.setup) return Promise.resolve();
  return (setupPromise ??= Promise.resolve(current.setup()));
}
