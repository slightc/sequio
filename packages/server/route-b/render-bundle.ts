/**
 * Route B (pure Node, PixiJS WebGPU) — render a **code** {@link RuntimeBundle} to
 * a video file, no browser.
 *
 * This is the imperative-code sibling of {@link renderTimelineToFile}: instead of
 * a serializable `TimelineSpec`, it takes the composition's own source files, runs
 * them through the {@link Runtime} to a {@link Composer}, and builds the live graph
 * **in Node** — the environment's WebGPU renderer and output scale are folded into
 * the user's `new Compositor(...)` implicitly (runtime `engineForEnv`), so the code
 * reads exactly like a browser demo (contract #3). It's what `sequio render` calls.
 *
 * Requires a WebGPU-capable host: a real GPU, or a software Vulkan driver (Mesa
 * lavapipe). {@link setupNodeEnvironment} throws a clear message if none is found.
 */
import type { Renderer } from '@sequio/engine';
import { type AssetLoader, Runtime, type Externals, type RuntimeBundle } from '@sequio/runtime';
import { createNodeWebGPURenderer, setupNodeEnvironment } from './env';
import { renderTimelineToFile } from './export-node';
import { bridgeFontManagerToNode } from './fonts-node';

export interface RenderBundleNodeOptions {
  /** Output file path. The extension is corrected to match the encoded container. */
  out: string;
  /** Output resolution multiplier (N× the composition size). @default 1 */
  scale?: number;
  /** Preferred container; falls back to what node-av can encode. */
  container?: 'mp4' | 'webm';
  videoCodec?: string;
  bitrate?: number;
  onProgress?: (p: number) => void;
  /**
   * Extra bare modules the composition may `import` (merged over the built-in
   * `@sequio/engine` / `@sequio/runtime`). This is the seam a host uses to make a
   * third-party library — e.g. `gsap` — resolvable to user code in the Node
   * render, exactly as it is in the browser preview. The server itself pulls in
   * nothing: the caller (`sequio render`) owns the library and passes it here.
   */
  externals?: Externals;
  /**
   * Resolver for a composition's **local media assets** (`loadAsset('./clip.mp4')`).
   * Passed straight to the {@link Runtime}; `sequio render` supplies a loader that
   * reads the files off disk next to the entry, so a local `image`/`video` renders
   * the same as it previews (contract #3). Assets are never part of the bundle.
   */
  loadAsset?: AssetLoader;
}

export interface RenderBundleNodeResult {
  frames: number;
  bytes: number;
  out: string;
  container: string;
  videoCodec: string;
  audio: boolean;
}

/**
 * Compile + run `bundle` and render it to `opts.out` via the Node WebGPU pipeline.
 * The caller owns nothing — the built graph is disposed before returning.
 */
export async function renderBundleToFile(
  bundle: RuntimeBundle,
  opts: RenderBundleNodeOptions,
): Promise<RenderBundleNodeResult> {
  await setupNodeEnvironment();
  // Make the composition's own `fonts.load*` calls (run inside its builder)
  // register with @napi-rs/canvas, so text renders with the same web font the
  // browser preview uses instead of the Node default (contract #3).
  bridgeFontManagerToNode();

  const scale = Math.max(1, opts.scale ?? 1);
  let renderer: Renderer | null = null;

  const composer = await new Runtime({ ...bundle, externals: opts.externals, loadAsset: opts.loadAsset }).run();
  // The environment's renderer + scale are injected implicitly into the user's
  // `new Compositor(...)` (runtime engineForEnv folds compositorOptions in).
  const built = await composer.build({
    target: 'server',
    compositorOptions: {
      createRenderer: async (o) => {
        renderer = await createNodeWebGPURenderer(o);
        return renderer;
      },
      resolution: scale,
    },
  });

  try {
    const fps = built.compositor.timebase.fps;
    return await renderTimelineToFile(built.compositor, renderer!, {
      fps,
      range: [0, built.duration],
      out: opts.out,
      container: opts.container,
      videoCodec: opts.videoCodec,
      bitrate: opts.bitrate,
      // Mux the composition's own audio mix (music / voice-over) when it has any.
      audio: built.hasAudio ? { engine: built.audioEngine } : undefined,
      onProgress: opts.onProgress,
    });
  } finally {
    built.dispose();
  }
}
