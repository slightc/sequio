/**
 * Pure-Node server-side render worker (Route B). Renders a timeline JSON to an
 * MP4 with **no browser** — PixiJS WebGPU (Dawn) draws the frames (filters and
 * all), Mediabunny (`@mediabunny/server`) encodes them. Same render core as the
 * browser preview (contract #3), just a different renderer + a GPU frame readback.
 *
 * Usage (via tsx):
 *   pnpm ssr:render-node -- [--timeline <spec.json>] [--out out.mp4] [--verify]
 *
 * Requires a WebGPU-capable host: a real GPU, or a software Vulkan driver
 * (Mesa lavapipe — `apt install mesa-vulkan-drivers`). Without one the worker
 * exits with a clear "Route B unavailable" message.
 */
import type { Renderer } from '@sequio/engine';
import { sampleTimeline } from '../src/sample-timeline';
import { buildTimeline, type TimelineSpec } from '../src/timeline';
import { createNodeWebGPURenderer, setupNodeEnvironment } from './env';
import { renderTimelineToFile } from './export-node';
import { loadFontsNode } from './fonts-node';

function parseArgs(argv: string[]): { timeline: string | null; bundle: string | null; out: string; verify: boolean; scale: number } {
  const args = { timeline: null as string | null, bundle: null as string | null, out: 'out.mp4', verify: false, scale: 1 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--timeline') args.timeline = argv[++i] ?? null;
    else if (argv[i] === '--bundle') args.bundle = argv[++i] ?? null;
    else if (argv[i] === '--out') args.out = argv[++i] ?? args.out;
    else if (argv[i] === '--verify') args.verify = true;
    else if (argv[i] === '--scale') args.scale = Math.max(1, Number(argv[++i]) || 1);
  }
  return args;
}

async function main(): Promise<void> {
  const { timeline, bundle, out, verify, scale } = parseArgs(process.argv.slice(2));
  const fs = await import('node:fs');
  const path = await import('node:path');

  if (timeline && bundle) throw new Error('pass only one of --timeline / --bundle');

  // Code path: re-run a RuntimeBundle's source in Node (imperative-code SSR),
  // mirroring Route A's `--bundle`. Delegates to the shared renderBundleToFile.
  if (bundle) {
    const { renderBundleToFile } = await import('./render-bundle');
    const outPath = path.resolve(out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    console.log(`Rendering code bundle ${path.resolve(bundle)} → ${outPath} (pure Node, WebGPU${scale !== 1 ? ` @ ${scale}×` : ''}) …`);
    const result = await renderBundleToFile(JSON.parse(fs.readFileSync(path.resolve(bundle), 'utf8')), { out: outPath, scale });
    console.log(`✅ wrote ${result.out} (${result.frames} frames, ${result.container}/${result.videoCodec}, ${result.bytes} bytes${result.audio ? ', +audio' : ''})`);
    if (verify) {
      const buf = fs.readFileSync(result.out);
      const magic = result.container === 'webm' ? buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3 : buf.toString('latin1', 4, 8) === 'ftyp';
      if (!(buf.length > 500 && magic)) throw new Error(`--verify failed: not a valid ${result.container} (size=${buf.length})`);
      console.log(`✅ verified: valid ${result.container} container.`);
    }
    process.exit(0);
  }

  const spec: TimelineSpec = timeline
    ? JSON.parse(fs.readFileSync(path.resolve(timeline), 'utf8'))
    : sampleTimeline();

  await setupNodeEnvironment();

  // Capture the WebGPU renderer the factory builds so the exporter can read
  // frames off its GPU.
  let renderer: Renderer | null = null;
  const built = await buildTimeline(spec, {
    createRenderer: async (opts) => {
      renderer = await createNodeWebGPURenderer(opts);
      return renderer;
    },
    loadFonts: loadFontsNode,
    resolution: scale,
  });

  try {
    const outPath = path.resolve(out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const dims = scale !== 1 ? ` @ ${scale}× (${spec.width * scale}×${spec.height * scale})` : '';
    console.log(`Rendering ${timeline ? path.resolve(timeline) : 'built-in demo'} → ${outPath} (pure Node, WebGPU${dims}) …`);

    const result = await renderTimelineToFile(built.compositor, renderer!, {
      fps: spec.fps,
      range: built.range,
      out: outPath,
      container: built.exportOptions.container,
      videoCodec: built.exportOptions.videoCodec,
      bitrate: built.exportOptions.bitrate,
      audio: built.hasAudio
        ? { engine: built.audioEngine, codec: built.exportOptions.audioCodec, bitrate: built.exportOptions.audioBitrate }
        : undefined,
    });
    console.log(
      `✅ wrote ${result.out} (${result.frames} frames, ${result.container}/${result.videoCodec}, ${result.bytes} bytes${result.audio ? ', +audio' : ''})`,
    );

    if (verify) {
      const buf = fs.readFileSync(result.out);
      const magic = result.container === 'webm' ? buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3 : buf.toString('latin1', 4, 8) === 'ftyp';
      if (!(buf.length > 500 && magic)) throw new Error(`--verify failed: not a valid ${result.container} (size=${buf.length})`);
      console.log(`✅ verified: valid ${result.container} container.`);
    }
  } finally {
    built.dispose();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌', err?.message || err);
  process.exit(1);
});
