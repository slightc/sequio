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
import {
  SETTLE,
  SMOOTH,
  archPhoto,
  arcLabel,
  circle,
  dotGrid,
  echoStack,
  fadeIn,
  kenBurns,
  label,
  rect,
  slideIn,
} from './kit';

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
    // A crimson arch peeking from the top-right corner, drifting down as it settles.
    const disc = full(g, circle(W - 20, -70, 470, CRIMSON), dur);
    disc.transform.position.setKeyframes([
      { time: 0, value: [W - 20, -140] },
      { time: 0.9, value: [W - 20, -70], easing: SMOOTH },
    ]);

    // The echoed headline — four VALENTINE'S DAY, each fainter, cascading up in.
    full(
      g,
      echoStack("VALENTINE'S DAY", {
        x: 56,
        y: 150,
        size: 122,
        lineGap: 150,
        count: 4,
        spacing: 1,
        enter: { from: [0, 46], stagger: 0.09, duration: 0.7 },
      }),
      dur,
    );

    // The cursive "Sale", overshoot-popping in over the stack.
    const sale = full(g, label('Sale', { x: W / 2 - 30, y: 1030, fontFamily: SCRIPT, fontSize: 300, fill: CRIMSON }), dur);
    sale.transform.scale.setKeyframes([
      { time: 0.25, value: [0.6, 0.6] },
      { time: 0.95, value: [1, 1], easing: SETTLE },
    ]);
    fadeIn(sale, 0.25, 0.35);

    // "LOVE IS IN THE AIR!" with a drawn-in underline, bottom-centred.
    const tag = full(
      g,
      label('LOVE IS IN THE AIR!', { x: W / 2, y: 1480, fontSize: 46, fill: CRIMSON, fontWeight: '600', letterSpacing: 6 }),
      dur,
    );
    fadeIn(tag, 0.6, 0.4);
    const rule = full(g, rect(W / 2, 1530, 470, 5, { fill: CRIMSON, anchor: [0.5, 0.5] }), dur);
    rule.transform.scale.setKeyframes([
      { time: 0.7, value: [0, 1] },
      { time: 1.3, value: [1, 1], easing: SMOOTH },
    ]);
  });
}

// ── Scene 2 — CASUAL LOOK ─────────────────────────────────────────────────────
export function scene2(scene: Scene, m: MediaSet): GroupClip {
  return sceneGroup(scene, (g, dur) => {
    const p = m.casual;
    // A contained arch (rounded top), lower-centre, with pink margins all round
    // so the headline has negative space to sit in. Slow Ken-Burns push.
    const IX = 260;
    const IW = 600;
    const photo = full(g, archPhoto(p.source, p.meta, { x: IX, y: 600, w: IW, h: 1320, radius: IW / 2 }), dur);
    kenBurns(photo, dur, 1.08, 1);
    fadeIn(photo, 0, 0.5);

    // Crimson disc top-left + dusty-rose blob bottom-left + dot grid top-right.
    full(g, circle(70, 70, 440, CRIMSON), dur);
    full(g, circle(30, H - 20, 320, ROSE), dur);
    const dots = full(g, dotGrid(W - 150, 150, 3, 3), dur);
    fadeIn(dots, 0.2, 0.4);

    // "CASUAL LOOK" arced as a dome (∩) in the pink ABOVE the photo, hugging its
    // rounded top — same curvature sense as the arch, clear of the image.
    full(
      g,
      arcLabel('CASUAL LOOK', {
        x: IX + IW / 2,
        y: 430,
        fontSize: 92,
        fill: CRIMSON,
        fontWeight: '700',
        letterSpacing: 6,
        radius: 620,
        dir: 1,
        reveal: { duration: 0.45, stagger: 0.05 },
      }),
      dur,
    );
  });
}

// ── Scene 3 — COMFORTABLE ─────────────────────────────────────────────────────
export function scene3(scene: Scene, m: MediaSet): GroupClip {
  return sceneGroup(scene, (g, dur) => {
    const p = m.comfortable;
    // A contained arch in the upper area (rounded bottom), pink margin below for
    // the headline.
    const IX = 260;
    const IW = 600;
    const IBOT = 1180; // rounded bottom edge sits here
    const photo = full(g, archPhoto(p.source, p.meta, { x: IX, y: IBOT - 1320, w: IW, h: 1320, radius: IW / 2 }), dur);
    kenBurns(photo, dur, 1.08, 1);
    fadeIn(photo, 0, 0.5);

    full(g, circle(W - 30, H - 30, 420, CRIMSON), dur);
    full(g, circle(70, H - 90, 300, ROSE), dur);
    const dots = full(g, dotGrid(W - 150, 150, 3, 3), dur);
    fadeIn(dots, 0.2, 0.4);

    // "COMFORTABLE" arced (∩) in the pink BELOW the photo, hugging its rounded
    // bottom from outside — concave sense following the arch, clear of the image.
    full(
      g,
      arcLabel('COMFORTABLE', {
        x: IX + IW / 2,
        y: IBOT + 210,
        fontSize: 96,
        fill: CRIMSON,
        fontWeight: '700',
        letterSpacing: 6,
        radius: 620,
        dir: 1,
        reveal: { duration: 0.45, stagger: 0.05 },
      }),
      dur,
    );
  });
}

// ── Scene 4 — SUPER / PROMO (quad split) ──────────────────────────────────────
export function scene4(scene: Scene, m: MediaSet): GroupClip {
  return sceneGroup(scene, (g, dur) => {
    const mid = 980;
    // Top-left & bottom-right photos, each on a slow Ken-Burns push.
    const pa = full(g, archPhoto(m.superLook.source, m.superLook.meta, { x: 0, y: 0, w: 600, h: mid, radius: 130 }), dur);
    const pb = full(g, archPhoto(m.promo.source, m.promo.meta, { x: 560, y: mid, w: 520, h: H - mid, radius: 130 }), dur);
    kenBurns(pa, dur, 1.08, 1);
    kenBurns(pb, dur, 1.08, 1);

    // Crimson panel bottom-left with the PROMO echo (white), cascading up.
    full(g, rect(0, mid, 600, H - mid, { fill: CRIMSON, radius: 150 }), dur);
    full(
      g,
      echoStack('PROMO', {
        x: 44,
        y: mid + 90,
        size: 150,
        lineGap: 205,
        count: 4,
        fill: WHITE,
        spacing: 1,
        falloff: 0.7,
        enter: { from: [-50, 0], stagger: 0.07, duration: 0.55 },
      }),
      dur,
    );

    // Top-right SUPER echo — hollow / outlined — cascading down from the right.
    full(
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
        enter: { from: [50, 0], stagger: 0.07, duration: 0.55 },
      }),
      dur,
    );
  });
}

// ── Scene 5 — DISCOUNT ────────────────────────────────────────────────────────
export function scene5(scene: Scene, m: MediaSet): GroupClip {
  return sceneGroup(scene, (g, dur) => {
    const p = m.discount;
    // A tall arch photo, easing up in scale from centre.
    const photo = full(g, archPhoto(p.source, p.meta, { x: 170, y: -60, w: 760, h: 1500, radius: 380 }), dur);
    photo.transform.anchor.setStatic([0.5, 0.5]);
    photo.transform.position.setStatic([170 + 380, -60 + 750]);
    photo.transform.scale.setKeyframes([
      { time: 0, value: [0.92, 0.92] },
      { time: 0.8, value: [1, 1], easing: SMOOTH },
    ]);
    fadeIn(photo, 0, 0.4);

    // Crimson strip down the left edge.
    full(g, rect(0, 720, 300, 760, { fill: CRIMSON, radius: 30 }), dur);

    // Huge DISCOUNT, split across two lines at the edges, sliding in from opposite ends.
    const disco = full(g, label('DISCO', { x: 46, y: 250, fontSize: 210, fill: CRIMSON, fontWeight: '700', anchor: [0, 0.5] }), dur);
    slideIn(disco, [-40, -70], 0.0, 0.7);
    const unt = full(g, label('UNT', { x: 46, y: H - 260, fontSize: 210, fill: CRIMSON, fontWeight: '700', anchor: [0, 0.5] }), dur);
    slideIn(unt, [-40, 70], 0.1, 0.7);

    // "50% OFF" tag, top-right.
    const off = full(g, label('50% OFF', { x: W - 46, y: 130, fontSize: 74, fill: CRIMSON, fontWeight: '700', anchor: [1, 0.5], letterSpacing: 1 }), dur);
    slideIn(off, [40, 0], 0.25, 0.6);
    fadeIn(off, 0.25, 0.4);
  });
}

// ── Scene 6 — 50% OFF · MAKE IT YOURS · BRANDNAME ─────────────────────────────
export function scene6(scene: Scene, m: MediaSet): GroupClip {
  return sceneGroup(scene, (g, dur) => {
    const p = m.discount;
    const photo = full(g, archPhoto(p.source, p.meta, { x: 170, y: -60, w: 760, h: 1500, radius: 380 }), dur);
    kenBurns(photo, dur, 1.06, 1);

    // "50% OFF" echo cascading up the right side.
    full(
      g,
      echoStack('50% OFF', {
        x: W - 360,
        y: 60,
        size: 104,
        lineGap: 150,
        count: 7,
        fill: CRIMSON,
        spacing: 1,
        weight: '700',
        falloff: 0.82,
        enter: { from: [0, 90], stagger: 0.05, duration: 0.6 },
      }),
      dur,
    );

    // Crimson BRANDNAME pill, top-right, sliding down.
    const pill = full(g, rect(W - 620, -80, 700, 200, { fill: CRIMSON, radius: 100 }), dur);
    slideIn(pill, [0, -80], 0.1, 0.6);
    const brand = full(g, label('BRANDNAME', { x: W - 260, y: 58, fontSize: 56, fill: WHITE, fontWeight: '700', letterSpacing: 3, anchor: [0.5, 0.5] }), dur);
    slideIn(brand, [0, -80], 0.1, 0.6);

    // "MAKE IT YOURS" italic, bottom-left, over a dot grid.
    const cta = full(
      g,
      label('MAKE IT YOURS', { x: 56, y: H - 300, fontSize: 96, fill: CRIMSON, fontWeight: '700', fontStyle: 'italic', letterSpacing: 1, anchor: [0, 0.5] }),
      dur,
    );
    slideIn(cta, [-70, 0], 0.2, 0.6);
    fadeIn(cta, 0.2, 0.4);
    const dots = full(g, dotGrid(60, H - 210, 6, 2, { gap: 34, dot: 14 }), dur);
    fadeIn(dots, 0.4, 0.4);
  });
}
