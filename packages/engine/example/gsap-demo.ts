/**
 * Demo — driving sequio clips with a **real GSAP timeline** through the engine's
 * GSAP binding (`gsapClipAnimator` / `gsapTextAnimator`). GSAP is a *devDependency*
 * here (the published engine never depends on it); this page plays the role of a
 * consumer that owns gsap and injects it.
 *
 * Two things animate, looping over a {@link RealtimeClock}:
 *   1. a card whose entrance (drop + spin + settle, `back.out`) is a paused GSAP
 *      timeline the engine *seeks* every frame (so it stays reproducible), and
 *   2. split text whose glyphs stagger in with GSAP's `stagger`.
 *
 * It also self-verifies: renders at t=0 and settled, samples pixels, and publishes
 * `window.__GSAP_TEST__` for `pnpm verify:gsap` (hidden at start → visible settled).
 */
import gsap from 'gsap';
import {
  Compositor,
  RealtimeClock,
  ShapeClip,
  TextClip,
  Timebase,
  VisualTrack,
  gsapClipAnimator,
  gsapTextAnimator,
} from '../src/index';

const W = 640;
const H = 360;
const FPS = 30;
const DURATION = 3; // loop length in seconds

function px(data: Uint8ClampedArray, w: number, x: number, y: number) {
  const i = (y * w + x) * 4;
  return { r: data[i]!, g: data[i + 1]!, b: data[i + 2]! };
}

/** Any pixel in a box around (cx,cy) matching `pred`. */
function anyAround(
  data: Uint8ClampedArray,
  w: number,
  cx: number,
  cy: number,
  r: number,
  pred: (p: { r: number; g: number; b: number }) => boolean,
): boolean {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || y < 0 || x >= w || y >= H) continue;
      if (pred(px(data, w, x, y))) return true;
    }
  }
  return false;
}

async function run(): Promise<void> {
  const compositor = new Compositor({ width: W, height: H, timebase: new Timebase(FPS), background: 0x0b0b12, preferWebGPU: false });
  await compositor.init();
  document.getElementById('stage')!.append(compositor.view);

  const track = new VisualTrack();

  // 1) A card whose whole-clip entrance is a real GSAP timeline (paused + seeked).
  const card = new ShapeClip({ kind: 'rect', width: 240, height: 120, fill: 0x5b8cff, radius: 18 });
  card.start = 0;
  card.end = 100;
  card.transform.anchor.setStatic([0.5, 0.5]);
  card.transform.position.setStatic([W / 2, 120]);
  card.animator = gsapClipAnimator(gsap, (tl, o) => {
    tl.from(o, { y: -180, alpha: 0, rotation: -0.5, duration: 0.8, ease: 'back.out(1.7)' });
    tl.to(o, { scaleX: 1.08, scaleY: 1.08, duration: 0.45, ease: 'power1.inOut', yoyo: true, repeat: 1 });
  });

  // 2) Split text staggered in with GSAP's `stagger`.
  const text = new TextClip({ text: 'GSAP × SEQUIO', fontFamily: 'sans-serif', fontSize: 46, fill: 0xffffff });
  text.start = 0;
  text.end = 100;
  text.split = 'char';
  text.transform.anchor.setStatic([0.5, 0.5]);
  text.transform.position.setStatic([W / 2, 250]);
  text.textAnimator = gsapTextAnimator(gsap, text.partCount, (tl, parts) => {
    tl.from(parts, { y: 44, alpha: 0, rotation: 0.35, stagger: 0.05, duration: 0.5, ease: 'power3.out' });
  });

  track.add(card);
  track.add(text);
  compositor.addTrack(track);

  // ── Self-verify (before the live loop touches the canvas) ──────────────────
  const parts = text.getParts();
  const blockW = Math.max(...parts.map((p) => p.x + p.width / 2));
  const glyphX = (i: number) => Math.round(W / 2 + parts[i]!.x - blockW / 2);
  const textY = 250;
  const cardXY: [number, number] = [Math.round(W / 2), 120];

  const off = document.createElement('canvas');
  off.width = W;
  off.height = H;
  const octx = off.getContext('2d')!;
  const sample = (t: number) => {
    compositor.renderSync(t);
    octx.clearRect(0, 0, W, H);
    octx.drawImage(compositor.view, 0, 0);
    return octx.getImageData(0, 0, W, H).data;
  };
  const isBlue = (p: { r: number; g: number; b: number }) => p.b > 150 && p.b > p.r + 30;
  const isBright = (p: { r: number; g: number; b: number }) => p.r > 170 && p.g > 170 && p.b > 170;

  const d0 = sample(0); // everything animated in → hidden
  const cardHiddenStart = !anyAround(d0, W, cardXY[0], cardXY[1], 40, isBlue);
  const textHiddenStart = !anyAround(d0, W, glyphX(0), textY, 16, isBright);

  const dEnd = sample(2.5); // settled
  const cardVisibleSettled = anyAround(dEnd, W, cardXY[0], cardXY[1], 40, isBlue);
  const textVisibleSettled =
    anyAround(dEnd, W, glyphX(0), textY, 16, isBright) &&
    anyAround(dEnd, W, glyphX(parts.length - 1), textY, 16, isBright);

  (window as unknown as { __GSAP_TEST__: unknown }).__GSAP_TEST__ = {
    ok: cardHiddenStart && textHiddenStart && cardVisibleSettled && textVisibleSettled,
    parts: parts.length,
    cardHiddenStart,
    textHiddenStart,
    cardVisibleSettled,
    textVisibleSettled,
  };

  // ── Live, looping playback so the page actually animates ───────────────────
  const clock = new RealtimeClock(compositor.timebase);
  clock.duration = DURATION;
  clock.onTick((t) => compositor.renderPreview(t));
  clock.onEnded(() => {
    clock.seek(0);
    clock.play();
  });
  clock.play();
}

run().catch((err) => {
  (window as unknown as { __GSAP_TEST__: unknown }).__GSAP_TEST__ = { ok: false, error: String(err) };
});
