/**
 * The storyboard — four chapters of a burnt-orange retro fashion spot, rebuilt
 * with the engine's object graph over REAL studio photography (see `photos.ts`).
 * The motion mirrors the source shot-by-shot:
 *
 *   1. FASHIONABLE HANDBAG — a tilted product card PUNCHES in (fast zoom + de-tilt)
 *      then drifts; the headline resolves out of a blur and breathes solid↔hollow,
 *      then the letters blow apart while the card bulge-warps into the cut.
 *   2. MINIMALIST · RETRO-STYLE — the film frame slides down from the top on a
 *      motion blur, settles, pushes in (feet crop out), then WHIP-SPINS out.
 *   3. LUXURIOUS — a contact-sheet grid whips in, pans + pushes, then bulge-warps
 *      + spreads apart into the cut.
 *   4. GET IT NOW — a split top/bottom layout (waist-with-bag over portrait) with
 *      the mini-bag cycling; the CTA breathes and the URL types on.
 *
 * The cuts are covered on the overlay track: a spinning **torn-paper sunburst**
 * flashes over 1→2 and 3→4, a hard whip-spin bridges 2→3, and warm light leaks
 * swell mid-chapter — all in absolute time. Each chapter is one GroupClip placed
 * at its slice, so its children read in chapter-local time.
 */
import { GroupClip, ImageClip, StaggerTextAnimator, VisualTrack } from '@sequio/engine';
import { COND, CREAM, GRAY, H, INK, S1, S2, S3, S4, W, WHITE } from './theme';
import {
  type Loaded,
  SETTLE,
  SMOOTH,
  blurBurst,
  blurIn,
  bulgeWarp,
  coverImage,
  coverSprite,
  fadeIn,
  filmFrame,
  grade,
  label,
  lightLeak,
  outline,
  pulseHeadline,
  punchIn,
  rect,
  setLife,
  slideIn,
  span,
} from './kit';

export interface Assets {
  // procedural design textures (local files)
  sunburst: Loaded;
  burstTorn: Loaded;
  stripes: Loaded;
  grain: Loaded;
  leak: Loaded;
  // real photography (network URLs)
  hero: Loaded;
  modelFull: Loaded;
  waist: Loaded;
  portrait: Loaded;
  grid: Loaded[];
  bags: Loaded[];
}

/** A chapter group placed at `[start, end]` on `stage`; children use local time. */
function chapter(stage: VisualTrack, start: number, end: number): GroupClip {
  const g = new GroupClip();
  g.transform.anchor.setStatic([0, 0]);
  g.transform.position.setStatic([0, 0]);
  g.start = start;
  g.end = end;
  stage.add(g);
  return g;
}

/** A masked panel of an image with the inner sprite pushed to a focus offset. */
function panel(img: Loaded, box: [number, number, number, number], focus: [number, number], fill = 1.0): GroupClip {
  const [x, y, w, h] = box;
  const g = coverImage(img, x, y, w, h);
  const sprite = coverSprite(g);
  const scale = Math.max(w / img.w, h / img.h) * fill;
  sprite.transform.scale.setStatic([scale, scale]);
  sprite.transform.position.setStatic([w / 2 - img.w * scale * focus[0], h / 2 - img.h * scale * focus[1]]);
  return g;
}

// ── Chapter 1 — FASHIONABLE HANDBAG ───────────────────────────────────────────
export function scene1(stage: VisualTrack, A: Assets): void {
  const dur = S1.end - S1.start;
  const g = chapter(stage, S1.start, S1.end + 0.1);

  // Sunburst backdrop, glimpsed before the card dives in over it.
  g.add(span(coverImage(A.sunburst, 0, 0, W, H)));

  // The product card: a cream polaroid matting the hero product shot. It PUNCHES
  // in from a small tilted pose (fast zoom + de-tilt), holds with a slow push,
  // then bulge-warps + scales into the transition.
  const card = new GroupClip();
  card.transform.anchor.setStatic([0.5, 0.5]);
  card.transform.position.setStatic([W / 2, H / 2]);
  const cardW = 620;
  const cardH = 920;
  card.add(span(rect(-cardW / 2, -cardH / 2, cardW, cardH, { fill: CREAM, radius: 4 })));
  const photo = panel(A.hero, [-cardW / 2 + 16, -cardH / 2 + 16, cardW - 32, cardH - 120], [0.5, 0.5], 1.02);
  grade(coverSprite(photo), { saturation: 1.06, contrast: 1.05 });
  span(photo);
  card.add(photo);
  card.add(span(label('FASHION · 01', { x: 0, y: cardH / 2 - 50, size: 22, fill: 0x8a6a4a, family: COND, letterSpacing: 3 })));
  span(card);
  punchIn(card, { dur: 0.4, fromScale: 0.58, restScale: 1.06, tilt: -0.16, hold: dur, push: 1.2 });
  bulgeWarp(card, dur - 0.5, 0.5, 1.0);
  g.add(card);

  // Headline — blur-resolve in, breathe solid↔hollow, spread apart on exit.
  const head = pulseHeadline({
    text: 'FASHIONABLE\nHANDBAG',
    x: W / 2,
    y: 236,
    size: 82,
    lineGap: 78,
    color: WHITE,
    inAt: 0.55,
    outAt: dur - 0.5,
    pulses: 3,
    spreadExit: true,
  });
  span(head);
  g.add(head);
}

// ── Chapter 2 — MINIMALIST · RETRO-STYLE ──────────────────────────────────────
export function scene2(stage: VisualTrack, A: Assets): void {
  const dur = S2.end - S2.start;
  const g = chapter(stage, S2.start, S2.end + 0.15);

  // Diagonal cream/orange stripe backdrop, drifting sideways for parallax.
  const stripes = coverImage(A.stripes, 0, 0, W, H);
  span(stripes);
  const stripeSprite = coverSprite(stripes);
  const sBase = stripeSprite.transform.position.valueAt(0);
  stripeSprite.transform.position.setKeyframes([
    { time: 0, value: [sBase[0], sBase[1]] },
    { time: dur, value: [sBase[0] - 90, sBase[1]], easing: SMOOTH },
  ]);
  g.add(stripes);

  // Film frame holding the model. Slides down from the top on a motion blur,
  // settles, PUSHES IN continuously (the source crops the feet out), then whip-spins.
  const frame = filmFrame(A.modelFull, { x: W / 2, y: H / 2 + 10, w: 476, h: 812 });
  const framePhoto = coverSprite(frame.children[1] as GroupClip);
  grade(framePhoto, { saturation: 1.02, contrast: 1.04 });
  span(frame);
  setLife(frame, { inAt: 0, inDur: 0.28, outAt: dur - 0.08, outDur: 0.18 });
  frame.transform.position.setKeyframes([
    { time: 0, value: [W / 2 - 30, H / 2 - 240] },
    { time: 0.42, value: [W / 2, H / 2 + 10], easing: SETTLE },
  ]);
  frame.transform.scale.setKeyframes([
    { time: 0, value: [1.06, 1.06] },
    { time: 0.42, value: [1, 1], easing: SETTLE },
    { time: dur - 0.22, value: [1, 1] },
    { time: dur + 0.12, value: [1.9, 1.9], easing: SMOOTH }, // whip out
  ]);
  frame.transform.rotation.setKeyframes([
    { time: 0, value: -0.14 },
    { time: 0.42, value: 0, easing: SETTLE },
    { time: dur - 0.22, value: 0 },
    { time: dur + 0.12, value: 1.2, easing: SMOOTH }, // hard whip-spin
  ]);
  blurIn(frame, 0, 0.28, 24);
  blurBurst(frame, dur - 0.22, 0.4, 55);
  const fps0 = framePhoto.transform.scale.valueAt(0);
  framePhoto.transform.scale.setKeyframes([
    { time: 0, value: fps0 },
    { time: dur, value: [fps0[0] * 1.3, fps0[1] * 1.3], easing: SMOOTH }, // push-in, feet crop
  ]);
  g.add(frame);

  // MINIMALIST (top) — resolves out of a blur, then holds steady.
  const top = pulseHeadline({ text: 'MINIMALIST', x: W / 2, y: 226, size: 66, color: WHITE, inAt: 0.28, outAt: dur - 0.28, pulses: 1 });
  span(top);
  slideIn(top, [0, -26], 0.28, 0.42);
  g.add(top);

  // RETRO-STYLE (bottom) — outline with a solid copy resolving under it.
  const outR = outline('RETRO-STYLE', { x: W / 2, y: H - 226, size: 64, strokeColor: WHITE, strokeWidth: 3, letterSpacing: 1 });
  span(outR);
  setLife(outR, { inAt: 0.42, inDur: 0.32, outAt: dur - 0.22, outDur: 0.18 });
  slideIn(outR, [0, 26], 0.42, 0.42);
  blurIn(outR, 0.42, 0.28, 18);
  g.add(outR);
  const fillR = label('RETRO-STYLE', { x: W / 2, y: H - 226, size: 64, fill: WHITE, letterSpacing: 1 });
  span(fillR);
  fillR.opacity.setKeyframes([
    { time: 0.75, value: 0 },
    { time: 1.15, value: 1, easing: SMOOTH },
    { time: dur - 0.28, value: 1 },
    { time: dur - 0.08, value: 0, easing: SMOOTH },
  ]);
  slideIn(fillR, [0, 26], 0.42, 0.42);
  g.add(fillR);
}

// ── Chapter 3 — LUXURIOUS ─────────────────────────────────────────────────────
export function scene3(stage: VisualTrack, A: Assets): void {
  const dur = S3.end - S3.start;
  const g = chapter(stage, S3.start, S3.end + 0.15);

  g.add(span(rect(0, 0, W, H, { fill: GRAY })));

  // A film contact-sheet grid of the model poses. Whips IN (counter to chapter 2's
  // whip-out), then pans down + pushes in, then bulge-warps into the cut.
  const sheet = new GroupClip();
  sheet.transform.anchor.setStatic([0.5, 0.5]);
  sheet.transform.position.setStatic([W / 2, H / 2]);
  const cols = 2;
  const rows = 4;
  const cw = 300;
  const ch = 360;
  const gap = 12;
  const gridW = cols * cw + (cols - 1) * gap;
  const gridH = rows * ch + (rows - 1) * gap;
  sheet.add(span(rect(-gridW / 2 - 10, -gridH / 2 - 10, gridW + 20, gridH + 20, { fill: INK })));
  let k = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = -gridW / 2 + c * (cw + gap);
      const y = -gridH / 2 + r * (ch + gap);
      const tile = coverImage(A.grid[k % A.grid.length], x, y, cw, ch);
      grade(coverSprite(tile), { saturation: 0.92, brightness: 0.98 });
      sheet.add(span(tile));
      k++;
    }
  }
  span(sheet);
  sheet.transform.position.setKeyframes([
    { time: 0, value: [W / 2, H / 2 - 130] },
    { time: dur + 0.15, value: [W / 2, H / 2 + 110], easing: SMOOTH },
  ]);
  sheet.transform.scale.setKeyframes([
    { time: 0, value: [1.35, 1.35] }, // whip-in overshoot
    { time: 0.35, value: [1.12, 1.12], easing: SMOOTH },
    { time: dur, value: [1.24, 1.24], easing: SMOOTH },
  ]);
  sheet.transform.rotation.setKeyframes([
    { time: 0, value: 0.5 }, // spins in from the chapter-2 whip
    { time: 0.35, value: 0.05, easing: SMOOTH },
  ]);
  blurIn(sheet, 0, 0.3, 40);
  fadeIn(sheet, 0, 0.2);
  bulgeWarp(sheet, dur - 0.4, 0.4, 1.1);
  g.add(sheet);

  // LUXURIOUS — hollow display flickering in, breathing, spreading on exit.
  const lux = pulseHeadline({
    text: 'LUXURIOUS',
    x: W / 2,
    y: 720,
    size: 72,
    spacing: 4,
    color: WHITE,
    inAt: 0.25,
    outAt: dur - 0.35,
    pulses: 2,
    spreadExit: true,
  });
  span(lux);
  lux.opacity.setKeyframes([
    { time: 0.25, value: 0 },
    { time: 0.37, value: 1, easing: SMOOTH },
    { time: 0.47, value: 0.25 },
    { time: 0.6, value: 1, easing: SMOOTH },
  ]);
  g.add(lux);
}

// ── Chapter 4 — GET IT NOW ────────────────────────────────────────────────────
export function scene4(stage: VisualTrack, A: Assets): void {
  const dur = S4.end - S4.start;
  const g = chapter(stage, S4.start, S4.end);
  const splitY = H * 0.52;

  // Split layout: TOP = the waist/midriff (bag held); BOTTOM = a portrait. Both push in.
  const topPanel = panel(A.waist, [0, 0, W, splitY], [0.5, 0.5], 1.05);
  grade(coverSprite(topPanel), { saturation: 0.95 });
  span(topPanel);
  const topSprite = coverSprite(topPanel);
  const ts = topSprite.transform.scale.valueAt(0);
  topSprite.transform.scale.setKeyframes([
    { time: 0, value: ts },
    { time: dur, value: [ts[0] * 1.09, ts[1] * 1.09], easing: SMOOTH },
  ]);
  fadeIn(topPanel, 0, 0.28);
  g.add(topPanel);

  const botPanel = panel(A.portrait, [0, splitY, W, H - splitY], [0.5, 0.42], 1.05);
  grade(coverSprite(botPanel), { saturation: 0.92, brightness: 0.99 });
  span(botPanel);
  const botSprite = coverSprite(botPanel);
  const bs = botSprite.transform.scale.valueAt(0);
  botSprite.transform.scale.setKeyframes([
    { time: 0, value: bs },
    { time: dur, value: [bs[0] * 1.06, bs[1] * 1.06], easing: SMOOTH },
  ]);
  fadeIn(botPanel, 0, 0.28);
  g.add(botPanel);

  // A rotating set of mini-bag product shots at the split line — each cuts in
  // with a small pop, holds, then the next replaces it.
  const bagY = splitY - 96;
  const per = (dur - 0.3) / A.bags.length;
  A.bags.forEach((b, i) => {
    const size = 168;
    const holder = coverImage(b, W / 2 + 150, bagY - size / 2, size, size, 10);
    grade(coverSprite(holder), { saturation: 1.05 });
    const t0 = i * per;
    holder.opacity.setKeyframes([
      { time: t0, value: 0 },
      { time: t0 + 0.12, value: 1, easing: SMOOTH },
      { time: t0 + per - 0.1, value: 1 },
      { time: t0 + per, value: 0 },
    ]);
    holder.transform.scale.setKeyframes([
      { time: t0, value: [0.7, 0.7] },
      { time: t0 + 0.16, value: [1, 1], easing: SETTLE },
    ]);
    span(holder);
    g.add(holder);
  });

  // GET IT NOW — breathes solid↔hollow around the split line.
  const cta = pulseHeadline({ text: 'GET IT NOW', x: W / 2, y: splitY - 30, size: 80, color: WHITE, inAt: 0.35, outAt: dur - 0.15, pulses: 3 });
  span(cta);
  slideIn(cta, [0, 22], 0.35, 0.42);
  g.add(cta);

  // www.brandname.com — types on character by character beneath the CTA.
  const url = label('www.brandname.com', { x: W / 2, y: splitY + 28, size: 32, fill: WHITE, family: COND, letterSpacing: 1 });
  url.split = 'char';
  url.textAnimator = new StaggerTextAnimator({ from: { alpha: 0 }, duration: 0.02, stagger: 0.05, delay: 0.9, order: 'forward' });
  span(url);
  url.opacity.setKeyframes([
    { time: 0.85, value: 1 },
    { time: dur - 0.15, value: 1 },
    { time: dur, value: 0, easing: SMOOTH },
  ]);
  g.add(url);
}

// ── Overlay transitions (torn-paper sunburst + light leaks over the cuts) ──────
export function transitions(overlay: VisualTrack, A: Assets): void {
  const leak = (at: number, peak: number) => {
    const c = lightLeak(A.leak, at, 0.3, 0.5, peak);
    c.transform.scale.setStatic([W / A.leak.w, H / A.leak.h]);
    c.start = at - 0.5;
    c.end = at + 0.7;
    overlay.add(c);
  };

  // A spinning torn-paper sunburst that POPS to cover the cut, then dissolves to
  // reveal the next chapter (the source cuts on exactly this graphic).
  const burst = (at: number) => {
    const g = new GroupClip();
    g.transform.anchor.setStatic([0.5, 0.5]);
    g.transform.position.setStatic([W / 2, H / 2]);
    g.add(span(coverImage(A.burstTorn, -W / 2, -H / 2, W, H)));
    g.start = at - 0.28;
    g.end = at + 0.4;
    g.transform.scale.setKeyframes([
      { time: at - 0.28, value: [0.3, 0.3] },
      { time: at - 0.08, value: [1.85, 1.85], easing: SMOOTH }, // fast pop to cover
      { time: at + 0.4, value: [2.15, 2.15] },
    ]);
    g.transform.rotation.setKeyframes([
      { time: at - 0.28, value: -0.7 },
      { time: at + 0.4, value: 0.5, easing: SMOOTH }, // keeps spinning through
    ]);
    g.opacity.setKeyframes([
      { time: at - 0.28, value: 0 },
      { time: at - 0.12, value: 1, easing: SMOOTH },
      { time: at + 0.14, value: 1 },
      { time: at + 0.4, value: 0, easing: SMOOTH }, // dissolve → reveal next chapter
    ]);
    overlay.add(g);
  };

  burst(S1.end); // chapter 1 → 2
  leak(S2.start + (S2.end - S2.start) * 0.6, 0.6); // mid chapter-2 pink swell
  leak(S2.end, 0.55); // a flash over the whip into chapter 3
  burst(S3.end); // chapter 3 → 4
  leak(S4.start + (S4.end - S4.start) * 0.62, 0.6); // chapter-4 pink sweep
}

/**
 * A film-grain wash over the whole piece: a neutral noise panel on `'overlay'`
 * blend at low opacity, jittered a few times a second so the grain crawls.
 */
export function filmGrain(track: VisualTrack, A: Assets, duration: number): void {
  const sprite = new ImageClip(A.grain.source);
  sprite.blendMode = 'overlay';
  sprite.opacity.setStatic(0.13);
  sprite.transform.anchor.setStatic([0, 0]);
  const scale = Math.max(W / A.grain.w, H / A.grain.h) * 1.06;
  sprite.transform.scale.setStatic([scale, scale]);
  sprite.start = 0;
  sprite.end = duration;
  const offs = [
    [0, 0],
    [-6, 4],
    [5, -5],
    [-3, -6],
    [6, 3],
    [-5, 5],
    [3, -4],
    [-4, 2],
  ];
  const jitter: { time: number; value: [number, number] }[] = [];
  const steps = Math.ceil(duration * 8);
  for (let i = 0; i <= steps; i++) {
    const o = offs[i % offs.length];
    jitter.push({ time: i / 8, value: [-14 + o[0], -14 + o[1]] });
  }
  sprite.transform.position.setKeyframes(jitter);
  track.add(sprite);
}
