/**
 * The demo gallery's data. Each demo is a small multi-file program in the exact
 * `defineComposition(builder)` style Code Mode and the CLI run — its cover
 * renders with sequio itself and the same source drops straight into Code Mode
 * when the card is clicked.
 *
 * Most demos are **self-contained** (shapes / text / effects / GSAP — no
 * external media) so their covers render reliably offline. The last two show the
 * other half of the engine: pulling a still **image** and a **video** straight
 * off the network into an `ImageSource` / `VideoSource` and compositing them —
 * their covers fetch + decode real media (CORS-enabled hosts) in your browser.
 *
 * `gsap` is available to these programs because the website injects it as a
 * runtime external (see code-mode.ts), mirroring how the `sequio` CLI ships it.
 */
export interface Demo {
  id: string;
  title: string;
  description: string;
  tags: string[];
  entry: string;
  files: Record<string, string>;
  /** A representative time (s) to seed the cover's first frame. */
  poster: number;
}

// ── 1. Hello, sequio — sliding shapes + a GSAP-driven title ────────────────
const hello: Demo = {
  id: 'hello',
  title: 'Hello, Sequio',
  description: 'Two shapes cross the frame while a GSAP timeline drops the title in — the canonical first composition.',
  tags: ['shapes', 'gsap', 'keyframes'],
  entry: '/index.ts',
  poster: 1.2,
  files: {
    '/index.ts': `import { Compositor, ShapeClip, TextClip, VisualTrack, gsapClipAnimator } from '@sequio/engine';
import { defineComposition } from '@sequio/runtime';
import gsap from 'gsap';
import { W, H, DURATION, ball } from './scene';

// The builder's default export becomes the Composer. Edit any file and press Run.
export default defineComposition(async () => {
  const compositor = new Compositor({ width: W, height: H, fps: 30, background: 0x0b0b0e });
  await compositor.init();

  const bg = new VisualTrack();
  const backdrop = new ShapeClip({ kind: 'rect', width: W, height: H, fill: 0x0f172a });
  backdrop.start = 0;
  backdrop.end = DURATION;
  backdrop.transform.anchor.setStatic([0, 0]);
  backdrop.transform.position.setStatic([0, 0]);
  bg.add(backdrop);
  compositor.addTrack(bg);

  const balls = new VisualTrack();
  balls.zIndex = 1;
  balls.add(ball(0x38bdf8, 210));
  balls.add(ball(0xf472b6, 270));
  compositor.addTrack(balls);

  const text = new VisualTrack();
  text.zIndex = 2;
  const title = new TextClip({ text: 'Sequio', fontFamily: 'sans-serif', fontSize: 64, fill: 0xffffff });
  title.start = 0;
  title.end = DURATION;
  title.transform.anchor.setStatic([0.5, 0.5]);
  title.transform.position.setStatic([W / 2, 96]);
  // Drive the entrance with a real (paused, seeked) GSAP timeline. Deterministic:
  // render(t) always yields the same frame, so preview and export match.
  title.animator = gsapClipAnimator(gsap, (tl, o) => {
    tl.from(o, { y: -70, alpha: 0, duration: 0.8, ease: 'back.out(1.7)' });
  });
  text.add(title);
  compositor.addTrack(text);

  return { compositor, duration: DURATION };
});
`,
    '/scene.ts': `import { ShapeClip, easeInOutCubic } from '@sequio/engine';

export const W = 640;
export const H = 360;
export const DURATION = 4;

// A circle that slides left → right across the whole timeline (keyframed).
export function ball(fill: number, y: number): ShapeClip {
  const c = new ShapeClip({ kind: 'ellipse', width: 64, height: 64, fill });
  c.start = 0;
  c.end = DURATION;
  c.transform.anchor.setStatic([0.5, 0.5]);
  c.transform.position.setKeyframes([
    { time: 0, value: [80, y] },
    { time: DURATION, value: [W - 80, y], easing: easeInOutCubic },
  ]);
  return c;
}
`,
  },
};

// ── 2. Easing lab — the same move under different curves ───────────────────
const easing: Demo = {
  id: 'easing',
  title: 'Easing lab',
  description: 'Four dots race the same distance under linear, quad, cubic and back easings — keyframes are pure functions of t.',
  tags: ['keyframes', 'easing', 'shapes'],
  entry: '/index.ts',
  poster: 1.1,
  files: {
    '/index.ts': `import { Compositor, ShapeClip, TextClip, VisualTrack } from '@sequio/engine';
import { defineComposition } from '@sequio/runtime';
import { easeInOutQuad, easeInOutCubic, easeOutCubic, linear } from '@sequio/engine';

const W = 640, H = 360, DURATION = 3.2;
const CURVES = [
  { name: 'linear', fill: 0x64748b, easing: linear },
  { name: 'inOutQuad', fill: 0x38bdf8, easing: easeInOutQuad },
  { name: 'inOutCubic', fill: 0xa78bfa, easing: easeInOutCubic },
  { name: 'outCubic', fill: 0xf472b6, easing: easeOutCubic },
];

export default defineComposition(async () => {
  const compositor = new Compositor({ width: W, height: H, fps: 30, background: 0x0b0b0e });
  await compositor.init();

  const track = new VisualTrack();
  CURVES.forEach((curve, i) => {
    const y = 70 + i * 68;
    const dot = new ShapeClip({ kind: 'ellipse', width: 40, height: 40, fill: curve.fill });
    dot.start = 0;
    dot.end = DURATION;
    dot.transform.anchor.setStatic([0.5, 0.5]);
    dot.transform.position.setKeyframes([
      { time: 0.3, value: [80, y] },
      { time: DURATION - 0.3, value: [W - 80, y], easing: curve.easing },
    ]);
    track.add(dot);

    const label = new TextClip({ text: curve.name, fontFamily: 'monospace', fontSize: 18, fill: 0x9aa4b2 });
    label.start = 0;
    label.end = DURATION;
    label.transform.anchor.setStatic([0, 0.5]);
    label.transform.position.setStatic([24, y]);
    track.add(label);
  });
  compositor.addTrack(track);

  return { compositor, duration: DURATION };
});
`,
  },
};

// ── 3. Kinetic type — per-character drop-in ────────────────────────────────
const type: Demo = {
  id: 'type',
  title: 'Kinetic type',
  description: 'A TextClip split into characters and revealed with StaggerTextAnimator — each glyph drops and fades in, staggered.',
  tags: ['text', 'animation', 'stagger'],
  entry: '/index.ts',
  poster: 1.3,
  files: {
    '/index.ts': `import { Compositor, TextClip, VisualTrack, StaggerTextAnimator, easeOutCubic } from '@sequio/engine';
import { defineComposition } from '@sequio/runtime';

const W = 640, H = 360, DURATION = 3.5;

export default defineComposition(async () => {
  const compositor = new Compositor({ width: W, height: H, fps: 30, background: 0x0b0b0e });
  await compositor.init();

  const track = new VisualTrack();

  const heading = new TextClip({ text: 'SEQUIO', fontFamily: 'sans-serif', fontSize: 84, fill: 0xffffff });
  heading.start = 0;
  heading.end = DURATION;
  heading.split = 'char';                       // split into per-character parts
  heading.transform.anchor.setStatic([0.5, 0.5]);
  heading.transform.position.setStatic([W / 2, H / 2 - 18]);
  // Drop each character in from 80px above, faded, staggered 0.09s apart.
  heading.textAnimator = new StaggerTextAnimator({
    from: { y: -80, alpha: 0 },
    duration: 0.5,
    stagger: 0.09,
    easing: easeOutCubic,
  });
  track.add(heading);

  const sub = new TextClip({ text: 'programmable timelines', fontFamily: 'sans-serif', fontSize: 22, fill: 0x38bdf8 });
  sub.start = 0;
  sub.end = DURATION;
  sub.split = 'word';
  sub.transform.anchor.setStatic([0.5, 0.5]);
  sub.transform.position.setStatic([W / 2, H / 2 + 46]);
  sub.textAnimator = new StaggerTextAnimator({
    from: { y: 24, alpha: 0 },
    duration: 0.5,
    stagger: 0.14,
    delay: 0.7,
    easing: easeOutCubic,
  });
  track.add(sub);

  compositor.addTrack(track);
  return { compositor, duration: DURATION };
});
`,
  },
};

// ── 4. Filter stack — animated color + blur effects ────────────────────────
const effects: Demo = {
  id: 'effects',
  title: 'Filter stack',
  description: 'Clip-level ColorEffect and BlurEffect, their parameters keyframed — the same filter core preview and export share.',
  tags: ['effects', 'color', 'blur'],
  entry: '/index.ts',
  poster: 1.5,
  files: {
    '/index.ts': `import { Compositor, ShapeClip, TextClip, VisualTrack, ColorEffect, BlurEffect } from '@sequio/engine';
import { defineComposition } from '@sequio/runtime';
import { easeInOutQuad } from '@sequio/engine';

const W = 640, H = 360, DURATION = 4;

export default defineComposition(async () => {
  const compositor = new Compositor({ width: W, height: H, fps: 30, background: 0x0b0b0e });
  await compositor.init();

  const track = new VisualTrack();

  // A disc whose blur strength pulses 0 → 24 → 0.
  const disc = new ShapeClip({ kind: 'ellipse', width: 150, height: 150, fill: 0x38bdf8 });
  disc.start = 0;
  disc.end = DURATION;
  disc.transform.position.setStatic([W * 0.32, H / 2]);
  const blur = new BlurEffect();
  blur.strength.setKeyframes([
    { time: 0, value: 0 },
    { time: DURATION / 2, value: 24, easing: easeInOutQuad },
    { time: DURATION, value: 0, easing: easeInOutQuad },
  ]);
  disc.effects.push(blur);
  track.add(disc);

  // A rounded square whose brightness + saturation swing over time.
  const card = new ShapeClip({ kind: 'rect', width: 170, height: 170, fill: 0xf472b6, radius: 28 });
  card.start = 0;
  card.end = DURATION;
  card.transform.position.setStatic([W * 0.68, H / 2]);
  card.transform.rotation.setKeyframes([
    { time: 0, value: -0.15 },
    { time: DURATION, value: 0.15, easing: easeInOutQuad },
  ]);
  const color = new ColorEffect();
  color.brightness.setKeyframes([
    { time: 0, value: 0.4 },
    { time: DURATION / 2, value: 1.4, easing: easeInOutQuad },
    { time: DURATION, value: 0.4, easing: easeInOutQuad },
  ]);
  color.saturation.setKeyframes([
    { time: 0, value: 0.2 },
    { time: DURATION / 2, value: 1.8, easing: easeInOutQuad },
    { time: DURATION, value: 0.2, easing: easeInOutQuad },
  ]);
  card.effects.push(color);
  track.add(card);

  const caption = new TextClip({ text: 'ColorEffect · BlurEffect', fontFamily: 'monospace', fontSize: 18, fill: 0x9aa4b2 });
  caption.start = 0;
  caption.end = DURATION;
  caption.transform.position.setStatic([W / 2, H - 34]);
  track.add(caption);

  compositor.addTrack(track);
  return { compositor, duration: DURATION };
});
`,
  },
};

// ── 5. GSAP build — a logo assembled by a GSAP timeline ────────────────────
const gsapBuild: Demo = {
  id: 'gsap-build',
  title: 'GSAP build',
  description: 'Four tiles fly in on a staggered GSAP timeline with a back ease — the engine seeks the paused timeline per frame.',
  tags: ['gsap', 'stagger', 'transform'],
  entry: '/index.ts',
  poster: 1.0,
  files: {
    '/index.ts': `import { Compositor, ShapeClip, VisualTrack, gsapClipAnimator } from '@sequio/engine';
import { defineComposition } from '@sequio/runtime';
import gsap from 'gsap';

const W = 640, H = 360, DURATION = 3.6;
const TILES = [
  { fill: 0x38bdf8, dx: -1, dy: -1 },
  { fill: 0xa78bfa, dx: 1, dy: -1 },
  { fill: 0xf472b6, dx: -1, dy: 1 },
  { fill: 0xfbbf24, dx: 1, dy: 1 },
];

export default defineComposition(async () => {
  const compositor = new Compositor({ width: W, height: H, fps: 30, background: 0x0b0b0e });
  await compositor.init();

  const track = new VisualTrack();
  TILES.forEach((tile, i) => {
    const size = 108;
    const gap = 8;
    const cx = W / 2 + tile.dx * (size + gap) / 2;
    const cy = H / 2 + tile.dy * (size + gap) / 2;
    const box = new ShapeClip({ kind: 'rect', width: size, height: size, fill: tile.fill, radius: 16 });
    box.start = 0;
    box.end = DURATION;
    box.transform.anchor.setStatic([0.5, 0.5]);
    box.transform.position.setStatic([cx, cy]);
    // Each tile flies in from its outer corner, spinning + scaling up, staggered.
    box.animator = gsapClipAnimator(gsap, (tl, o) => {
      tl.from(o, {
        x: tile.dx * 260,
        y: tile.dy * 200,
        rotation: tile.dx * 1.2,   // radians — the binding wants raw radians
        scaleX: 0,
        scaleY: 0,
        alpha: 0,
        duration: 0.9,
        delay: i * 0.16,
        ease: 'back.out(1.6)',
      });
    });
    track.add(box);
  });
  compositor.addTrack(track);

  return { compositor, duration: DURATION };
});
`,
  },
};

// ── 6. Crossfade — two full-frame layers, blended over time ────────────────
const layers: Demo = {
  id: 'layers',
  title: 'Layered crossfade',
  description: 'Two full-frame color layers crossfade via opacity keyframes while an additive glow rides on top — multi-track compositing.',
  tags: ['multitrack', 'opacity', 'blend'],
  entry: '/index.ts',
  poster: 1.9,
  files: {
    '/index.ts': `import { Compositor, ShapeClip, TextClip, VisualTrack } from '@sequio/engine';
import { defineComposition } from '@sequio/runtime';
import { easeInOutQuad } from '@sequio/engine';

const W = 640, H = 360, DURATION = 4;

function fullFrame(fill: number): ShapeClip {
  const s = new ShapeClip({ kind: 'rect', width: W, height: H, fill });
  s.start = 0;
  s.end = DURATION;
  s.transform.anchor.setStatic([0, 0]);
  s.transform.position.setStatic([0, 0]);
  return s;
}

export default defineComposition(async () => {
  const compositor = new Compositor({ width: W, height: H, fps: 30, background: 0x000000 });
  await compositor.init();

  // Layer A fades out as layer B fades in — a crossfade built from opacity.
  const a = fullFrame(0x1e3a8a);
  const b = fullFrame(0x831843);
  b.opacity.setKeyframes([
    { time: 0, value: 0 },
    { time: DURATION, value: 1, easing: easeInOutQuad },
  ]);
  const base = new VisualTrack();
  base.add(a);
  base.add(b);
  compositor.addTrack(base);

  // An additive glowing disc that sweeps across, brightening whatever it crosses.
  const glow = new ShapeClip({ kind: 'ellipse', width: 240, height: 240, fill: 0x38bdf8 });
  glow.start = 0;
  glow.end = DURATION;
  glow.blendMode = 'add';
  glow.opacity.setStatic(0.5);
  glow.transform.position.setKeyframes([
    { time: 0, value: [-40, H / 2] },
    { time: DURATION, value: [W + 40, H / 2], easing: easeInOutQuad },
  ]);
  const fx = new VisualTrack();
  fx.zIndex = 1;
  fx.add(glow);
  compositor.addTrack(fx);

  const title = new TextClip({ text: 'compositing', fontFamily: 'sans-serif', fontSize: 40, fill: 0xffffff });
  title.start = 0;
  title.end = DURATION;
  title.transform.position.setStatic([W / 2, H / 2]);
  const top = new VisualTrack();
  top.zIndex = 2;
  top.add(title);
  compositor.addTrack(top);

  return { compositor, duration: DURATION };
});
`,
  },
};

// ── 7. Network image — a photo off the wire, Ken Burns + caption ───────────
const netImage: Demo = {
  id: 'net-image',
  title: 'Network image',
  description: 'A still photo fetched straight off the network into an ImageSource, laid out object-fit: cover and given a slow Ken Burns push while a caption fades in.',
  tags: ['image', 'network', 'media'],
  entry: '/index.ts',
  poster: 2.0,
  files: {
    '/index.ts': `import { Compositor, ImageClip, ImageSource, ShapeClip, TextClip, VisualTrack, easeInOutQuad, easeOutCubic } from '@sequio/engine';
import { defineComposition } from '@sequio/runtime';

const W = 640, H = 360, DURATION = 5;

// A CORS-enabled still image — swap in any URL your host allows.
const PHOTO = 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1280&q=70';

export default defineComposition(async () => {
  const compositor = new Compositor({ width: W, height: H, fps: 30, background: 0x000000 });
  await compositor.init();

  // Fetch + decode the image off the network into a single texture. load()
  // resolves the intrinsic size, which we use to lay it out object-fit: cover.
  const source = new ImageSource({ src: PHOTO });
  const meta = await source.load();
  const cover = Math.max(W / meta.width, H / meta.height);

  const photo = new ImageClip(source);
  photo.start = 0;
  photo.end = DURATION;
  photo.transform.anchor.setStatic([0.5, 0.5]);
  photo.transform.position.setStatic([W / 2, H / 2]);
  // Ken Burns: a gentle zoom-in over the whole clip. render(t) stays pure, so
  // the push is identical in preview and export.
  photo.transform.scale.setKeyframes([
    { time: 0, value: [cover, cover] },
    { time: DURATION, value: [cover * 1.14, cover * 1.14], easing: easeInOutQuad },
  ]);
  const media = new VisualTrack();
  media.add(photo);
  compositor.addTrack(media);

  // A translucent lower bar so the caption stays legible over any photo.
  const scrim = new ShapeClip({ kind: 'rect', width: W, height: 96, fill: 0x000000 });
  scrim.start = 0;
  scrim.end = DURATION;
  scrim.opacity.setStatic(0.42);
  scrim.transform.anchor.setStatic([0, 1]);
  scrim.transform.position.setStatic([0, H]);
  const overlay = new VisualTrack();
  overlay.zIndex = 1;
  overlay.add(scrim);

  const caption = new TextClip({ text: 'shot off the network', fontFamily: 'sans-serif', fontSize: 30, fill: 0xffffff });
  caption.start = 0;
  caption.end = DURATION;
  caption.transform.anchor.setStatic([0, 1]);
  caption.transform.position.setStatic([28, H - 34]);
  caption.opacity.setKeyframes([
    { time: 0.2, value: 0 },
    { time: 1.1, value: 1, easing: easeOutCubic },
  ]);
  overlay.add(caption);
  compositor.addTrack(overlay);

  return { compositor, duration: DURATION };
});
`,
  },
};

// ── 8. Network video — a clip decoded off the wire, graded + framed ────────
const netVideo: Demo = {
  id: 'net-video',
  title: 'Network video',
  description: 'A video decoded straight off the network via VideoSource (WebCodecs + Mediabunny), composited object-fit: cover under a title lower-third.',
  tags: ['video', 'network', 'media'],
  entry: '/index.ts',
  poster: 2.5,
  files: {
    '/index.ts': `import { Compositor, VideoClip, VideoSource, ShapeClip, TextClip, VisualTrack, easeOutCubic } from '@sequio/engine';
import { defineComposition } from '@sequio/runtime';

const W = 640, H = 360;

// A CORS-enabled MP4. VideoSource takes a URL, buffer, or Blob/File — the URL
// path streams it with range requests, so only the frames we touch get fetched.
const VIDEO = 'https://mdn.github.io/shared-assets/videos/flower.mp4';

export default defineComposition(async () => {
  const compositor = new Compositor({ width: W, height: H, fps: 30, background: 0x000000 });
  await compositor.init();

  // load() opens the container and reports duration + intrinsic size. Decoding
  // itself stays lazy: prepare(t) pulls the frame at t (contract #1).
  const source = new VideoSource({ src: VIDEO });
  const meta = await source.load();
  const DURATION = Math.min(meta.duration, 6);

  const clip = new VideoClip(source);
  clip.start = 0;
  clip.end = DURATION;
  // object-fit: cover — fill the frame, keep aspect, centre the overflow.
  const scale = Math.max(W / meta.width, H / meta.height);
  clip.transform.anchor.setStatic([0.5, 0.5]);
  clip.transform.scale.setStatic([scale, scale]);
  clip.transform.position.setStatic([W / 2, H / 2]);
  const media = new VisualTrack();
  media.add(clip);
  compositor.addTrack(media);

  // Lower-third: a bar that slides in, carrying the title.
  const bar = new ShapeClip({ kind: 'rect', width: 300, height: 56, fill: 0x0b0b0e });
  bar.start = 0;
  bar.end = DURATION;
  bar.opacity.setStatic(0.72);
  bar.transform.anchor.setStatic([0, 0.5]);
  bar.transform.position.setKeyframes([
    { time: 0, value: [-300, H - 56] },
    { time: 0.8, value: [28, H - 56], easing: easeOutCubic },
  ]);
  const title = new TextClip({ text: 'streamed & decoded', fontFamily: 'sans-serif', fontSize: 24, fill: 0xffffff });
  title.start = 0;
  title.end = DURATION;
  title.transform.anchor.setStatic([0, 0.5]);
  title.transform.position.setKeyframes([
    { time: 0, value: [-260, H - 56] },
    { time: 0.9, value: [48, H - 56], easing: easeOutCubic },
  ]);
  const overlay = new VisualTrack();
  overlay.zIndex = 1;
  overlay.add(bar);
  overlay.add(title);
  compositor.addTrack(overlay);

  return { compositor, duration: DURATION };
});
`,
  },
};

export const DEMOS: Demo[] = [hello, easing, type, effects, gsapBuild, layers, netImage, netVideo];

export function getDemo(id: string | null | undefined): Demo | undefined {
  return DEMOS.find((d) => d.id === id);
}
