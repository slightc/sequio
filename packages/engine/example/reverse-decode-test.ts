/**
 * Puppeteer verification for the reverse-decode fast path (倒放解码优化).
 *
 * Real browser, real WebCodecs. Drives the `clip.reversed` flag (倒放 is set on
 * the CLIP) end-to-end through prepare→decode→render:
 *   1. record a video whose white marker sweeps left→right by frame index, so
 *      each frame is visually ordered,
 *   2. `reversed = false`: play the timeline forward, marker X increases (baseline),
 *   3. `reversed = true`: play the timeline STILL FORWARD — the compositor must
 *      decode + render the source in reverse, so the marker X *decreases*. This
 *      proves the flag on the clip flows through the decode path (not a manual
 *      backward seek), which only works because prepare uses `clip.sourceTimeAt`,
 *   4. assert the fast path engaged: one reversed step fills a whole cache batch
 *      (many frames resident from one prepare) — the O(GOP²)→O(GOP) fix. A naive
 *      per-frame reverse would leave ~1 frame resident and re-decode the GOP each step.
 *
 * Result on `window.__REVERSE_DECODE_TEST__`.
 */
import { Compositor, Timebase, VideoClip, VideoSource, VisualTrack } from '../src/index';
import { applyCover } from './cover';

const W = 320;
const H = 240;
const MARKER_Y = H / 2;

/** Record a marker sweeping right by frame index (deterministic per frame). */
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
  let frame = 0;
  await new Promise<void>((res) => {
    const draw = () => {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#ff8a00');
      g.addColorStop(1, '#2b6cff');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      // Marker X grows with frame index → forward = right, reverse = left.
      const x = 20 + Math.min(W - 80, frame * 5);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, MARKER_Y - 20, 24, 40);
      frame++;
      if (frame < 45) requestAnimationFrame(draw);
      else res();
    };
    draw();
  });
  rec.stop();
  return stopped;
}

/**
 * X of the whitest column (the marker) across a band of rows around the marker.
 * White reads as a high `min(r,g,b)`; the gradient background is low-min at every
 * column, so the argmax lands on the marker. Returns -1 if nothing is clearly
 * white (best min-channel must beat the background by a clear margin).
 */
function markerX(view: HTMLCanvasElement): number {
  const off = document.createElement('canvas');
  off.width = W;
  off.height = H;
  const octx = off.getContext('2d')!;
  // Scale the whole view (which may be rendered at 2× resolution) into W×H so the
  // marker row lines up regardless of the compositor's backing-store size.
  octx.drawImage(view, 0, 0, view.width, view.height, 0, 0, W, H);
  const y0 = Math.round(MARKER_Y) - 8;
  const { data } = octx.getImageData(0, y0, W, 16);
  const colWhite = new Array<number>(W).fill(0);
  for (let row = 0; row < 16; row++) {
    for (let x = 0; x < W; x++) {
      const i = (row * W + x) * 4;
      const whiteness = Math.min(data[i]!, data[i + 1]!, data[i + 2]!);
      if (whiteness > colWhite[x]!) colWhite[x] = whiteness;
    }
  }
  let bestX = -1;
  let best = 0;
  for (let x = 0; x < W; x++) {
    if (colWhite[x]! > best) {
      best = colWhite[x]!;
      bestX = x;
    }
  }
  return best > 120 ? bestX : -1; // clearly whiter than the gradient
}

async function run(): Promise<void> {
  const blob = await recordCanvas();
  const source = new VideoSource({ src: blob });
  const meta = await source.load();
  const fps = meta.fps && meta.fps > 0 ? meta.fps : 30;

  const compositor = new Compositor({
    width: W,
    height: H,
    timebase: new Timebase(fps),
    background: 0x101014,
    preferWebGPU: false,
  });
  await compositor.init();
  document.getElementById('stage')!.append(compositor.view);
  const track = new VisualTrack();
  const clip = new VideoClip(source);
  clip.start = 0;
  clip.end = meta.duration;
  applyCover(clip, meta.width, meta.height, W, H); // lay the frame edge-to-edge
  track.add(clip);
  compositor.addTrack(track);

  const dur = meta.duration;
  const times: number[] = [];
  for (let t = 0.1; t < dur - 0.05; t += 0.1) times.push(t);

  const sampleAt = async (t: number): Promise<number> => {
    await compositor.prepare(t);
    compositor.renderSync(t);
    return markerX(compositor.view);
  };

  // ── Forward: a normal clip, timeline advancing → marker X increases. ─────────
  clip.reversed = false;
  const fwd: number[] = [];
  for (const t of times) fwd.push(await sampleAt(t));
  const fwdIncreasing = monotonic(fwd, +1);

  // ── Reversed: `clip.reversed = true`, timeline still advancing FORWARD. The
  // compositor must decode (and render) the source in reverse — so as the
  // timeline moves forward the marker X *decreases*. This exercises the flag on
  // the CLIP through prepare→decode→render (not a manual backward seek). Also
  // capture the batch fill: one step should make many frames resident.
  clip.reversed = true;
  const rev: number[] = [];
  let batchResident = 0;
  for (let k = 0; k < times.length; k++) {
    rev.push(await sampleAt(times[k]!));
    if (k === 1) batchResident = source.cachedFrameCount; // one step filled a window
  }
  const revDecreasing = monotonic(rev, -1);

  const hits = fwd.every((x) => x >= 0) && rev.every((x) => x >= 0);
  // Naive per-frame reverse leaves ~1–2 frames resident per prepare; the batch
  // fills many at once. Loose threshold to stay robust across GOP sizes.
  const batchEngaged = batchResident >= 6;

  (window as unknown as { __REVERSE_DECODE_TEST__: unknown }).__REVERSE_DECODE_TEST__ = {
    ok: hits && fwdIncreasing && revDecreasing && batchEngaged,
    hits,
    fwdIncreasing,
    revDecreasing,
    batchEngaged,
    batchResident,
    fwd,
    rev,
  };
}

/** True if `xs` (ignoring equal neighbours / gaps) trends in `dir`. */
function monotonic(xs: number[], dir: 1 | -1): boolean {
  let ups = 0;
  let downs = 0;
  for (let i = 1; i < xs.length; i++) {
    const d = xs[i]! - xs[i - 1]!;
    if (d > 2) ups++;
    else if (d < -2) downs++;
  }
  return dir > 0 ? ups > downs && downs === 0 : downs > ups && ups === 0;
}

run().catch((err) => {
  (window as unknown as { __REVERSE_DECODE_TEST__: unknown }).__REVERSE_DECODE_TEST__ = {
    ok: false,
    error: String(err),
  };
});
