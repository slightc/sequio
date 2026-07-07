/**
 * `sequio render <file>` — encode a composition to a video file, **pure Node**
 * (Route B: PixiJS WebGPU, no browser).
 *
 * It snapshots the entry file's project into a {@link RuntimeBundle} and hands it
 * to the server's Route B `renderBundleToFile`: the runtime re-runs the
 * composition's own builder in Node, the environment's WebGPU renderer + output
 * scale are folded into `new Compositor(...)` implicitly (contract #3), and
 * Mediabunny (`node-av`/FFmpeg) encodes the frames straight to disk.
 *
 * Requires a WebGPU-capable host: a real GPU, or a software Vulkan driver
 * (Mesa lavapipe — `apt install mesa-vulkan-drivers`). Without one the render
 * fails with a clear "Route B needs a GPU or a software Vulkan driver" message.
 */
import { readBundle } from './bundle';

export interface RenderOptions {
  out?: string;
  verify?: boolean;
  /** Output resolution multiplier (N× the composition size). @default 1 */
  scale?: number;
}

/** Sniff the container from magic bytes so --verify catches truncated output. */
function detectContainer(buf: Uint8Array): 'mp4' | 'webm' | null {
  if (buf.length >= 12 && Buffer.from(buf.subarray(4, 8)).toString('latin1') === 'ftyp') return 'mp4';
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm';
  return null;
}

/**
 * Render `entryFile` to a video, returning the process exit code (0 = success).
 */
export async function runRender(entryFile: string, options: RenderOptions = {}): Promise<number> {
  const bundle = readBundle(entryFile);

  // Import Route B lazily: it pulls Node-only deps (WebGPU, canvas, codecs), only
  // needed when actually rendering.
  const { renderBundleToFile } = await import('@sequio/server/route-b');

  try {
    const out = options.out ?? 'out.mp4';
    console.log(`Rendering ${entryFile} (pure Node, WebGPU)${options.scale && options.scale !== 1 ? ` @ ${options.scale}×` : ''} …`);

    let lastPct = -1;
    const result = await renderBundleToFile(bundle, {
      out,
      scale: options.scale,
      onProgress: (p) => {
        const pct = Math.round(p * 100);
        if (pct !== lastPct && pct % 10 === 0) {
          lastPct = pct;
          process.stdout.write(`\r  ${pct}%`);
        }
      },
    });
    process.stdout.write('\r     \r');
    console.log(
      `✅ wrote ${result.out} (${result.frames} frames, ` +
        `${result.container}/${result.videoCodec}, ${result.bytes} bytes${result.audio ? ', +audio' : ''})`,
    );

    if (options.verify) {
      const fs = await import('node:fs');
      const buf = fs.readFileSync(result.out);
      const kind = detectContainer(buf);
      if (!kind || buf.length < 500) {
        throw new Error(`--verify failed: not a valid container (detected=${kind}, size=${buf.length})`);
      }
      console.log(`✅ verified: valid ${kind} container.`);
    }
    return 0;
  } catch (err) {
    console.error('✖', err instanceof Error ? err.message : String(err));
    return 1;
  }
}
