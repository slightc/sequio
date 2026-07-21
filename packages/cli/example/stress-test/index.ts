import {
  Compositor,
  ImageClip,
  ImageSource,
  ShapeClip,
  TextClip,
  VideoClip,
  VideoSource,
  VisualTrack,
  easeInOutCubic,
  easeOutCubic,
  type VisualClip,
} from '@sequio/engine';
import { defineComposition } from '@sequio/runtime';

/**
 * CLI demo — a **load / stress test** for the render pipeline.
 *
 *   sequio preview example/stress-test/index.ts        # live, watch the fps
 *   sequio render  example/stress-test/index.ts --out stress.mp4
 *   sequio frame   example/stress-test/index.ts --time 6 --out stress.png
 *
 * This composition deliberately piles work onto every frame so you can profile
 * the engine under pressure and compare preview (best-effort) vs. render
 * (never-drop) throughput:
 *
 *   - many simultaneously-active clips (compositing + transform eval per frame),
 *   - several concurrent **network video** decodes (the heaviest knob),
 *   - a wall of **network images**, each keyframe-animated,
 *   - hundreds of animated shapes + text clips.
 *
 * Every media asset is referenced by URL — nothing is stored in the repo, the
 * media lives on its origin server (so preview/render need network access, and
 * the URLs must be CORS-enabled; video also needs HTTP range support). Swap in
 * your own URLs freely.
 *
 * Turn the LOAD KNOBS below up or down to dial the pressure. `render(t)` stays a
 * pure function of the graph + t (contract #2), so the layout is deterministic
 * across runs — a fixed seed drives all the "random" placement.
 */

// ── Frame + duration ─────────────────────────────────────────────────────────
const W = 1920;
const H = 1080;
const FPS = 30;
const DURATION = 12;

// ── LOAD KNOBS — crank these up to push the engine harder ─────────────────────
const IMAGE_TILES = 64; // network images in an animated grid (composite + transforms/frame)
const VIDEO_LAYERS = 4; // concurrent full-frame network video decodes — the HEAVY knob
const TEXT_LABELS = 40; // animated text clips (text layout + draw/frame)
const SHAPE_CONFETTI = 120; // animated shapes (many cheap fill draws/frame)

// ── Network assets (CORS-enabled; swap in your own) ───────────────────────────
// picsum returns a distinct deterministic image per seed at the requested size,
// so a wall of N tiles is N small, cache-friendly downloads.
const imageUrl = (seed: string, w: number, h: number) =>
  `https://picsum.photos/seed/${seed}/${w}/${h}`;
// A small pool of public sample videos (CORS `*` + HTTP range). Cycled across
// the layers; hosted on GitHub Pages / jsdelivr, which serve both. (Google's
// gtv-videos-bucket samples were dropped — they now 403.)
const VIDEO_POOL = [
  'https://mdn.github.io/shared-assets/videos/flower.mp4',
  'https://mdn.github.io/shared-assets/videos/friday.mp4',
  'https://cdn.jsdelivr.net/gh/mediaelement/mediaelement-files/big_buck_bunny.mp4',
  'https://cdn.jsdelivr.net/gh/mediaelement/mediaelement-files/echo-hereweare.mp4',
];

const LABEL_WORDS = ['LOAD', 'STRESS', 'DECODE', 'COMPOSITE', 'FRAME', 'GPU', 'THROUGHPUT', 'RENDER'];

/** Deterministic PRNG (mulberry32) so placement is stable across runs. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fill the frame like CSS `object-fit: cover`, centred; returns the base scale. */
function coverFull(clip: VisualClip, sw: number, sh: number): number {
  const scale = Math.max(W / sw, H / sh);
  clip.transform.anchor.setStatic([0.5, 0.5]);
  clip.transform.position.setStatic([W / 2, H / 2]);
  clip.transform.scale.setStatic([scale, scale]);
  return scale;
}

/** VIDEO_LAYERS full-frame network videos, all decoding every frame, cross-fading. */
async function buildVideoMontage(compositor: Compositor): Promise<void> {
  const track = new VisualTrack();
  track.zIndex = 0;

  const clips = await Promise.all(
    Array.from({ length: VIDEO_LAYERS }, async (_unused, i) => {
      const source = new VideoSource({ src: VIDEO_POOL[i % VIDEO_POOL.length]! });
      const meta = await source.load();
      // Keep memory bounded: many concurrent decoders, small ring each.
      source.configureCache(8, 4);

      const clip = new VideoClip(source);
      clip.start = 0;
      clip.end = DURATION;
      const base = coverFull(clip, meta.width, meta.height);
      // Slow Ken Burns push so the transform re-evaluates every frame.
      clip.transform.scale.setKeyframes([
        { time: 0, value: [base, base] },
        { time: DURATION, value: [base * 1.15, base * 1.15], easing: easeInOutCubic },
      ]);
      // Rotating cross-fade: each layer peaks at a different point in the loop,
      // but every layer stays active (and therefore decoding) the whole time.
      const peak = (i / VIDEO_LAYERS) * DURATION;
      clip.opacity.setKeyframes([
        { time: 0, value: i === 0 ? 1 : 0.15 },
        { time: Math.max(0.001, peak), value: 1, easing: easeInOutCubic },
        { time: DURATION, value: 0.15, easing: easeInOutCubic },
      ]);
      return clip;
    }),
  );
  for (const c of clips) track.add(c);
  compositor.addTrack(track);
}

/** A grid of IMAGE_TILES network images, each keyframe-animated (float/pulse/spin). */
async function buildImageWall(compositor: Compositor): Promise<void> {
  const track = new VisualTrack();
  track.zIndex = 1;

  const cols = Math.ceil(Math.sqrt((IMAGE_TILES * W) / H));
  const rows = Math.ceil(IMAGE_TILES / cols);
  const cellW = W / cols;
  const cellH = H / rows;
  // Request each image near its cell size (capped) — small, many, distinct.
  const reqW = Math.min(Math.round(cellW), 480);
  const reqH = Math.min(Math.round(cellH), 480);

  const clips = await Promise.all(
    Array.from({ length: IMAGE_TILES }, async (_unused, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const r = rng(1000 + i);
      const source = new ImageSource({ src: imageUrl(`sequio-${i}`, reqW, reqH) });
      const meta = await source.load();

      const clip = new ImageClip(source);
      clip.start = 0;
      clip.end = DURATION;
      clip.transform.anchor.setStatic([0.5, 0.5]);

      const cx = col * cellW + cellW / 2;
      const cy = row * cellH + cellH / 2;
      const driftX = (r() - 0.5) * cellW * 0.5;
      const driftY = (r() - 0.5) * cellH * 0.5;
      clip.transform.position.setKeyframes([
        { time: 0, value: [cx, cy] },
        { time: DURATION * 0.5, value: [cx + driftX, cy + driftY], easing: easeInOutCubic },
        { time: DURATION, value: [cx, cy], easing: easeInOutCubic },
      ]);

      // Cover the cell (slightly overscanned so drift never exposes a gap), pulsing.
      const base = Math.max(cellW / meta.width, cellH / meta.height) * 1.08;
      const pulse = base * (1.08 + r() * 0.15);
      clip.transform.scale.setKeyframes([
        { time: 0, value: [base, base] },
        { time: DURATION * 0.5, value: [pulse, pulse], easing: easeInOutCubic },
        { time: DURATION, value: [base, base], easing: easeInOutCubic },
      ]);
      clip.transform.rotation.setKeyframes([
        { time: 0, value: 0 },
        { time: DURATION, value: (r() - 0.5) * 0.35 },
      ]);
      // Staggered fade-in so the wall assembles over the first ~1.5s.
      const inAt = (i / IMAGE_TILES) * 1.5;
      clip.opacity.setKeyframes([
        { time: 0, value: 0 },
        { time: inAt + 0.4, value: 0.95, easing: easeOutCubic },
      ]);
      return clip;
    }),
  );
  for (const c of clips) track.add(c);
  compositor.addTrack(track);
}

/** SHAPE_CONFETTI small shapes drifting + spinning across the frame. */
function buildConfetti(compositor: Compositor): void {
  const track = new VisualTrack();
  track.zIndex = 2;
  const palette = [0x38bdf8, 0xf472b6, 0xfacc15, 0x34d399, 0xa78bfa, 0xfb7185];

  for (let i = 0; i < SHAPE_CONFETTI; i++) {
    const r = rng(5000 + i);
    const kind = r() < 0.5 ? 'rect' : 'ellipse';
    const size = 10 + r() * 26;
    const clip = new ShapeClip({
      kind,
      width: size,
      height: size,
      fill: palette[i % palette.length]!,
      radius: kind === 'rect' ? 3 : undefined,
    });
    clip.start = 0;
    clip.end = DURATION;
    clip.transform.anchor.setStatic([0.5, 0.5]);
    clip.opacity.setStatic(0.55 + r() * 0.35);

    const x0 = r() * W;
    const x1 = x0 + (r() - 0.5) * 200;
    // Fall from above the frame to below it, wrapping the vertical span.
    const y0 = -60 - r() * H;
    clip.transform.position.setKeyframes([
      { time: 0, value: [x0, y0] },
      { time: DURATION, value: [x1, y0 + H + 120] },
    ]);
    clip.transform.rotation.setKeyframes([
      { time: 0, value: 0 },
      { time: DURATION, value: (r() - 0.5) * 12 },
    ]);
    track.add(clip);
  }
  compositor.addTrack(track);
}

/** TEXT_LABELS scattered animated captions + a HUD title reporting the load. */
function buildText(compositor: Compositor): void {
  const track = new VisualTrack();
  track.zIndex = 3;

  for (let i = 0; i < TEXT_LABELS; i++) {
    const r = rng(9000 + i);
    const word = LABEL_WORDS[i % LABEL_WORDS.length]!;
    const clip = new TextClip({ text: word, fontSize: 20 + Math.round(r() * 44), fill: 0xffffff });
    clip.start = 0;
    clip.end = DURATION;
    clip.transform.anchor.setStatic([0.5, 0.5]);
    const x = 80 + r() * (W - 160);
    const y = 80 + r() * (H - 160);
    clip.transform.position.setKeyframes([
      { time: 0, value: [x, y + 30] },
      { time: DURATION * 0.5, value: [x, y - 30], easing: easeInOutCubic },
      { time: DURATION, value: [x, y + 30], easing: easeInOutCubic },
    ]);
    // Blink in and out so opacity re-evaluates every frame.
    const phase = r();
    clip.opacity.setKeyframes([
      { time: 0, value: 0.1 },
      { time: DURATION * (0.2 + phase * 0.2), value: 0.85, easing: easeInOutCubic },
      { time: DURATION * (0.7 + phase * 0.2), value: 0.1, easing: easeInOutCubic },
    ]);
    track.add(clip);
  }

  // HUD: title + a subtitle reporting the current knob settings.
  const hud = new VisualTrack();
  hud.zIndex = 4;
  const title = new TextClip({ text: 'sequio · stress test', fontSize: 72, fill: 0xffffff });
  title.start = 0;
  title.end = DURATION;
  title.transform.anchor.setStatic([0.5, 0]);
  title.transform.position.setStatic([W / 2, 48]);
  hud.add(title);

  const sub = new TextClip({
    text: `${IMAGE_TILES} imgs · ${VIDEO_LAYERS} vids · ${TEXT_LABELS} texts · ${SHAPE_CONFETTI} shapes @ ${W}×${H}/${FPS}fps`,
    fontSize: 30,
    fill: 0x9fb4d0,
  });
  sub.start = 0;
  sub.end = DURATION;
  sub.transform.anchor.setStatic([0.5, 0]);
  sub.transform.position.setStatic([W / 2, 132]);
  hud.add(sub);

  compositor.addTrack(track);
  compositor.addTrack(hud);
}

export default defineComposition(async () => {
  const compositor = new Compositor({ width: W, height: H, fps: FPS, background: 0x05060a });
  await compositor.init();

  // Fetch + decode the network media in parallel so the build doesn't serialize
  // dozens of round-trips; the graph itself is the point of the stress test.
  await Promise.all([buildVideoMontage(compositor), buildImageWall(compositor)]);
  buildConfetti(compositor);
  buildText(compositor);

  return { compositor, duration: DURATION };
});
