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
import { type AssetLoader, Runtime, type Externals, type RuntimeBundle } from '@sequio/runtime';
import { serverEnv } from '@sequio/server';
import { renderTimelineToFile } from './export-node';

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
  // Set up the server render env (Node bootstrap + WebGPU renderer + scale,
  // registered at the engine layer), then run the runtime and get the Compositor.
  // The env stays out of the runtime: externals / loadAsset go straight to Runtime,
  // and the renderer is folded into `new Compositor(...)` via the engine default
  // (contract #3), so the composition code reads like a browser demo.
  const env = serverEnv({ scale: opts.scale });
  await env.setup();
  const composer = await new Runtime({ ...bundle, externals: opts.externals, loadAsset: opts.loadAsset }).run();
  const built = await composer.build();

  try {
    const fps = built.compositor.timebase.fps;
    return await renderTimelineToFile(built.compositor, env.renderer!, {
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
