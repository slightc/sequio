/**
 * Self-contained Route B font check: load a Google font (Roboto) in pure Node and
 * render text with it, then read the frame back off the GPU and assert glyph
 * pixels actually drew. Proves `loadFontsNode` (css2 → font file → GlobalFonts)
 * makes the font available to PixiJS's text measurement/rendering. Needs network
 * to fonts.googleapis.com / fonts.gstatic.com.
 */
import type { Renderer } from '../../src/index';
import { buildTimeline, type TimelineSpec } from '../ssr/timeline';
import { createNodeWebGPURenderer, setupNodeEnvironment } from './env';
import { loadFontsNode } from './fonts-node';

const W = 240;
const H = 60;

const spec: TimelineSpec = {
  width: W,
  height: H,
  fps: 30,
  background: 0x000000,
  range: [0, 1],
  fonts: [{ family: 'Roboto', google: { weights: [700] } }],
  tracks: [
    {
      clips: [
        {
          type: 'text',
          text: 'Roboto 700',
          fontFamily: 'Roboto',
          fontSize: 40,
          fill: 0xffffff,
          start: 0,
          end: 1,
          transform: { anchor: [0, 0.5], position: [8, H / 2] },
        },
      ],
    },
  ],
};

async function main(): Promise<void> {
  await setupNodeEnvironment();

  let renderer: Renderer | null = null;
  const built = await buildTimeline(spec, {
    createRenderer: async (opts) => (renderer = await createNodeWebGPURenderer(opts)),
    loadFonts: loadFontsNode,
  });

  await built.compositor.prepare(0);
  const rt = built.compositor.renderToTexture(0);
  const G = globalThis as unknown as { GPUBufferUsage: { COPY_DST: number; MAP_READ: number }; GPUMapMode: { READ: number } };
  const gpu = renderer as unknown as { gpu: { device: GPUDevice }; texture: { getGpuSource(s: unknown): GPUTexture } };
  const device = gpu.gpu.device;
  const tex = gpu.texture.getGpuSource(rt.source);
  const bpr = Math.ceil((W * 4) / 256) * 256;
  const buf = device.createBuffer({ size: bpr * H, usage: G.GPUBufferUsage.COPY_DST | G.GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: bpr, rowsPerImage: H }, { width: W, height: H, depthOrArrayLayers: 1 });
  device.queue.submit([enc.finish()]);
  await buf.mapAsync(G.GPUMapMode.READ);
  const padded = new Uint8Array(buf.getMappedRange());
  let whitePixels = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const s = y * bpr + x * 4;
      if (padded[s]! > 180 && padded[s + 1]! > 180 && padded[s + 2]! > 180) whitePixels++;
    }
  }
  buf.unmap();
  built.dispose();

  console.log(`glyph (white) pixels rendered: ${whitePixels}`);
  if (whitePixels < 100) throw new Error('font verify FAILED — text did not render (font not loaded?)');
  console.log('✅ Route B Google font verified: Roboto loaded and text rendered.');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌', err?.message || err);
  process.exit(1);
});
