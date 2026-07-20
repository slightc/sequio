/**
 * Route B (pure Node, PixiJS WebGPU) — render **one frame** of a code
 * {@link RuntimeBundle} to an image file, no browser.
 *
 * The single-frame sibling of {@link renderBundleToFile}: instead of encoding the
 * whole timeline to a video, it runs the composition's own builder in Node, seeks
 * to a single time `t`, reads that one frame off the GPU and writes it as a PNG.
 * It's what `sequio frame` calls — a fast way to eyeball "what's on screen at
 * t = 2.5s?" without waiting for a full render.
 *
 * The frame is rendered through the exact same render core as the video export
 * (contract #3), so what you see here is what the video would contain at that
 * instant. Requires a WebGPU-capable host (real GPU or Mesa lavapipe);
 * {@link setupNodeEnvironment} throws a clear message if none is found.
 */
import { type AssetLoader, Runtime, type Externals, type RuntimeBundle } from '@sequio/runtime';
import { encodeRGBAToPng, serverEnv } from '@sequio/server';
import { renderFrameRGBA } from './export-node';

export interface RenderFrameNodeOptions {
  /** Output image path. The extension is corrected to `.png`. */
  out: string;
  /** Time (seconds) to sample. Clamped to `[0, duration]`. @default 0 */
  time?: number;
  /** Output resolution multiplier (N× the composition size). @default 1 */
  scale?: number;
  /** Extra bare modules the composition may `import` (e.g. `gsap`); see {@link renderBundleToFile}. */
  externals?: Externals;
  /** Resolver for local media assets (`loadAsset('./clip.mp4')`); see {@link renderBundleToFile}. */
  loadAsset?: AssetLoader;
}

export interface RenderFrameNodeResult {
  /** The written file path (extension corrected to `.png`). */
  out: string;
  /** The time actually sampled (the request, clamped to `[0, duration]`). */
  time: number;
  width: number;
  height: number;
  bytes: number;
}

/** Encode tightly-packed straight-alpha RGBA to a PNG on disk. The PNG encode
 *  goes through `@sequio/server` (which owns @napi-rs/canvas); the CLI just writes
 *  the returned bytes. */
async function writePng(out: string, rgba: Uint8Array, width: number, height: number): Promise<number> {
  const fs = await import('node:fs');
  const png = await encodeRGBAToPng(rgba, width, height);
  fs.writeFileSync(out, png);
  return png.length;
}

/** Force a `.png` extension on the output path. */
function pngPath(out: string): string {
  return out.replace(/\.[^./\\]*$/, '') + '.png';
}

/**
 * Compile + run `bundle`, seek to `opts.time`, and write that single frame to
 * `opts.out` (as PNG). The built graph is disposed before returning.
 */
export async function renderBundleFrameToFile(
  bundle: RuntimeBundle,
  opts: RenderFrameNodeOptions,
): Promise<RenderFrameNodeResult> {
  // Set up the server render env, run the runtime, get the Compositor; the created
  // renderer comes back as `env.renderer`. See {@link renderBundleToFile}.
  const env = serverEnv({ scale: opts.scale });
  await env.setup();
  const composer = await new Runtime({ ...bundle, externals: opts.externals, loadAsset: opts.loadAsset }).run();
  const built = await composer.build();

  try {
    // Clamp the requested time into the composition's timeline.
    const t = Math.min(Math.max(opts.time ?? 0, 0), built.duration);
    const { rgba, width, height } = await renderFrameRGBA(built.compositor, env.renderer!, t);
    const out = pngPath(opts.out);
    const bytes = await writePng(out, rgba, width, height);
    return { out, time: t, width, height, bytes };
  } finally {
    built.dispose();
  }
}
