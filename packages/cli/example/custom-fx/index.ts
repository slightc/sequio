import {
  Compositor,
  GroupClip,
  ImageClip,
  ImageSource,
  ShapeClip,
  TextClip,
  VisualClip,
  VisualTrack,
  easeInCubic,
  easeInOutCubic,
  easeOutCubic,
  fonts,
} from '@sequio/engine';
import { defineComposition } from '@sequio/runtime';
import { DropInTextAnimator, EasedCrossfade, FocusPull, OrbitAnimator, PopEffect } from './fx';

// A CLI showcase that demonstrates the three "bring your own" seams (see ./fx.ts)
// as four back-to-back chapters, each labelled with what it shows:
//   1 · a custom EFFECT      — FocusPull + PopEffect on a shape emblem
//   2 · a custom TRANSITION  — EasedCrossfade between two images
//   3 · a custom ANIMATION   — an OrbitAnimator driving a shape
//   4 · a text ANIMATION     — a per-character DropInTextAnimator
//
//   sequio preview example/custom-fx/index.ts --watch
//   sequio render  example/custom-fx/index.ts --out custom-fx.mp4
// The transition chapter pulls two images over the network, so preview/render
// need connectivity (they degrade to nothing if a fetch fails — like media-network).
const W = 1280;
const H = 720;
const FPS = 30;
const CX = W / 2;
const CY = H / 2;
const FONT = "'Poppins', 'Inter', system-ui, sans-serif";

interface Chapter {
  start: number;
  end: number;
  no: string;
  title: string;
  note: string;
}
const CH: Chapter[] = [
  { start: 0.0, end: 3.6, no: '01', title: 'CUSTOM EFFECT', note: 'FocusPull (BlurEffect) + PopEffect (ColorEffect) on a shape' },
  { start: 3.6, end: 7.6, no: '02', title: 'CUSTOM TRANSITION', note: 'EasedCrossfade (CrossfadeTransition) between two images' },
  { start: 7.6, end: 11.0, no: '03', title: 'CUSTOM ANIMATION', note: 'OrbitAnimator (a ClipAnimator) driving a shape' },
  { start: 11.0, end: 14.4, no: '04', title: 'TEXT ANIMATION', note: 'DropInTextAnimator (a TextAnimator), per character' },
];
const DURATION = CH[CH.length - 1].end;

// Two small, public, CORS-enabled sample images for the transition — swap freely.
const IMAGE_A = 'https://picsum.photos/id/1039/1280/720';
const IMAGE_B = 'https://picsum.photos/id/1043/1280/720';

/** Keyframe a clip's opacity to fade in at `s` and out by `e`. */
function fade(clip: VisualClip, s: number, e: number, peak = 1, fin = 0.3, fout = 0.3): void {
  clip.opacity.setKeyframes([
    { time: s, value: 0 },
    { time: s + fin, value: peak, easing: easeOutCubic },
    { time: e - fout, value: peak },
    { time: e, value: 0 },
  ]);
}

/** Lay a clip out like CSS `object-fit: cover` — fill the frame, keep aspect. */
function cover(clip: VisualClip, srcW: number, srcH: number): void {
  const scale = Math.max(W / srcW, H / srcH);
  clip.transform.anchor.setStatic([0, 0]);
  clip.transform.scale.setStatic([scale, scale]);
  clip.transform.position.setStatic([(W - srcW * scale) / 2, (H - srcH * scale) / 2]);
}

/** Section number + title (top) and the mechanism caption (bottom) for a chapter. */
function chrome(ch: Chapter): VisualClip[] {
  const head = new TextClip({ text: `${ch.no}  ·  ${ch.title}`, fontFamily: FONT, fontSize: 30, fontWeight: '800', fill: 0xffffff, align: 'center', letterSpacing: 2 });
  head.transform.anchor.setStatic([0.5, 0.5]);
  head.transform.position.setStatic([CX, 88]);

  const note = new TextClip({ text: ch.note, fontFamily: FONT, fontSize: 24, fontWeight: '600', fill: 0x9fb0c3, align: 'center' });
  note.transform.anchor.setStatic([0.5, 0.5]);
  note.transform.position.setStatic([CX, H - 78]);

  for (const c of [head, note]) {
    c.start = ch.start;
    c.end = ch.end;
    fade(c, ch.start, ch.end, 1, 0.35, 0.3);
  }
  return [head, note];
}

// ── 1 · a custom EFFECT — a shape emblem that pulls out of blur and pops ───────
function chapterEffect(ch: Chapter): VisualClip {
  const g = new GroupClip();
  g.start = ch.start;
  g.end = ch.end;
  g.transform.anchor.setStatic([0.5, 0.5]);
  g.transform.position.setStatic([CX, CY]);

  // A little emblem (all children in group-local space, centred on the origin):
  const parts: ShapeClip[] = [
    new ShapeClip({ kind: 'rect', width: 240, height: 240, radius: 46, fill: 0x7c5cff }),
    new ShapeClip({ kind: 'ellipse', width: 150, height: 150, fill: 0x0a0a12 }),
    new ShapeClip({ kind: 'ellipse', width: 92, height: 92, fill: 0x00e0c6 }),
    new ShapeClip({ kind: 'ellipse', width: 320, height: 320, fill: 'rgba(0,0,0,0)', stroke: { color: 0xff5c8a, width: 6 } }),
  ];
  parts.forEach((p) => {
    p.start = 0;
    p.end = ch.end - ch.start;
    // anchor [0.5,0.5] pivots on the shape's own centre, so position IS the centre —
    // put them all on the group origin so the emblem is concentric.
    p.transform.anchor.setStatic([0.5, 0.5]);
    p.transform.position.setStatic([0, 0]);
    g.add(p);
  });

  // The two custom effects on the whole group: blur → sharp, plus a colour pop.
  const pull = new FocusPull(30);
  pull.focus.setKeyframes([
    { time: ch.start, value: 1 },
    { time: ch.start + 0.9, value: 0, easing: easeOutCubic },
    { time: ch.end - 0.6, value: 0 },
    { time: ch.end, value: 1, easing: easeInCubic },
  ]);
  const pop = new PopEffect();
  pop.pop.setKeyframes([
    { time: ch.start, value: 0 },
    { time: ch.start + 0.5, value: 1, easing: easeOutCubic },
    { time: ch.start + 1.4, value: 0, easing: easeInOutCubic },
  ]);
  g.effects.push(pull, pop);
  fade(g, ch.start, ch.end, 1, 0.3, 0.3);
  return g;
}

// ── 2 · a custom TRANSITION — two images cross-dissolving ──────────────────────
async function chapterTransition(ch: Chapter): Promise<{ track: VisualTrack; clips: VisualClip[] }> {
  const mid = (ch.start + ch.end) / 2;
  const overlap = 1.1;

  const track = new VisualTrack();
  track.zIndex = 10;
  const built: ImageClip[] = [];
  const specs = [
    { url: IMAGE_A, start: ch.start, end: mid + overlap / 2 },
    { url: IMAGE_B, start: mid - overlap / 2, end: ch.end },
  ];
  for (const s of specs) {
    const src = new ImageSource({ src: s.url });
    const meta = await src.load();
    const clip = new ImageClip(src);
    clip.start = s.start;
    clip.end = s.end;
    cover(clip, meta.width, meta.height);
    track.add(clip);
    built.push(clip);
  }
  // Clean chapter edges (the EasedCrossfade owns the middle).
  fade(built[0], ch.start, built[0].end, 1, 0.3, 0.01);
  fade(built[1], built[1].start, ch.end, 1, 0.01, 0.3);
  track.addTransition(new EasedCrossfade(Math.round(overlap * FPS)).between(built[0], built[1]));
  return { track, clips: built };
}

// ── 3 · a custom ANIMATION — a shape orbiting via a ClipAnimator ───────────────
function chapterAnimation(ch: Chapter): VisualClip[] {
  const radius = 118;
  const guide = new ShapeClip({ kind: 'ellipse', width: radius * 2, height: radius * 2, fill: 'rgba(0,0,0,0)', stroke: { color: 0x2b3040, width: 2 } });
  guide.start = ch.start;
  guide.end = ch.end;
  guide.transform.anchor.setStatic([0.5, 0.5]);
  guide.transform.position.setStatic([CX, CY]);
  fade(guide, ch.start, ch.end, 1, 0.3, 0.3);

  const hub = new ShapeClip({ kind: 'ellipse', width: 16, height: 16, fill: 0x66707f });
  hub.start = ch.start;
  hub.end = ch.end;
  hub.transform.anchor.setStatic([0.5, 0.5]);
  hub.transform.position.setStatic([CX, CY]);
  fade(hub, ch.start, ch.end, 1, 0.3, 0.3);

  const mover = new ShapeClip({ kind: 'rect', width: 128, height: 128, radius: 30, fill: 0xffb020 });
  mover.start = ch.start;
  mover.end = ch.end;
  mover.transform.anchor.setStatic([0.5, 0.5]);
  mover.transform.position.setStatic([CX, CY]); // base position; the animator adds the orbit
  mover.animator = new OrbitAnimator(radius, 2.2);
  fade(mover, ch.start, ch.end, 1, 0.3, 0.3);

  return [guide, hub, mover];
}

// ── 4 · a text ANIMATION — per-character drop-in via a TextAnimator ────────────
function chapterText(ch: Chapter): VisualClip {
  const clip = new TextClip({ text: 'sequio', fontFamily: FONT, fontSize: 168, fontWeight: '800', fill: 0x7cf7ff, align: 'center' });
  clip.start = ch.start;
  clip.end = ch.end;
  clip.transform.anchor.setStatic([0.5, 0.5]);
  clip.transform.position.setStatic([CX, CY]);
  clip.split = 'char';
  clip.textAnimator = new DropInTextAnimator(0.08, 0.5, 80);
  // Only fade the block out at the end; the per-char animator handles the entrance.
  clip.opacity.setKeyframes([
    { time: ch.start, value: 1 },
    { time: ch.end - 0.35, value: 1 },
    { time: ch.end, value: 0 },
  ]);
  return clip;
}

export default defineComposition(async () => {
  const compositor = new Compositor({ width: W, height: H, fps: FPS, background: 0x0a0a12 });
  await compositor.init();

  void fonts.loadGoogleFont({ family: 'Poppins', weights: [600, 800] }).catch(() => {});
  await fonts.ready();

  // Constant backdrop so the chapters share one canvas.
  const bg = new VisualTrack();
  bg.zIndex = 0;
  const backdrop = new ShapeClip({ kind: 'rect', width: W, height: H, fill: 0x0a0a12 });
  backdrop.start = 0;
  backdrop.end = DURATION;
  backdrop.transform.anchor.setStatic([0, 0]);
  backdrop.transform.position.setStatic([0, 0]);
  bg.add(backdrop);
  compositor.addTrack(bg);

  // Chapter content (z10).
  const content = new VisualTrack();
  content.zIndex = 10;
  content.add(chapterEffect(CH[0]));
  for (const c of chapterAnimation(CH[2])) content.add(c);
  content.add(chapterText(CH[3]));
  compositor.addTrack(content);

  // Chapter 2 needs its own track (the transition blends its two image clips).
  const { track: transition } = await chapterTransition(CH[1]);
  compositor.addTrack(transition);

  // Section labels + captions on top (z20).
  const hud = new VisualTrack();
  hud.zIndex = 20;
  for (const ch of CH) for (const c of chrome(ch)) hud.add(c);
  compositor.addTrack(hud);

  return { compositor, duration: DURATION };
});
