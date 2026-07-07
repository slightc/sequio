/**
 * Self-contained Route B media-source check: decode a real video and an image in
 * pure Node and composite them. First renders a short "source" video (a red block
 * sliding L→R) to a file, then loads it back as a VideoSource, adds an ImageClip
 * from a data: URL on top, renders a frame in pure Node, and asserts the decoded
 * video pixels (red block) and the image (blue square) actually show. Proves the
 * loadMediabunny() instance seam + the createImageBitmap polyfill.
 */
import { Compositor, ImageClip, ImageSource, type Renderer, Timebase, VideoClip, VideoSource, VisualTrack } from '@sequio/engine';
import { createNodeWebGPURenderer, setupNodeEnvironment } from './env';
import { renderTimelineToFile } from './export-node';
import { buildTimeline, type TimelineSpec } from '../src/timeline';

async function readFrame(renderer: Renderer, rtSource: { pixelWidth: number; pixelHeight: number }): Promise<{ data: Uint8Array; W: number; H: number }> {
  const G = globalThis as unknown as { GPUBufferUsage: { COPY_DST: number; MAP_READ: number }; GPUMapMode: { READ: number } };
  const gpu = renderer as unknown as { gpu: { device: GPUDevice }; texture: { getGpuSource(s: unknown): GPUTexture } };
  const device = gpu.gpu.device;
  const tex = gpu.texture.getGpuSource(rtSource);
  const W = rtSource.pixelWidth;
  const H = rtSource.pixelHeight;
  const bpr = Math.ceil((W * 4) / 256) * 256;
  const buf = device.createBuffer({ size: bpr * H, usage: G.GPUBufferUsage.COPY_DST | G.GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: bpr, rowsPerImage: H }, { width: W, height: H, depthOrArrayLayers: 1 });
  device.queue.submit([enc.finish()]);
  await buf.mapAsync(G.GPUMapMode.READ);
  const padded = new Uint8Array(buf.getMappedRange());
  const data = new Uint8Array(W * H * 4); // BGRA→RGBA
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const s = y * bpr + x * 4; const d = (y * W + x) * 4; data[d] = padded[s + 2]!; data[d + 1] = padded[s + 1]!; data[d + 2] = padded[s]!; data[d + 3] = padded[s + 3]!; }
  buf.unmap();
  return { data, W, H };
}

async function main(): Promise<void> {
  await setupNodeEnvironment();
  const fs = await import('node:fs');
  const path = await import('node:path');
  fs.mkdirSync('.ssr-out', { recursive: true });

  // 1. Render a source video: a red block sliding across a black frame.
  const SW = 160, SH = 120, FPS = 15;
  const srcSpec: TimelineSpec = {
    width: SW, height: SH, fps: FPS, background: 0x000000, range: [0, 1],
    tracks: [{ clips: [{ type: 'shape', shape: { kind: 'rect', width: 50, height: 50, fill: 0xff0000 }, start: 0, end: 1,
      transform: { anchor: [0.5, 0.5], position: { keyframes: [{ time: 0, value: [30, SH / 2] }, { time: 1, value: [SW - 30, SH / 2] }] } } }] }],
  };
  let srcRenderer: Renderer | null = null;
  const srcBuilt = await buildTimeline(srcSpec, { createRenderer: async (o) => (srcRenderer = await createNodeWebGPURenderer(o)) });
  const gen = await renderTimelineToFile(srcBuilt.compositor, srcRenderer!, { fps: FPS, range: [0, 1], out: path.resolve('.ssr-out/media-src.mp4') });
  srcBuilt.dispose();
  console.log(`source video: ${gen.out} (${gen.container}/${gen.videoCodec}, ${gen.bytes} bytes)`);

  // 2. Build a compositor that decodes that video + an image (data: URL).
  const W = 240, H = 120;
  let renderer: Renderer | null = null;
  const comp = new Compositor({ width: W, height: H, timebase: new Timebase(FPS), background: 0x101014, createRenderer: async (o) => (renderer = await createNodeWebGPURenderer(o)) });
  await comp.init();

  const fileBytes = fs.readFileSync(gen.out);
  const ab = fileBytes.buffer.slice(fileBytes.byteOffset, fileBytes.byteOffset + fileBytes.byteLength);
  const videoSource = new VideoSource({ src: ab });
  const vmeta = await videoSource.load();
  console.log(`decoded video: ${vmeta.width}x${vmeta.height}, ${vmeta.duration.toFixed(2)}s`);
  const vtrack = new VisualTrack();
  vtrack.zIndex = 0;
  const vclip = new VideoClip(videoSource);
  vclip.start = 0;
  vclip.end = 1;
  vclip.transform.anchor.setStatic([0, 0]);
  vclip.transform.position.setStatic([0, 0]);
  vclip.transform.scale.setStatic([W / vmeta.width, H / vmeta.height]); // fill the frame
  vtrack.add(vclip);
  comp.addTrack(vtrack);

  // A blue square image from a data: URL, top-left area.
  const { createCanvas } = await import('@napi-rs/canvas');
  const ic = createCanvas(24, 24);
  const icx = ic.getContext('2d');
  icx.fillStyle = '#1e90ff';
  icx.fillRect(0, 0, 24, 24);
  const dataUri = 'data:image/png;base64,' + ic.toBuffer('image/png').toString('base64');
  const imgSource = new ImageSource({ src: dataUri });
  await imgSource.load();
  const itrack = new VisualTrack();
  itrack.zIndex = 1;
  const iclip = new ImageClip(imgSource);
  iclip.start = 0;
  iclip.end = 1;
  iclip.transform.anchor.setStatic([0.5, 0.5]);
  iclip.transform.position.setStatic([30, 30]);
  itrack.add(iclip);
  comp.addTrack(itrack);

  // 3. Render at t=0.5 (block near centre) and read back.
  await comp.prepare(0.5);
  const rt = comp.renderToTexture(0.5);
  const { data, W: RW, H: RH } = await readFrame(renderer!, rt.source as unknown as { pixelWidth: number; pixelHeight: number });
  rt.destroy(true);
  comp.dispose();
  videoSource.dispose();

  const at = (x: number, y: number): [number, number, number] => { const i = (Math.floor(y) * RW + Math.floor(x)) * 4; return [data[i]!, data[i + 1]!, data[i + 2]!]; };
  // Count red-dominant pixels (the video's moving block) and blue (the image).
  let red = 0, blue = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
    if (r > 130 && g < 90 && b < 90) red++;
    if (b > 130 && r < 120 && g < 160) blue++;
  }
  const imgPx = at(30, 30);
  console.log(`red (video block) px: ${red}, blue (image) px: ${blue}, image-centre pixel: ${imgPx.join(',')}`);
  const ok = red > 200 && blue > 100;
  if (!ok) throw new Error(`media verify FAILED — red=${red} blue=${blue} (video or image did not decode)`);
  console.log('✅ Route B media verified: video + image decoded and composited in pure Node.');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌', err?.message || err);
  process.exit(1);
});
