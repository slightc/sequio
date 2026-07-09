/**
 * Puppeteer verification for reverse playback (倒放). Exercises the real
 * OfflineAudioContext + `AudioEngine.reversedBuffer` path (works headless):
 *
 * 1. Render a distinctive ramp buffer (samples 0→1) both forward and reversed
 *    through `AudioEngine.renderOffline`. Assert the reversed mix is the forward
 *    mix flipped end-to-end — sample `i` ≈ forward sample `N-1-i` — and that the
 *    ramp's direction actually inverts (first quarter loud↔quiet swaps with the
 *    last). This proves the engine plays a reversed copy of the buffer.
 * 2. Assert `AudioClip.sourceTimeAt` walks the same source window downward when
 *    `reversed` (the time-remap the video path feeds its decoder).
 *
 * Result on `window.__REVERSE_TEST__`.
 */
import { AudioClip, AudioEngine, type AudioSource, Timebase } from '../src/index';

const SR = 48000;
const DUR = 1; // seconds

/** A ramp buffer: sample value climbs 0 → ~1 across the whole buffer. */
function rampBuffer(): AudioBuffer {
  const length = Math.floor(DUR * SR);
  const buf = new AudioBuffer({ length, numberOfChannels: 1, sampleRate: SR });
  const d = buf.getChannelData(0);
  for (let i = 0; i < length; i++) d[i] = i / length;
  return buf;
}

function mean(data: Float32Array, from: number, to: number): number {
  let s = 0;
  for (let i = from; i < to; i++) s += data[i]!;
  return s / Math.max(1, to - from);
}

/** Render one AudioClip (forward or reversed) over the whole buffer. */
async function renderClip(buffer: AudioBuffer, reversed: boolean): Promise<Float32Array> {
  const source = { getBuffer: () => buffer } as unknown as AudioSource;
  const clip = new AudioClip();
  clip.start = 0;
  clip.end = DUR;
  clip.reversed = reversed;
  const engine = new AudioEngine(new Timebase(30));
  engine.schedule(clip, source);
  const mix = await engine.renderOffline(DUR, SR);
  return mix.getChannelData(0);
}

async function run(): Promise<void> {
  const buffer = rampBuffer();
  const fwd = await renderClip(buffer, false);
  const rev = await renderClip(buffer, true);
  const n = Math.min(fwd.length, rev.length);

  // Reversed mix should equal the forward mix flipped end-to-end. Sample a few
  // interior points (avoid the very edges, where offline rounding can nudge one
  // sample) and require rev[i] ≈ fwd[n-1-i].
  let maxErr = 0;
  for (let k = 1; k < 20; k++) {
    const i = Math.floor((k / 20) * n);
    maxErr = Math.max(maxErr, Math.abs(rev[i]! - fwd[n - 1 - i]!));
  }

  // The ramp's direction must actually invert: forward rises (first quarter
  // quiet, last quarter loud); reversed falls (the opposite).
  const q = Math.floor(n / 4);
  const fwdRises = mean(fwd, 0, q) < mean(fwd, n - q, n);
  const revFalls = mean(rev, 0, q) > mean(rev, n - q, n);

  const flippedOk = maxErr < 0.02 && fwdRises && revFalls;

  // ── 2. source-time mapping (the video path's decoder feed) ──────────────────
  const c = new AudioClip();
  c.start = 1;
  c.end = 5;
  c.sourceIn = 2;
  c.speed = 2;
  c.reversed = true;
  // reversed window walks 10 → 2 as t goes 1 → 5 (mirror of the forward window).
  const mapOk =
    Math.abs(c.sourceTimeAt(1) - 10) < 1e-9 &&
    Math.abs(c.sourceTimeAt(3) - 6) < 1e-9 &&
    Math.abs(c.sourceTimeAt(5) - 2) < 1e-9;

  (window as unknown as { __REVERSE_TEST__: unknown }).__REVERSE_TEST__ = {
    ok: flippedOk && mapOk,
    flippedOk,
    mapOk,
    maxErr,
    fwdRises,
    revFalls,
  };
}

run().catch((err) => {
  (window as unknown as { __REVERSE_TEST__: unknown }).__REVERSE_TEST__ = {
    ok: false,
    error: String(err),
  };
});
