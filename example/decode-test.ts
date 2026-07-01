/**
 * Puppeteer-driven integration test for the milestone 02 decode path.
 *
 * Runs entirely in a real (WebCodecs-capable) browser:
 *   1. record a moving box off a <canvas> into a real WebM (MediaRecorder),
 *   2. decode it back through VideoSource (Mediabunny demux + WebCodecs),
 *   3. drive Compositor at a few times and read frames out.
 *
 * The result is published on `window.__DECODE_TEST__` for the runner in
 * `scripts/verify-decode.cjs` to assert against.
 */
import { Compositor, Timebase, VideoClip, VisualTrack, VideoSource } from '../src/index';

const W = 320;
const H = 240;

/** Record ~1.5s of an animated canvas into a real WebM blob. */
async function recordCanvas(): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const stream = canvas.captureStream(30);
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm';
  const rec = new MediaRecorder(stream, { mimeType });
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const stopped = new Promise<Blob>((res) => {
    rec.onstop = () => res(new Blob(chunks, { type: 'video/webm' }));
  });

  rec.start();
  const start = performance.now();
  await new Promise<void>((res) => {
    const draw = () => {
      const t = (performance.now() - start) / 1000;
      ctx.fillStyle = '#101014';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ff4d6d';
      ctx.fillRect(20 + ((t * 160) % (W - 80)), H / 2 - 20, 40, 40);
      if (t < 1.5) requestAnimationFrame(draw);
      else res();
    };
    draw();
  });
  rec.stop();
  return stopped;
}

/** Count non-background pixels in the rendered canvas (proof something drew). */
function nonEmptyPixels(canvas: HTMLCanvasElement): number {
  const off = document.createElement('canvas');
  off.width = canvas.width;
  off.height = canvas.height;
  const ctx = off.getContext('2d')!;
  ctx.drawImage(canvas, 0, 0);
  const { data } = ctx.getImageData(0, 0, off.width, off.height);
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    // Background is ~#101014; count clearly brighter pixels.
    if (data[i]! > 60 || data[i + 1]! > 60 || data[i + 2]! > 60) n++;
  }
  return n;
}

async function run(): Promise<void> {
  const blob = await recordCanvas();

  const source = new VideoSource({ src: blob });
  const meta = await source.load();

  const compositor = new Compositor({
    width: W,
    height: H,
    timebase: new Timebase(meta.fps && meta.fps > 0 ? meta.fps : 30),
    background: 0x101014,
    preferWebGPU: false, // WebGL is more reliable under swiftshader
  });
  await compositor.init();
  document.getElementById('stage')!.append(compositor.view);

  const track = new VisualTrack();
  const clip = new VideoClip(source);
  clip.start = 0;
  clip.end = meta.duration;
  track.add(clip);
  compositor.addTrack(track);

  // Decode + render at three points; a hit at each proves prepare/getTextureAt.
  const times = [0, Math.min(0.5, meta.duration / 2), Math.min(1.0, meta.duration - 0.05)];
  const hits: boolean[] = [];
  for (const t of times) {
    await compositor.prepare(t);
    compositor.renderSync(t);
    hits.push(source.getTextureAt(t) !== null);
  }

  const pixels = nonEmptyPixels(compositor.view);

  // Seek backward to exercise directional lookahead + a cache re-read.
  await compositor.prepare(0);
  compositor.renderSync(0);

  (window as unknown as { __DECODE_TEST__: unknown }).__DECODE_TEST__ = {
    ok: hits.every(Boolean) && pixels > 100 && meta.width === W && meta.height === H,
    meta,
    hits,
    pixels,
    cachedFrameCount: source.cachedFrameCount,
  };
}

run().catch((err) => {
  (window as unknown as { __DECODE_TEST__: unknown }).__DECODE_TEST__ = {
    ok: false,
    error: String(err),
  };
});
