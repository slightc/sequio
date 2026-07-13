/**
 * Reusable clip builders + animation helpers for the handbag-promo scenes.
 *
 * The engine gives us shapes, styled text (weight / letter-spacing / hollow
 * stroke), still images, groups with a clip mask, and keyframed
 * transform/opacity/effects. This module turns those into the vocabulary the
 * storyboard speaks in — image panels, polaroid + film frames, sunburst layers,
 * the pulsing display headline, and the light-leak flash — so `scenes.ts` reads
 * like a shot list.
 */
import {
  BlurEffect,
  ColorEffect,
  type Easing,
  GroupClip,
  ImageClip,
  ImageSource,
  ShapeClip,
  TextClip,
  type TextStyleLike,
  type VisualClip,
  cubicBezier,
} from '@sequio/engine';
import { loadAsset } from '@sequio/runtime';
import { COND, DISPLAY, HOLLOW, INK, WHITE } from './theme';

// ── Easings ──────────────────────────────────────────────────────────────────
/** CSS `cubic-bezier(0.16,1,0.3,1)` — quick out, long gentle settle. */
export const SMOOTH: Easing = cubicBezier(0.16, 1, 0.3, 1);
/** A small overshoot-and-settle for pop-in accents. */
export const SETTLE: Easing = cubicBezier(0.34, 1.56, 0.64, 1);

// ── Loaded-image handle ──────────────────────────────────────────────────────
export interface Loaded {
  source: ImageSource;
  w: number;
  h: number;
}

/** Load a local asset next to the composition into an {@link ImageSource}. */
export async function loadImg(path: string): Promise<Loaded> {
  const source = new ImageSource({ src: await loadAsset(path) });
  const meta = await source.load();
  return { source, w: meta.width, h: meta.height };
}

// ── Timing helper ──────────────────────────────────────────────────────────────
const SPAN = 1e5;
/** Keep a group's inner children mounted for whatever window the group gets. */
export function span<T extends { start: number; end: number }>(clip: T): T {
  clip.start = 0;
  clip.end = SPAN;
  return clip;
}

// ── Shapes ───────────────────────────────────────────────────────────────────
export interface RectOpts {
  fill: number;
  radius?: number;
  anchor?: [number, number];
  stroke?: { color: number; width: number };
  opacity?: number;
}

/** An axis-aligned rectangle (optionally rounded / stroked) at `[x, y]`. */
export function rect(x: number, y: number, w: number, h: number, o: RectOpts): ShapeClip {
  const s = new ShapeClip({ kind: 'rect', width: w, height: h, fill: o.fill, radius: o.radius, stroke: o.stroke });
  s.transform.anchor.setStatic(o.anchor ?? [0, 0]);
  s.transform.position.setStatic([x, y]);
  if (o.opacity !== undefined) s.opacity.setStatic(o.opacity);
  return s;
}

// ── Images ───────────────────────────────────────────────────────────────────
/**
 * An image laid out like CSS `object-fit: cover` inside `[x,y,w,h]` — fills the
 * box, keeps aspect, cropped to the box by a rect `maskShape` on a wrapping
 * group so it never bleeds past its frame.
 */
export function coverImage(img: Loaded, x: number, y: number, w: number, h: number, radius = 0): GroupClip {
  const g = new GroupClip();
  g.transform.anchor.setStatic([0, 0]);
  g.transform.position.setStatic([x, y]);
  g.maskShape = { kind: 'rect', width: w, height: h, radius: radius || undefined };
  const scale = Math.max(w / img.w, h / img.h);
  const sprite = new ImageClip(img.source);
  sprite.transform.anchor.setStatic([0, 0]);
  sprite.transform.scale.setStatic([scale, scale]);
  sprite.transform.position.setStatic([(w - img.w * scale) / 2, (h - img.h * scale) / 2]);
  g.add(span(sprite));
  return g;
}

/** The inner `ImageClip` of a cover group, so a scene can push a Ken-Burns push. */
export function coverSprite(g: GroupClip): ImageClip {
  return g.children[0] as ImageClip;
}

// ── Text ─────────────────────────────────────────────────────────────────────
export interface LabelOpts extends Omit<TextStyleLike, 'text'> {
  x: number;
  y: number;
  anchor?: [number, number];
  rotation?: number;
  family?: string;
}

/** A run of display text (defaults to the heavy condensed display face). */
export function label(text: string, o: LabelOpts): TextClip {
  const { x, y, anchor, rotation, family, ...style } = o;
  const t = new TextClip({ text, fontFamily: family ?? DISPLAY, ...style });
  t.transform.anchor.setStatic(anchor ?? [0.5, 0.5]);
  t.transform.position.setStatic([x, y]);
  if (rotation) t.transform.rotation.setStatic(rotation);
  return t;
}

/** A hollow / outlined display word (transparent fill + a coloured stroke). */
export function outline(text: string, o: LabelOpts & { strokeColor?: number; strokeWidth?: number }): TextClip {
  const { strokeColor, strokeWidth, ...rest } = o;
  return label(text, {
    ...rest,
    fill: HOLLOW,
    stroke: { color: strokeColor ?? WHITE, width: strokeWidth ?? 2 },
  });
}

// ── Entrance helpers ───────────────────────────────────────────────────────────
/** Keyframe opacity 0→`to` over `[at, at+dur]` (clip-local seconds). */
export function fadeIn(clip: VisualClip, at: number, dur = 0.5, to = 1): void {
  clip.opacity.setKeyframes([
    { time: at, value: 0 },
    { time: at + dur, value: to, easing: SMOOTH },
  ]);
}

/** Fade a clip out over `[at, at+dur]`. */
export function fadeOut(clip: VisualClip, at: number, dur = 0.35): void {
  const held = clip.opacity.valueAt(0);
  clip.opacity.setKeyframes([
    { time: at, value: held },
    { time: at + dur, value: 0, easing: SMOOTH },
  ]);
}

/**
 * One combined opacity track for a clip's whole life: fade in over `[inAt, +inDur]`,
 * hold at `peak`, fade out over `[outAt, +outDur]`. Use this instead of calling
 * {@link fadeIn} then {@link fadeOut} — a second `setKeyframes` would clobber the
 * first (each call replaces the track).
 */
export function setLife(
  clip: VisualClip,
  o: { inAt: number; inDur?: number; outAt: number; outDur?: number; peak?: number },
): void {
  const peak = o.peak ?? 1;
  clip.opacity.setKeyframes([
    { time: o.inAt, value: 0 },
    { time: o.inAt + (o.inDur ?? 0.4), value: peak, easing: SMOOTH },
    { time: o.outAt, value: peak },
    { time: o.outAt + (o.outDur ?? 0.3), value: 0, easing: SMOOTH },
  ]);
}

/** Slide a clip in from a pixel offset to its resting position. */
export function slideIn(clip: VisualClip, from: [number, number], at: number, dur = 0.7, ease: Easing = SMOOTH): void {
  const to = clip.transform.position.valueAt(0);
  clip.transform.position.setKeyframes([
    { time: at, value: [to[0] + from[0], to[1] + from[1]] },
    { time: at + dur, value: to, easing: ease },
  ]);
}

/**
 * A slow Ken-Burns push: scale a still from `from`→`to` across `[0,dur]` so a
 * flat panel keeps drifting instead of sitting dead.
 */
export function kenBurns(clip: VisualClip, dur: number, from = 1.12, to = 1.0): void {
  const base = clip.transform.scale.valueAt(0);
  clip.transform.scale.setKeyframes([
    { time: 0, value: [base[0] * from, base[1] * from] },
    { time: dur, value: [base[0] * to, base[1] * to], easing: SMOOTH },
  ]);
}

// ── Pulsing display headline ───────────────────────────────────────────────────
/**
 * The recurring headline treatment: a hollow outline copy and a solid-fill copy
 * of the same word stacked exactly, the fill cross-pulsing under the outline
 * (soft→solid→soft) the way the source headline breathes. Both blur-fade in
 * together, then the whole stack fades before the cut. Returns a `GroupClip`.
 *
 * `pulses` picks how many soft→solid swells happen over `[in, out]`.
 */
export function pulseHeadline(o: {
  text: string;
  x: number;
  y: number;
  size: number;
  lineGap?: number;
  spacing?: number;
  anchor?: [number, number];
  align?: TextStyleLike['align'];
  color?: number;
  inAt: number;
  outAt: number;
  pulses?: number;
  /** Spread the word horizontally (letter-spacing blow-out) as it exits. */
  spreadExit?: boolean;
}): GroupClip {
  const g = new GroupClip();
  g.transform.anchor.setStatic(o.anchor ?? [0.5, 0.5]);
  g.transform.position.setStatic([o.x, o.y]);
  const color = o.color ?? WHITE;
  const common = {
    x: 0,
    y: 0,
    fontSize: o.size,
    lineHeight: o.lineGap ?? o.size * 1.02,
    letterSpacing: o.spacing ?? 0,
    align: o.align ?? ('center' as const),
    anchor: [0.5, 0.5] as [number, number],
  };

  // Hollow outline — always visible once entered.
  const hollow = outline(o.text, { ...common, strokeColor: color, strokeWidth: 2.4 });
  fadeIn(hollow, o.inAt, 0.5);
  fadeOut(hollow, o.outAt, 0.35);

  // Solid fill — cross-pulses to give the "breathing" solid↔hollow read.
  const solid = label(o.text, { ...common, fill: color });
  const pulses = o.pulses ?? 2;
  const kf: { time: number; value: number; easing?: Easing }[] = [{ time: o.inAt, value: 0 }];
  const span = o.outAt - (o.inAt + 0.4);
  for (let i = 0; i < pulses; i++) {
    const t0 = o.inAt + 0.4 + (span / pulses) * i;
    kf.push({ time: t0, value: 1, easing: SMOOTH });
    kf.push({ time: t0 + span / pulses / 2, value: 0.15, easing: SMOOTH });
  }
  kf.push({ time: o.outAt, value: 1, easing: SMOOTH });
  kf.push({ time: o.outAt + 0.35, value: 0, easing: SMOOTH });
  solid.opacity.setKeyframes(kf);

  g.add(span2(hollow));
  g.add(span2(solid));
  // Scale: settle in on entrance, and (optionally) blow out horizontally on exit
  // — the "letters spacing apart" read the source uses to leave the headline.
  const scaleKf: { time: number; value: [number, number]; easing?: Easing }[] = [
    { time: o.inAt, value: [1.14, 1.14] },
    { time: o.inAt + 0.6, value: [1, 1], easing: SMOOTH },
  ];
  if (o.spreadExit) {
    scaleKf.push({ time: o.outAt, value: [1, 1] });
    scaleKf.push({ time: o.outAt + 0.35, value: [1.9, 1.0], easing: SMOOTH });
  }
  g.transform.scale.setKeyframes(scaleKf);
  return g;
}

// local span that doesn't clobber the exported name inside pulseHeadline scope
function span2<T extends { start: number; end: number }>(clip: T): T {
  clip.start = 0;
  clip.end = 1e5;
  return clip;
}

// ── Light-leak flash ───────────────────────────────────────────────────────────
/**
 * A warm light-leak bloom that flashes over the cut: an additive image that
 * ramps up then out across `[at-lead, at+trail]`. Used to hide every scene
 * change, matching the source's pink/orange leaks.
 */
export function lightLeak(img: Loaded, at: number, lead = 0.25, trail = 0.4, peak = 0.9): ImageClip {
  const c = new ImageClip(img.source);
  c.blendMode = 'add';
  c.transform.anchor.setStatic([0, 0]);
  c.transform.position.setStatic([0, 0]);
  c.transform.scale.setStatic([1, 1]); // caller sizes the asset to canvas
  c.opacity.setKeyframes([
    { time: at - lead, value: 0 },
    { time: at, value: peak, easing: SMOOTH },
    { time: at + trail, value: 0, easing: SMOOTH },
  ]);
  return c;
}

// ── Film frame (the scene-2 polaroid/film holder) ──────────────────────────────
/**
 * A black film frame around a photo panel, with sprocket bars top and bottom and
 * small strip markings — the "CAPCUT · PT4 260STK" holder the source uses. The
 * photo fills the inner window; the whole thing is a `GroupClip` so it can sway
 * and whip as one unit.
 */
export function filmFrame(img: Loaded, o: { x: number; y: number; w: number; h: number }): GroupClip {
  const g = new GroupClip();
  g.transform.anchor.setStatic([0.5, 0.5]);
  g.transform.position.setStatic([o.x, o.y]);
  const bw = 14; // side border
  const bar = 30; // top/bottom sprocket bar
  // black backing
  g.add(span(rect(-o.w / 2, -o.h / 2, o.w, o.h, { fill: INK, radius: 6 })));
  // photo window
  const iw = o.w - bw * 2;
  const ih = o.h - bar * 2;
  const photo = coverImage(img, -iw / 2, -ih / 2 + 0, iw, ih);
  span(photo);
  g.add(photo);
  // sprocket ticks along top and bottom bars
  const ticks = 9;
  for (let i = 0; i < ticks; i++) {
    const tx = -o.w / 2 + bw + (iw / (ticks - 1)) * i - 4;
    g.add(span(rect(tx, -o.h / 2 + bar / 2 - 3, 8, 6, { fill: 0x555049, radius: 2 })));
    g.add(span(rect(tx, o.h / 2 - bar / 2 - 3, 8, 6, { fill: 0x555049, radius: 2 })));
  }
  // corner markings
  g.add(span(label('▶ PT4  260STK', { x: o.w / 2 - bw - 4, y: -o.h / 2 + bar / 2, size: 12, fill: 0xcabfa8, anchor: [1, 0.5], family: COND, letterSpacing: 1 })));
  g.add(span(label('35', { x: -o.w / 2 + bw + 4, y: o.h / 2 - bar / 2, size: 12, fill: 0xcabfa8, anchor: [0, 0.5], family: COND })));
  g.add(span(label('CAPCUT  PT4 260STK', { x: o.w / 2 - bw - 4, y: o.h / 2 - bar / 2, size: 11, fill: 0xcabfa8, anchor: [1, 0.5], family: COND, letterSpacing: 1 })));
  return g;
}

// ── Motion-blur helper ─────────────────────────────────────────────────────────
/** Push a keyframed blur on a clip (0→peak→0) over `[at, at+dur]` for whips. */
export function blurBurst(clip: VisualClip, at: number, dur: number, peak = 24): void {
  const fx = new BlurEffect();
  fx.strength.setKeyframes([
    { time: at, value: 0 },
    { time: at + dur * 0.5, value: peak, easing: SMOOTH },
    { time: at + dur, value: 0, easing: SMOOTH },
  ]);
  clip.effects.push(fx);
}

/** A gentle warm colour grade (used to unify the illustration panels). */
export function grade(clip: VisualClip, opts: { brightness?: number; contrast?: number; saturation?: number } = {}): void {
  const fx = new ColorEffect();
  fx.brightness.setStatic(opts.brightness ?? 1.0);
  fx.contrast.setStatic(opts.contrast ?? 1.05);
  fx.saturation.setStatic(opts.saturation ?? 1.08);
  clip.effects.push(fx);
}
