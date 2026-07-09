/**
 * The six scenes of the Valentine's Day Sale reel, each a self-contained
 * `GroupClip` on the content track (hard cuts, no cross-fades — matching the
 * source). Children live in the group's **local** time (`0 … sceneDur`), so
 * entrance keyframes read as "0.2s in", not absolute timeline seconds.
 *
 * Layering is insertion order within a scene: backdrops → arch photos →
 * headlines. Recreated motifs: the echoed after-image headlines, arced words,
 * hollow/outlined SUPER, arch-cropped photos, and the dot grids.
 */
import { GroupClip, type ImageSource } from '@sequio/engine';
import {
  CRIMSON,
  DISPLAY,
  H,
  PINK,
  ROSE,
  type Scene,
  SCRIPT,
  W,
  WHITE,
} from './theme';
import { archPhoto, arcLabel, circle, dotGrid, echoStack, fadeIn, label, rect, slideIn } from './kit';

/** A loaded (or failed → null) network photo. */
export interface Media {
  source: ImageSource | null;
  meta: { width: number; height: number } | null;
}
export type MediaSet = Record<string, Media>;

/** Wrap a scene's clips in a group spanning `[scene.start, scene.end]`. */
function sceneGroup(scene: Scene, build: (g: GroupClip, dur: number) => void): GroupClip {
  const g = new GroupClip();
  g.start = scene.start;
  g.end = scene.end;
  g.transform.anchor.setStatic([0, 0]);
  g.transform.position.setStatic([0, 0]);
  build(g, scene.end - scene.start);
  return g;
}

/** Add a child spanning the whole scene and return it (for further tweaks). */
function full<T extends { start: number; end: number }>(g: GroupClip, clip: T, dur: number): T {
  clip.start = 0;
  clip.end = dur;
  g.add(clip as never);
  return clip;
}

// ── Scene 1 — VALENTINE'S DAY · Sale · love is in the air ─────────────────────
export function scene1(scene: Scene): GroupClip {
  return sceneGroup(scene, (g, dur) => {
    // A crimson arch peeking from the top-right corner.
    full(g, circle(W - 20, -70, 470, CRIMSON), dur);

    // The echoed headline — four VALENTINE'S DAY, each fainter, sliding up in.
    const stack = full(
      g,
      echoStack("VALENTINE'S DAY", {
        x: 56,
        y: 150,
        size: 122,
        lineGap: 150,
        count: 4,
        spacing: 1,
      }),
      dur,
    );
    slideIn(stack, [0, 70], 0.0, 0.7);
    fadeIn(stack, 0.0, 0.5);

    // The cursive "Sale", pop-scaling in over the stack.
    const sale = full(g, label('Sale', { x: W / 2 - 30, y: 1030, fontFamily: SCRIPT, fontSize: 300, fill: CRIMSON }), dur);
    sale.transform.scale.setKeyframes([
      { time: 0.15, value: [0.7, 0.7] },
      { time: 0.7, value: [1, 1] },
    ]);
    fadeIn(sale, 0.15, 0.4);

    // "LOVE IS IN THE AIR!" with a drawn-in underline, bottom-centred.
    const tag = full(
      g,
      label('LOVE IS IN THE AIR!', { x: W / 2, y: 1480, fontSize: 46, fill: CRIMSON, fontWeight: '600', letterSpacing: 6 }),
      dur,
    );
    fadeIn(tag, 0.5, 0.4);
    const rule = full(g, rect(W / 2, 1530, 470, 5, { fill: CRIMSON, anchor: [0.5, 0.5] }), dur);
    rule.transform.scale.setKeyframes([
      { time: 0.6, value: [0, 1] },
      { time: 1.1, value: [1, 1] },
    ]);
  });
}

// ── Scene 2 — CASUAL LOOK ─────────────────────────────────────────────────────
export function scene2(scene: Scene, m: MediaSet): GroupClip {
  return sceneGroup(scene, (g, dur) => {
    const p = m.casual;
    // Arch-cropped photo filling the lower-right; rounded top.
    const photo = full(g, archPhoto(p.source, p.meta, { x: 250, y: 470, w: 830, h: 1520, radius: 415 }), dur);
    photo.transform.scale.setKeyframes([
      { time: 0, value: [1.06, 1.06] },
      { time: dur, value: [1, 1] },
    ]);

    // Crimson disc top-left + dusty-rose blob bottom-left + dot grid top-right.
    full(g, circle(70, 70, 440, CRIMSON), dur);
    full(g, circle(30, H - 20, 320, ROSE), dur);
    const dots = full(g, dotGrid(W - 150, 150, 3, 3), dur);
    fadeIn(dots, 0.2, 0.3);

    // "CASUAL LOOK" arced up the diagonal.
    const arc = full(
      g,
      arcLabel('CASUAL LOOK', {
        x: 430,
        y: 700,
        fontSize: 96,
        fill: CRIMSON,
        fontWeight: '700',
        letterSpacing: 6,
        radius: 1100,
        dir: -1,
        rotation: -24 * (Math.PI / 180),
        reveal: { duration: 0.4, stagger: 0.045 },
      }),
      dur,
    );
    arc.start = 0;
  });
}

// ── Scene 3 — COMFORTABLE ─────────────────────────────────────────────────────
export function scene3(scene: Scene, m: MediaSet): GroupClip {
  return sceneGroup(scene, (g, dur) => {
    const p = m.comfortable;
    // Photo at the top, arch curving along the bottom edge.
    const photo = full(g, archPhoto(p.source, p.meta, { x: 120, y: -220, w: 840, h: 1500, radius: 420 }), dur);
    photo.transform.scale.setKeyframes([
      { time: 0, value: [1.06, 1.06] },
      { time: dur, value: [1, 1] },
    ]);

    full(g, circle(W - 30, H - 30, 420, CRIMSON), dur);
    full(g, circle(70, H - 90, 300, ROSE), dur);
    const dots = full(g, dotGrid(W - 150, 150, 3, 3), dur);
    fadeIn(dots, 0.2, 0.3);

    // "COMFORTABLE" arced as a smile along the lower third.
    full(
      g,
      arcLabel('COMFORTABLE', {
        x: W / 2,
        y: 1520,
        fontSize: 104,
        fill: CRIMSON,
        fontWeight: '700',
        letterSpacing: 8,
        radius: 900,
        dir: -1,
        reveal: { duration: 0.4, stagger: 0.045 },
      }),
      dur,
    );
  });
}

// ── Scene 4 — SUPER / PROMO (quad split) ──────────────────────────────────────
export function scene4(scene: Scene, m: MediaSet): GroupClip {
  return sceneGroup(scene, (g, dur) => {
    const mid = 980;
    // Top-left & bottom-right photos.
    full(g, archPhoto(m.superLook.source, m.superLook.meta, { x: 0, y: 0, w: 600, h: mid, radius: 130 }), dur);
    full(g, archPhoto(m.promo.source, m.promo.meta, { x: 560, y: mid, w: 520, h: H - mid, radius: 130 }), dur);

    // Crimson panel bottom-left with the PROMO echo (white).
    full(g, rect(0, mid, 600, H - mid, { fill: CRIMSON, radius: 150 }), dur);
    const promo = full(
      g,
      echoStack('PROMO', { x: 44, y: mid + 90, size: 150, lineGap: 205, count: 4, fill: WHITE, spacing: 1, falloff: 0.7 }),
      dur,
    );
    slideIn(promo, [-60, 0], 0.05, 0.5);

    // Top-right SUPER echo — hollow / outlined.
    const superStack = full(
      g,
      echoStack('SUPER', {
        x: 610,
        y: 70,
        size: 150,
        lineGap: 175,
        count: 4,
        fill: PINK,
        stroke: { color: CRIMSON, width: 4 },
        spacing: 2,
        falloff: 0.78,
      }),
      dur,
    );
    slideIn(superStack, [60, 0], 0.05, 0.5);
  });
}

// ── Scene 5 — DISCOUNT ────────────────────────────────────────────────────────
export function scene5(scene: Scene, m: MediaSet): GroupClip {
  return sceneGroup(scene, (g, dur) => {
    const p = m.discount;
    // A tall arch photo, growing in.
    const photo = full(g, archPhoto(p.source, p.meta, { x: 170, y: -60, w: 760, h: 1500, radius: 380 }), dur);
    photo.transform.anchor.setStatic([0.5, 0.5]);
    photo.transform.position.setStatic([170 + 380, -60 + 750]);
    photo.transform.scale.setKeyframes([
      { time: 0, value: [0.9, 0.9] },
      { time: 0.6, value: [1, 1] },
    ]);

    // Crimson strip down the left edge.
    full(g, rect(0, 720, 300, 760, { fill: CRIMSON, radius: 30 }), dur);

    // Huge DISCOUNT, split across two lines at the edges.
    const disco = full(g, label('DISCO', { x: 46, y: 250, fontSize: 210, fill: CRIMSON, fontWeight: '700', anchor: [0, 0.5] }), dur);
    slideIn(disco, [0, -60], 0.0, 0.5);
    const unt = full(g, label('UNT', { x: 46, y: H - 260, fontSize: 210, fill: CRIMSON, fontWeight: '700', anchor: [0, 0.5] }), dur);
    slideIn(unt, [0, 60], 0.0, 0.5);

    // "50% OFF" tag, top-right.
    const off = full(g, label('50% OFF', { x: W - 46, y: 130, fontSize: 74, fill: CRIMSON, fontWeight: '700', anchor: [1, 0.5], letterSpacing: 1 }), dur);
    fadeIn(off, 0.2, 0.3);
  });
}

// ── Scene 6 — 50% OFF · MAKE IT YOURS · BRANDNAME ─────────────────────────────
export function scene6(scene: Scene, m: MediaSet): GroupClip {
  return sceneGroup(scene, (g, dur) => {
    const p = m.discount;
    full(g, archPhoto(p.source, p.meta, { x: 170, y: -60, w: 760, h: 1500, radius: 380 }), dur);

    // "50% OFF" echo scrolling up the right side.
    const off = full(
      g,
      echoStack('50% OFF', { x: W - 360, y: 60, size: 104, lineGap: 150, count: 7, fill: CRIMSON, spacing: 1, weight: '700', falloff: 0.82 }),
      dur,
    );
    slideIn(off, [0, 140], 0.0, 0.9);

    // Crimson BRANDNAME pill, top-right.
    full(g, rect(W - 620, -80, 700, 200, { fill: CRIMSON, radius: 100 }), dur);
    full(g, label('BRANDNAME', { x: W - 260, y: 58, fontSize: 56, fill: WHITE, fontWeight: '700', letterSpacing: 3, anchor: [0.5, 0.5] }), dur);

    // "MAKE IT YOURS" italic, bottom-left, over a dot grid.
    const cta = full(
      g,
      label('MAKE IT YOURS', { x: 56, y: H - 300, fontSize: 96, fill: CRIMSON, fontWeight: '700', fontStyle: 'italic', letterSpacing: 1, anchor: [0, 0.5] }),
      dur,
    );
    slideIn(cta, [-70, 0], 0.15, 0.5);
    fadeIn(cta, 0.15, 0.4);
    full(g, dotGrid(60, H - 210, 6, 2, { gap: 34, dot: 14 }), dur);
  });
}
