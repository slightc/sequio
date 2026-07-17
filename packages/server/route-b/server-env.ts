/**
 * `nodeServerEnv()` — the **server environment** for Route B (pure Node, PixiJS
 * WebGPU), packaged as one injectable {@link RuntimeEnv}.
 *
 * This is "the server providing a server env": instead of every render entry
 * repeating `setupNodeEnvironment()` + `bridgeFontManagerToNode()` + an inline
 * `compositorOptions: { createRenderer, resolution }`, they install one env and
 * let the {@link Composer} run its `setup()` once and fold its compositor
 * overrides into the user's `new Compositor(...)`. The created renderer is
 * captured and exposed as {@link NodeServerEnv.renderer} for GPU frame readback.
 *
 * Requires a WebGPU-capable host (a real GPU or Mesa lavapipe); `setup()` throws
 * a clear message if none is found. See `docs/environments-and-rpc.md`.
 */
import type { Renderer } from '@sequio/engine';
import type { AssetLoader, Externals, RuntimeEnv } from '@sequio/runtime';
import { createNodeWebGPURenderer, setupNodeEnvironment } from './env';
import { bridgeFontManagerToNode } from './fonts-node';

export interface NodeServerEnvOptions {
  /** Output resolution multiplier (N× the composition size). @default 1 */
  scale?: number;
  /** Extra bare modules the composition may `import` (e.g. `gsap`). */
  externals?: Externals;
  /** Resolver for a composition's local media (`loadAsset('./clip.mp4')`). */
  loadAsset?: AssetLoader;
}

export interface NodeServerEnv extends RuntimeEnv {
  /**
   * The PixiJS WebGPU renderer created during the build (`null` before the first
   * `Composer.build`). Route B reads frames back off this renderer, so callers
   * pass it to `renderTimelineToFile` / `renderFrameRGBA`.
   */
  readonly renderer: Renderer | null;
}

/**
 * Build a Node WebGPU {@link RuntimeEnv}. Install it with
 * `new Runtime({ ...bundle, env: nodeServerEnv({ scale }) })`; after
 * `composer.build()` the created renderer is available as `env.renderer`.
 */
export function nodeServerEnv(opts: NodeServerEnvOptions = {}): NodeServerEnv {
  let renderer: Renderer | null = null;
  const scale = Math.max(1, opts.scale ?? 1);
  return {
    name: 'node-webgpu',
    target: 'server',
    externals: opts.externals,
    loadAsset: opts.loadAsset,
    async setup() {
      // Install browser globals + WebGPU (throws without a GPU/lavapipe), then
      // route the composition's own `fonts.load*` through @napi-rs/canvas so text
      // renders with the same web font the browser preview uses (contract #3).
      await setupNodeEnvironment();
      bridgeFontManagerToNode();
    },
    resolveCompositorOptions: () => ({
      resolution: scale,
      createRenderer: async (o) => (renderer = await createNodeWebGPURenderer(o)),
    }),
    get renderer() {
      return renderer;
    },
  };
}
