/**
 * Puppeteer render test for text motion effects — a split TextClip driven by a
 * StaggerTextAnimator (逐字掉落 / character-by-character drop-in). Renders the
 * same clip at three times and samples per-glyph pixels to assert:
 *   - hidden at the start (every glyph faded in from above, alpha 0),
 *   - staggered midway (the first glyph has landed while the last has not),
 *   - fully settled at the end (every glyph visible on its baseline).
 *
 * This exercises the deterministic built-in animator; the GSAP binding
 * (`gsapTextAnimator`) shares the exact same per-part sampling path and is
 * covered by unit tests. Publishes on `window.__TEXT_ANIM_TEST__`.
 */
import { Compositor, StaggerTextAnimator, TextClip, Timebase, VisualTrack, easeOutCubic } from '../src/index';

const W = 480;
const H = 200;

function px(data: Uint8ClampedArray, w: number, x: number, y: number) {
  const i = (y * w + x) * 4;
  return { r: data[i]!, g: data[i + 1]!, b: data[i + 2]! };
}

/** Any near-white pixel in a small box around (cx, cy) — i.e. a glyph is drawn. */
function brightAround(data: Uint8ClampedArray, w: number, cx: number, cy: number, r = 14): boolean {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || y < 0 || x >= w || y >= H) continue;
      const p = px(data, w, x, y);
      if (p.r > 170 && p.g > 170 && p.b > 170) return true;
    }
  }
  return false;
}

async function run(): Promise<void> {
  const compositor = new Compositor({ width: W, height: H, timebase: new Timebase(30), background: 0x000000, preferWebGPU: false });
  await compositor.init();
  document.getElementById('stage')!.append(compositor.view);

  const track = new VisualTrack();
  const text = new TextClip({ text: 'SEQUIO', fontFamily: 'sans-serif', fontSize: 56, fill: 0xffffff });
  text.start = 0;
  text.end = 100;
  text.split = 'char';
  text.transform.anchor.setStatic([0.5, 0.5]);
  text.transform.position.setStatic([W / 2, H / 2]);
  // Drop each character in from 70px above, faded, staggered 0.12s apart.
  text.textAnimator = new StaggerTextAnimator({
    from: { y: -70, alpha: 0 },
    duration: 0.4,
    stagger: 0.12,
    easing: easeOutCubic,
  });
  track.add(text);
  compositor.addTrack(track);

  // Map each glyph's laid-out center to canvas pixels (block centered at W/2, H/2).
  compositor.renderSync(0); // mount + lay out
  const parts = text.getParts();
  const blockW = Math.max(...parts.map((p) => p.x + p.width / 2));
  const cx = (i: number) => Math.round(W / 2 + parts[i]!.x - blockW / 2);
  const first = 0;
  const last = parts.length - 1;
  const y = Math.round(H / 2);

  const off = document.createElement('canvas');
  off.width = W;
  off.height = H;
  const octx = off.getContext('2d')!;
  const sample = (t: number) => {
    compositor.renderSync(t);
    octx.clearRect(0, 0, W, H);
    octx.drawImage(compositor.view, 0, 0);
    const { data } = octx.getImageData(0, 0, W, H);
    return { firstBright: brightAround(data, W, cx(first), y), lastBright: brightAround(data, W, cx(last), y) };
  };

  const atStart = sample(0); // everything faded in from above
  const midway = sample(0.35); // first glyph landed (~0.35 in), last (starts 0.6s) not
  const settled = sample(1.3); // last glyph starts 0.6s, done by 1.0s

  const hiddenAtStart = !atStart.firstBright && !atStart.lastBright;
  const staggered = midway.firstBright && !midway.lastBright;
  const allVisible = settled.firstBright && settled.lastBright;

  (window as unknown as { __TEXT_ANIM_TEST__: unknown }).__TEXT_ANIM_TEST__ = {
    ok: hiddenAtStart && staggered && allVisible,
    parts: parts.length,
    hiddenAtStart,
    staggered,
    allVisible,
    atStart,
    midway,
    settled,
  };
}

run().catch((err) => {
  (window as unknown as { __TEXT_ANIM_TEST__: unknown }).__TEXT_ANIM_TEST__ = { ok: false, error: String(err) };
});
