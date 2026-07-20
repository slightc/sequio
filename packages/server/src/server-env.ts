/**
 * `serverEnv()` — the **server-side render environment** for pure-Node rendering
 * (PixiJS WebGPU / Dawn), plus a convenient `setup()`.
 *
 * This is the single thing `@sequio/server` provides. It does **not** know about
 * `@sequio/runtime`: its whole job is to bootstrap the Node host and register the
 * WebGPU renderer + output scale as the **engine-layer default**
 * ({@link setDefaultEngineEnv}), so that whatever produces a `Compositor` — the
 * runtime running a code bundle, or hand-written engine code — renders in Node
 * with full filter/effect support (contract #3, same core as the browser preview).
 *
 * The intended flow keeps the layers separate:
 *
 * ```ts
 * const env = serverEnv({ scale });      // setup the server render env (engine bootstrap folded in)
 * await env.setup();
 * const composer = await new Runtime({ ...bundle, externals, loadAsset }).run();  // run the runtime
 * const built = await composer.build();  // get the Compositor
 * // read frames off env.renderer …
 * ```
 *
 * Requires a WebGPU-capable host (a real GPU or Mesa lavapipe); `setup()` throws
 * a clear message if none is found. See `docs/environments-and-rpc.md`.
 */
import { type Renderer, setDefaultEngineEnv } from '@sequio/engine';
import { createNodeWebGPURenderer, setupNodeEnvironment } from './env';
import { bridgeFontManagerToNode } from './fonts-node';

export interface ServerEnvOptions {
  /** Output resolution multiplier (N× the composition size). @default 1 */
  scale?: number;
}

export interface ServerEnv {
  /**
   * Bootstrap the Node host and register the WebGPU renderer + scale at the engine
   * layer. Install browser globals + WebGPU (throws without a GPU/lavapipe), route
   * the composition's own `fonts.load*` through `@napi-rs/canvas` so text renders
   * with the same web font the browser preview uses (contract #3), and set the
   * process-wide engine default so a plain `new Compositor(...)` picks up the
   * renderer + output scale with no per-build option plumbing (an explicit
   * `CompositorOptions` value still wins). Idempotent.
   */
  setup(): Promise<void>;
  /**
   * The PixiJS WebGPU renderer created during the build (`null` before the first
   * `Compositor` is initialized). Route B reads frames back off this renderer.
   */
  readonly renderer: Renderer | null;
}

/**
 * Build a Node WebGPU {@link ServerEnv}. Call `setup()` once before running the
 * runtime; after the composition is built the created renderer is available as
 * `env.renderer`.
 */
export function serverEnv(opts: ServerEnvOptions = {}): ServerEnv {
  let renderer: Renderer | null = null;
  const scale = Math.max(1, opts.scale ?? 1);
  return {
    async setup() {
      await setupNodeEnvironment();
      bridgeFontManagerToNode();
      setDefaultEngineEnv({
        resolution: scale,
        createRenderer: async (o) => (renderer = await createNodeWebGPURenderer(o)),
      });
    },
    get renderer() {
      return renderer;
    },
  };
}
