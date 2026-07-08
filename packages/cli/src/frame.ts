/**
 * `sequio frame <file>` — export a **single frame** at a given time as a PNG,
 * **pure Node** (Route B: PixiJS WebGPU, no browser).
 *
 * A fast way to eyeball "what's on screen at t = 2.5s?" without rendering the
 * whole video: it snapshots the entry file's project into a {@link RuntimeBundle},
 * re-runs the composition's own builder in Node, seeks to one time and writes that
 * frame to disk. Same render core as `sequio render` (contract #3), so the frame
 * is exactly what the video would contain at that instant.
 *
 * Requires a WebGPU-capable host: a real GPU, or a software Vulkan driver (Mesa
 * lavapipe — `apt install mesa-vulkan-drivers`). Without one it fails with a
 * clear "Route B needs a GPU or a software Vulkan driver" message.
 */
import { dirname, resolve } from 'node:path';
import { readBundle } from './bundle';
import { nodeAssetLoader } from './assets-node';
import { cliExternals } from './externals';

export interface FrameOptions {
  /** Time (seconds) to sample. Clamped to `[0, duration]`. @default 0 */
  time?: number;
  /** Output PNG path. @default frame.png */
  out?: string;
  /** Output resolution multiplier (N× the composition size). @default 1 */
  scale?: number;
}

/**
 * Export one frame of `entryFile` to a PNG, returning the process exit code
 * (0 = success).
 */
export async function runFrame(entryFile: string, options: FrameOptions = {}): Promise<number> {
  const bundle = readBundle(entryFile);
  // The entry's directory is the project root — where `loadAsset('./clip.mp4')`
  // reads a composition's local media files from on disk.
  const projectRoot = dirname(resolve(entryFile));

  // Import Route B lazily: it pulls Node-only deps (WebGPU, canvas, codecs), only
  // needed when actually rendering.
  const { renderBundleFrameToFile } = await import('@sequio/server/route-b');

  try {
    const out = options.out ?? 'frame.png';
    const time = options.time ?? 0;
    console.log(
      `Rendering ${entryFile} frame @ t=${time}s (pure Node, WebGPU)` +
        `${options.scale && options.scale !== 1 ? ` @ ${options.scale}×` : ''} …`,
    );

    const result = await renderBundleFrameToFile(bundle, {
      out,
      time,
      scale: options.scale,
      // Make gsap (and any other CLI-provided lib) resolvable to the composition
      // in the Node render, same as the browser preview does.
      externals: cliExternals(),
      // Resolve `loadAsset('./clip.mp4')` against the project directory on disk,
      // so a local image/video renders the same as it previews (contract #3).
      loadAsset: nodeAssetLoader(projectRoot),
    });

    const clamped = result.time !== time ? ` (clamped from ${time}s)` : '';
    console.log(
      `✅ wrote ${result.out} (${result.width}×${result.height}, ` +
        `t=${result.time}s${clamped}, ${result.bytes} bytes)`,
    );
    return 0;
  } catch (err) {
    console.error('✖', err instanceof Error ? err.message : String(err));
    return 1;
  }
}
