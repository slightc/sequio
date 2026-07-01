/**
 * Puppeteer-driven integration test for the milestone 02 decode path + the
 * example's object-fit:cover layout.
 *
 * Runs entirely in a real (WebCodecs-capable) browser:
 *   1. record a full-bleed gradient (+ moving marker) off a <canvas> into a
 *      real WebM (MediaRecorder),
 *   2. decode it back through VideoSource (Mediabunny demux + WebCodecs),
 *   3. lay it out with applyCover() into a DIFFERENT-aspect stage and render,
 *   4. assert frames decode AND the stage is fully covered (bright to the
 *      edges — a letterbox would leave the dark canvas background showing).
 *
 * The result is published on `window.__DECODE_TEST__` for the runner in
 * `scripts/verify-decode.cjs`.
 */
import { Compositor, Timebase, VideoClip, VisualTrack, VideoSource } from '../src/index';
import { applyCover } from './cover';

const SRC_W = 320; // recorded video size
const SRC_H = 240;
const STAGE_W = 480; // deliberately wider aspect than the video, to exercise cover
const STAGE_H = 240;
const BG = 0x101014; // canvas clear color; a letterbox would show this

/** Record ~1.5s of a full-bleed animated gradient into a real WebM blob. */
async function recordCanvas(): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = SRC_W;
  canvas.height = SRC_H;
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
      const g = ctx.createLinearGradient(0, 0, SRC_W, SRC_H);
      g.addColorStop(0, '#ff8a00');
      g.addColorStop(1, '#2b6cff');
      ctx.fillStyle = g; // full-bleed, edge to edge
      ctx.fillRect(0, 0, SRC_W, SRC_H);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(20 + ((t * 160) % (SRC_W - 80)), SRC_H / 2 - 20, 40, 40);
      if (t < 1.5) requestAnimationFrame(draw);
      else res();
    };
    draw();
  });
  rec.stop();
  return stopped;
}

/** max(r,g,b) at a pixel — high on gradient video, low (~20) on dark canvas bg. */
function brightnessAt(data: Uint8ClampedArray, w: number, x: number, y: number): number {
  const i = (y * w + x) * 4;
  return Math.max(data[i]!, data[i + 1]!, data[i + 2]!);
}

async function run(): Promise<void> {
  const blob = await recordCanvas();

  const source = new VideoSource({ src: blob });
  const meta = await source.load();

  const compositor = new Compositor({
    width: STAGE_W,
    height: STAGE_H,
    timebase: new Timebase(meta.fps && meta.fps > 0 ? meta.fps : 30),
    background: BG,
    preferWebGPU: false, // WebGL is more reliable under swiftshader
  });
  await compositor.init();
  document.getElementById('stage')!.append(compositor.view);

  const track = new VisualTrack();
  const clip = new VideoClip(source);
  clip.start = 0;
  clip.end = meta.duration;
  applyCover(clip, meta.width, meta.height, STAGE_W, STAGE_H);
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

  // Read the rendered canvas back and sample the four corners + center. With
  // cover, every one is video (bright); a letterbox/contain would leave dark
  // bars at the left/right edges.
  const off = document.createElement('canvas');
  off.width = STAGE_W;
  off.height = STAGE_H;
  const octx = off.getContext('2d')!;
  octx.drawImage(compositor.view, 0, 0);
  const { data } = octx.getImageData(0, 0, STAGE_W, STAGE_H);
  const probes = {
    topLeft: brightnessAt(data, STAGE_W, 1, 1),
    topRight: brightnessAt(data, STAGE_W, STAGE_W - 2, 1),
    bottomLeft: brightnessAt(data, STAGE_W, 1, STAGE_H - 2),
    bottomRight: brightnessAt(data, STAGE_W, STAGE_W - 2, STAGE_H - 2),
    center: brightnessAt(data, STAGE_W, STAGE_W >> 1, STAGE_H >> 1),
  };
  const covered = Object.values(probes).every((b) => b > 100);

  (window as unknown as { __DECODE_TEST__: unknown }).__DECODE_TEST__ = {
    ok:
      hits.every(Boolean) &&
      covered &&
      meta.width === SRC_W &&
      meta.height === SRC_H,
    meta,
    hits,
    covered,
    probes,
    cachedFrameCount: source.cachedFrameCount,
  };
}

run().catch((err) => {
  (window as unknown as { __DECODE_TEST__: unknown }).__DECODE_TEST__ = {
    ok: false,
    error: String(err),
  };
});
