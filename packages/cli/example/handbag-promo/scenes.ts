/**
 * The storyboard — four chapters of a burnt-orange retro fashion spot, rebuilt
 * with the engine's object graph over original flat-illustration panels:
 *
 *   1. FASHIONABLE HANDBAG  — sunburst backdrop, a polaroid product card that
 *      settles in then pushes to fill, the headline pulsing solid↔hollow and
 *      spreading apart on exit.
 *   2. MINIMALIST · RETRO-STYLE — a swaying black film frame holding the model,
 *      over diagonal cream/orange stripes; whips out on a motion blur.
 *   3. LUXURIOUS — a panning film contact-sheet grid, hollow headline flickering
 *      in; a sunburst iris (on the overlay) bursts open into…
 *   4. GET IT NOW — the model with a rotating set of mini-bags at the waist, the
 *      headline resolving and the URL typing on beneath it.
 *
 * Each chapter is one {@link GroupClip} placed at its slice of the timeline; its
 * children live in the group's **local** time (0 … sceneDur), so every keyframe
 * below reads as an offset from the chapter's own start. Light-leak flashes and
 * the sunburst iris ride a separate overlay track in absolute time and cover the
 * cuts.
 */
import { GroupClip, ImageClip, StaggerTextAnimator, VisualTrack } from '@sequio/engine';
import { COND, CREAM, GRAY, H, INK, S1, S2, S3, S4, W, WHITE } from './theme';
import {
  type Loaded,
  SETTLE,
  SMOOTH,
  blurBurst,
  coverImage,
  coverSprite,
  fadeIn,
  filmFrame,
  grade,
  kenBurns,
  label,
  lightLeak,
  outline,
  pulseHeadline,
  rect,
  setLife,
  slideIn,
  span,
} from './kit';

export interface Assets {
  sunburst: Loaded;
  bagHero: Loaded;
  model: Loaded;
  bags: Loaded[];
  leak: Loaded;
  stripes: Loaded;
  grain: Loaded;
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

// ── Chapter 1 — FASHIONABLE HANDBAG ───────────────────────────────────────────
export function scene1(stage: VisualTrack, A: Assets): void {
  const dur = S1.end - S1.start;
  const g = chapter(stage, S1.start, S1.end + 0.1);

  // Sunburst backdrop, drifting.
  const burst = coverImage(A.sunburst, 0, 0, W, H);
  span(burst);
  kenBurns(coverSprite(burst), dur, 1.08, 1.18);
  g.add(burst);

  // The product "polaroid": a cream card matting the bag illustration. It drops
  // in tilted and settles (0–0.6s), then slowly pushes in until it fills frame.
  const card = new GroupClip();
  card.transform.anchor.setStatic([0.5, 0.5]);
  card.transform.position.setStatic([W / 2, H / 2]);
  const cardW = 560;
  const cardH = 840;
  card.add(span(rect(-cardW / 2, -cardH / 2, cardW, cardH, { fill: CREAM, radius: 4 })));
  const photo = coverImage(A.bagHero, -cardW / 2 + 16, -cardH / 2 + 16, cardW - 32, cardH - 120, 2);
  grade(coverSprite(photo));
  span(photo);
  card.add(photo);
  card.add(span(label('FASHION · 01', { x: 0, y: cardH / 2 - 46, size: 20, fill: 0x8a6a4a, family: COND, letterSpacing: 3 })));
  span(card);
  card.transform.rotation.setKeyframes([
    { time: 0, value: -0.06 },
    { time: 0.6, value: 0, easing: SETTLE },
  ]);
  card.transform.scale.setKeyframes([
    { time: 0, value: [0.68, 0.68] },
    { time: 0.6, value: [0.92, 0.92], easing: SETTLE },
    { time: 1.5, value: [0.95, 0.95], easing: SMOOTH },
    { time: dur, value: [1.62, 1.62], easing: SMOOTH }, // pushes to fill
  ]);
  g.add(card);

  // Headline — pulses solid↔hollow, then spreads apart as it leaves.
  const head = pulseHeadline({
    text: 'FASHIONABLE\nHANDBAG',
    x: W / 2,
    y: 250,
    size: 78,
    lineGap: 74,
    color: WHITE,
    inAt: 0.6,
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

  // Diagonal cream/orange stripe backdrop (a pre-drawn panel, wider than frame),
  // drifting sideways for parallax.
  const stripes = coverImage(A.stripes, 0, 0, W, H);
  span(stripes);
  const stripeSprite = coverSprite(stripes);
  const sBase = stripeSprite.transform.position.valueAt(0);
  stripeSprite.transform.position.setKeyframes([
    { time: 0, value: [sBase[0], sBase[1]] },
    { time: dur, value: [sBase[0] - 90, sBase[1]], easing: SMOOTH },
  ]);
  g.add(stripes);

  // Film frame holding the model, gently swaying, whipping out at the cut.
  const frame = filmFrame(A.model, { x: W / 2, y: H / 2 + 10, w: 470, h: 800 });
  grade(coverSprite(frame.children[1] as GroupClip), { saturation: 1.05 });
  span(frame);
  setLife(frame, { inAt: 0, inDur: 0.4, outAt: dur - 0.12, outDur: 0.22 });
  frame.transform.scale.setKeyframes([
    { time: 0, value: [0.86, 0.86] },
    { time: 0.5, value: [1, 1], easing: SETTLE },
    { time: dur - 0.25, value: [1, 1] },
    { time: dur + 0.1, value: [1.3, 1.3], easing: SMOOTH }, // whip out
  ]);
  frame.transform.rotation.setKeyframes([
    { time: 0.5, value: -0.03 },
    { time: 1.6, value: 0.03, easing: SMOOTH },
    { time: 2.6, value: -0.02, easing: SMOOTH },
    { time: dur - 0.25, value: 0.0, easing: SMOOTH },
    { time: dur + 0.1, value: 0.4, easing: SMOOTH }, // whip
  ]);
  blurBurst(frame, dur - 0.25, 0.45, 26);
  g.add(frame);

  // MINIMALIST (top) — outline resolving to fill.
  const top = pulseHeadline({ text: 'MINIMALIST', x: W / 2, y: 235, size: 62, color: WHITE, inAt: 0.35, outAt: dur - 0.35, pulses: 2 });
  span(top);
  slideIn(top, [0, -30], 0.35, 0.5);
  g.add(top);

  // RETRO-STYLE (bottom) — outline, with a solid copy crossing under it.
  const outR = outline('RETRO-STYLE', { x: W / 2, y: H - 235, size: 60, strokeColor: WHITE, strokeWidth: 2.8, letterSpacing: 1 });
  span(outR);
  setLife(outR, { inAt: 0.5, inDur: 0.4, outAt: dur - 0.3, outDur: 0.2 });
  slideIn(outR, [0, 30], 0.5, 0.5);
  g.add(outR);
  const fillR = label('RETRO-STYLE', { x: W / 2, y: H - 235, size: 60, fill: WHITE, letterSpacing: 1 });
  span(fillR);
  fillR.opacity.setKeyframes([
    { time: 0.9, value: 0 },
    { time: 1.4, value: 1, easing: SMOOTH },
    { time: dur - 0.4, value: 1 },
    { time: dur - 0.15, value: 0, easing: SMOOTH },
  ]);
  slideIn(fillR, [0, 30], 0.5, 0.5);
  g.add(fillR);
}

// ── Chapter 3 — LUXURIOUS ─────────────────────────────────────────────────────
export function scene3(stage: VisualTrack, A: Assets): void {
  const dur = S3.end - S3.start;
  const g = chapter(stage, S3.start, S3.end + 0.15);

  // Grey wash behind the contact sheet.
  g.add(span(rect(0, 0, W, H, { fill: GRAY })));

  // A film contact-sheet grid of the model, tilted and panning down slowly.
  const sheet = new GroupClip();
  sheet.transform.anchor.setStatic([0.5, 0.5]);
  sheet.transform.position.setStatic([W / 2, H / 2]);
  sheet.transform.rotation.setStatic(0.05);
  sheet.transform.scale.setStatic([1.18, 1.18]);
  const cols = 2;
  const rows = 4;
  const cw = 300;
  const ch = 360;
  const gap = 12;
  const gridW = cols * cw + (cols - 1) * gap;
  const gridH = rows * ch + (rows - 1) * gap;
  sheet.add(span(rect(-gridW / 2 - 10, -gridH / 2 - 10, gridW + 20, gridH + 20, { fill: INK })));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = -gridW / 2 + c * (cw + gap);
      const y = -gridH / 2 + r * (ch + gap);
      const tile = coverImage(A.model, x, y, cw, ch);
      grade(coverSprite(tile), { saturation: 0.9, brightness: 0.98 });
      sheet.add(span(tile));
    }
  }
  span(sheet);
  sheet.transform.position.setKeyframes([
    { time: 0, value: [W / 2, H / 2 - 130] },
    { time: dur + 0.15, value: [W / 2, H / 2 + 90], easing: SMOOTH },
  ]);
  fadeIn(sheet, 0, 0.4);
  g.add(sheet);

  // LUXURIOUS — hollow display flickering in, a soft solid copy underneath.
  const lux = outline('LUXURIOUS', { x: W / 2, y: 720, size: 68, strokeColor: WHITE, strokeWidth: 3, letterSpacing: 4 });
  span(lux);
  lux.opacity.setKeyframes([
    { time: 0.2, value: 0 },
    { time: 0.33, value: 0.9, easing: SMOOTH },
    { time: 0.43, value: 0.2 },
    { time: 0.58, value: 1, easing: SMOOTH }, // flicker on
    { time: dur - 0.3, value: 1 },
    { time: dur, value: 0, easing: SMOOTH },
  ]);
  g.add(lux);
  const luxFill = label('LUXURIOUS', { x: W / 2, y: 720, size: 68, fill: WHITE, letterSpacing: 4 });
  span(luxFill);
  luxFill.opacity.setKeyframes([
    { time: 0.9, value: 0 },
    { time: 1.5, value: 0.9, easing: SMOOTH },
    { time: dur - 0.3, value: 0.9 },
    { time: dur, value: 0, easing: SMOOTH },
  ]);
  g.add(luxFill);
}

// ── Chapter 4 — GET IT NOW ────────────────────────────────────────────────────
export function scene4(stage: VisualTrack, A: Assets): void {
  const dur = S4.end - S4.start;
  const g = chapter(stage, S4.start, S4.end);

  // Model, framed on the waist, grey studio wash — the "held bag" shot. The
  // cover group crops to the frame; the inner sprite is pushed in on the midriff
  // so the waistband sits low-centre, matching the source's crop.
  const modelBg = coverImage(A.model, 0, 0, W, H);
  const sprite = coverSprite(modelBg);
  grade(sprite, { saturation: 0.92 });
  const baseScale = Math.max(W / A.model.w, H / A.model.h);
  const zoom = 1.4;
  sprite.transform.scale.setStatic([baseScale * zoom, baseScale * zoom]);
  const drawW = A.model.w * baseScale * zoom;
  const drawH = A.model.h * baseScale * zoom;
  sprite.transform.position.setStatic([(W - drawW) / 2, -drawH * 0.2]);
  span(modelBg);
  kenBurns(sprite, dur, 1.0, 1.06);
  fadeIn(modelBg, 0, 0.3);
  g.add(modelBg);

  // A rotating set of mini-bags at the waist/hand — each pops in, holds, pops out.
  const bagY = H * 0.5;
  const per = (dur - 0.3) / A.bags.length;
  A.bags.forEach((b, i) => {
    const holder = new GroupClip();
    holder.transform.anchor.setStatic([0.5, 0.5]);
    holder.transform.position.setStatic([W / 2 + 10, bagY]);
    const size = 210;
    const scale = Math.min(size / b.w, size / b.h);
    const s = coverImage(b, (-b.w * scale) / 2, (-b.h * scale) / 2, b.w * scale, b.h * scale);
    holder.add(span(s));
    const t0 = i * per;
    holder.opacity.setKeyframes([
      { time: t0, value: 0 },
      { time: t0 + 0.18, value: 1, easing: SMOOTH },
      { time: t0 + per - 0.18, value: 1 },
      { time: t0 + per, value: 0, easing: SMOOTH },
    ]);
    holder.transform.scale.setKeyframes([
      { time: t0, value: [0.6, 0.6] },
      { time: t0 + 0.22, value: [1, 1], easing: SETTLE },
      { time: t0 + per, value: [1.1, 1.1], easing: SMOOTH },
    ]);
    span(holder);
    g.add(holder);
  });

  // GET IT NOW — outline resolving to a solid hit.
  const cta = pulseHeadline({ text: 'GET IT NOW', x: W / 2, y: H - 265, size: 76, color: WHITE, inAt: 0.4, outAt: dur - 0.15, pulses: 3 });
  span(cta);
  slideIn(cta, [0, 26], 0.4, 0.5);
  g.add(cta);

  // www.brandname.com — types on character by character beneath the CTA.
  const url = label('www.brandname.com', { x: W / 2, y: H - 190, size: 31, fill: WHITE, family: COND, letterSpacing: 1 });
  url.split = 'char';
  url.textAnimator = new StaggerTextAnimator({ from: { alpha: 0 }, duration: 0.02, stagger: 0.045, delay: 1.0, order: 'forward' });
  span(url);
  url.opacity.setKeyframes([
    { time: 0.9, value: 1 },
    { time: dur - 0.15, value: 1 },
    { time: dur, value: 0, easing: SMOOTH },
  ]);
  g.add(url);
}

// ── Overlay transitions (light leaks + sunburst iris over the cuts) ────────────
export function transitions(overlay: VisualTrack, A: Assets): void {
  // Light-leak flashes (absolute timeline time — these ride a top-level track).
  const leak = (at: number, peak: number) => {
    const c = lightLeak(A.leak, at, 0.3, 0.5, peak);
    c.transform.scale.setStatic([W / A.leak.w, H / A.leak.h]);
    c.start = at - 0.5;
    c.end = at + 0.7;
    overlay.add(c);
  };

  // A spinning sunburst that irises open over a cut, then dissolves to reveal the
  // next chapter — the cream burst the source uses between shots.
  const iris = (at: number) => {
    const g = new GroupClip();
    g.transform.anchor.setStatic([0.5, 0.5]);
    g.transform.position.setStatic([W / 2, H / 2]);
    g.add(span(coverImage(A.sunburst, -W / 2, -H / 2, W, H)));
    g.start = at - 0.42;
    g.end = at + 0.48;
    g.transform.scale.setKeyframes([
      { time: at - 0.42, value: [0.02, 0.02] },
      { time: at + 0.04, value: [1.5, 1.5], easing: SMOOTH },
      { time: at + 0.48, value: [1.75, 1.75] },
    ]);
    g.transform.rotation.setKeyframes([
      { time: at - 0.42, value: -0.5 },
      { time: at + 0.04, value: 0.0, easing: SMOOTH },
    ]);
    g.opacity.setKeyframes([
      { time: at - 0.42, value: 1 },
      { time: at + 0.2, value: 1 },
      { time: at + 0.48, value: 0, easing: SMOOTH },
    ]);
    overlay.add(g);
  };

  iris(S1.end); // chapter 1 → 2 (cream sunburst burst)
  leak(S2.start + (S2.end - S2.start) * 0.55, 0.55); // mid chapter-2 warm swell
  leak(S2.end - 0.1, 0.6); // chapter 2 → 3 leak over the whip
  iris(S3.end); // chapter 3 → 4 (sunburst burst)
  leak(S4.start + 2.0, 0.45); // chapter-4 warm sweep
}

/**
 * A film-grain wash over the whole piece: a neutral noise panel on `'overlay'`
 * blend at low opacity, its position jittered a few times a second so the grain
 * crawls instead of sitting as fixed dirt — the vintage texture that unifies the
 * illustration panels with the source's filmic look.
 */
export function filmGrain(track: VisualTrack, A: Assets, duration: number): void {
  const sprite = new ImageClip(A.grain.source);
  sprite.blendMode = 'overlay';
  sprite.opacity.setStatic(0.14);
  sprite.transform.anchor.setStatic([0, 0]);
  const scale = Math.max(W / A.grain.w, H / A.grain.h) * 1.06; // headroom for jitter
  sprite.transform.scale.setStatic([scale, scale]);
  sprite.start = 0;
  sprite.end = duration;
  // Jitter the panel a few times a second so the grain crawls, not sits.
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
