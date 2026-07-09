/**
 * Reusable builders for the Valentine's Day Sale example. Each returns a clip
 * (or `GroupClip`) laid out in canvas pixels; scenes compose them and set the
 * `start` / `end` window. Kept deliberately declarative so `scenes.ts` reads
 * like a shot list.
 *
 * Two engine features do the heavy lifting here: `TextClip`'s style
 * pass-through (weight / italic / letter-spacing / stroke → the outline and
 * italic display cuts) and `VisualClip.maskShape` (the arch-cropped photos).
 */
import {
  type Easing,
  GroupClip,
  ImageClip,
  type ImageSource,
  ShapeClip,
  type TextAnimator,
  TextClip,
  type TextPart,
  type TextStyleLike,
  cubicBezier,
  easeOutCubic,
} from '@sequio/engine';
import { CRIMSON, DISPLAY } from './theme';

/**
 * A soft "expo-out" curve (CSS `cubic-bezier(0.16, 1, 0.3, 1)`): quick to move,
 * long gentle settle. Used for every entrance so nothing snaps into place —
 * this is what keeps the motion from feeling stiff.
 */
export const SMOOTH: Easing = cubicBezier(0.16, 1, 0.3, 1);
/** A tiny overshoot-and-settle, for pop-in accents. */
export const SETTLE: Easing = cubicBezier(0.34, 1.56, 0.64, 1);

/**
 * Active window for a builder's *inner* children (dots, echo copies, the masked
 * image). They live in their group's local time; the group itself gets the real
 * scene window from `scenes.ts`. A wide span keeps them active for whatever
 * window the group ends up with.
 */
const SPAN = 1e5;
function span<T extends { start: number; end: number }>(clip: T): T {
  clip.start = 0;
  clip.end = SPAN;
  return clip;
}

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface RectOpts {
  fill: number;
  radius?: number;
  /** Normalized anchor (default top-left `[0, 0]`). */
  anchor?: [number, number];
}

/** An axis-aligned rectangle (optionally rounded) at `[x, y]`. */
export function rect(x: number, y: number, w: number, h: number, o: RectOpts): ShapeClip {
  const s = new ShapeClip({ kind: 'rect', width: w, height: h, fill: o.fill, radius: o.radius });
  s.transform.anchor.setStatic(o.anchor ?? [0, 0]);
  s.transform.position.setStatic([x, y]);
  return s;
}

/** A circle/ellipse centred on `[cx, cy]`. */
export function circle(cx: number, cy: number, d: number, fill: number): ShapeClip {
  const s = new ShapeClip({ kind: 'ellipse', width: d, height: d, fill });
  s.transform.anchor.setStatic([0.5, 0.5]);
  s.transform.position.setStatic([cx, cy]);
  return s;
}

/**
 * A grid of small dots (the recurring 3×N dot motif). Returns a `GroupClip` so
 * the block animates / fades as one unit.
 */
export function dotGrid(
  x: number,
  y: number,
  cols: number,
  rows: number,
  opts: { gap?: number; dot?: number; fill?: number } = {},
): GroupClip {
  const gap = opts.gap ?? 26;
  const dot = opts.dot ?? 12;
  const fill = opts.fill ?? CRIMSON;
  const g = new GroupClip();
  g.transform.anchor.setStatic([0, 0]);
  g.transform.position.setStatic([x, y]);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      g.add(span(circle(c * gap, r * gap, dot, fill)));
    }
  }
  return g;
}

// ── Text ─────────────────────────────────────────────────────────────────────

export interface LabelOpts extends Omit<TextStyleLike, 'text'> {
  x: number;
  y: number;
  anchor?: [number, number];
  rotation?: number;
}

/** A single run of display text. Defaults to the condensed grotesque. */
export function label(text: string, o: LabelOpts): TextClip {
  const { x, y, anchor, rotation, ...style } = o;
  const t = new TextClip({ text, fontFamily: DISPLAY, ...style });
  t.transform.anchor.setStatic(anchor ?? [0.5, 0.5]);
  t.transform.position.setStatic([x, y]);
  if (rotation) t.transform.rotation.setStatic(rotation);
  return t;
}

/**
 * The "echo" motif: the same word stacked `count` times down the frame, each
 * copy fainter than the one above (the trailing after-image the source uses for
 * VALENTINE'S DAY / SUPER / PROMO / 50% OFF). Returns a `GroupClip` so the whole
 * stack can slide / fade in together.
 */
export function echoStack(
  text: string,
  o: {
    x: number;
    y: number;
    size: number;
    lineGap: number;
    count: number;
    fill?: number;
    weight?: TextStyleLike['fontWeight'];
    spacing?: number;
    anchor?: [number, number];
    /** Opacity multiplier applied per step down the stack (default `0.62`). */
    falloff?: number;
    /** `TextStyleLike.stroke` → hollow/outlined copies (e.g. SUPER). */
    stroke?: TextStyleLike['stroke'];
    family?: string;
    /** Staggered cascade-in: each copy slides from `from` + fades, offset in time. */
    enter?: { from?: [number, number]; delay?: number; stagger?: number; duration?: number };
  },
): GroupClip {
  const falloff = o.falloff ?? 0.62;
  const anchor = o.anchor ?? [0, 0];
  const g = new GroupClip();
  g.transform.anchor.setStatic([0, 0]);
  g.transform.position.setStatic([o.x, o.y]);
  const e = o.enter;
  for (let i = 0; i < o.count; i++) {
    const target = Math.pow(falloff, i);
    const t = label(text, {
      x: 0,
      y: i * o.lineGap,
      size: o.size,
      fontSize: o.size,
      fill: o.fill ?? CRIMSON,
      fontWeight: o.weight ?? '700',
      letterSpacing: o.spacing ?? 0,
      stroke: o.stroke,
      fontFamily: o.family ?? DISPLAY,
      anchor,
    });
    if (e) {
      // Each copy cascades in a beat after the one before → a rolling reveal.
      const t0 = (e.delay ?? 0) + i * (e.stagger ?? 0.08);
      const dur = e.duration ?? 0.6;
      const [dx, dy] = e.from ?? [0, 40];
      t.opacity.setKeyframes([
        { time: t0, value: 0 },
        { time: t0 + dur, value: target, easing: SMOOTH },
      ]);
      t.transform.position.setKeyframes([
        { time: t0, value: [dx, i * o.lineGap + dy] },
        { time: t0 + dur, value: [0, i * o.lineGap], easing: SMOOTH },
      ]);
    } else {
      t.opacity.setStatic(target);
    }
    g.add(span(t));
  }
  return g;
}

// ── Arch-cropped photo ───────────────────────────────────────────────────────

export interface ArchOpts {
  x: number;
  y: number;
  w: number;
  h: number;
  /** `'rect'` → arch/rounded-rect, `'ellipse'` → circle/oval crop. */
  kind?: 'rect' | 'ellipse';
  /** Corner radius for a rect crop (defaults to `w / 2` → full arch). */
  radius?: number;
  /** Tint used if the photo is missing (network failed / offline). */
  fallback?: number;
}

/**
 * A photo cropped to an arch (rounded-rect) or circle, built as a `GroupClip`
 * whose `maskShape` clips the image child. The image is scaled to fill the
 * region exactly (it was requested pre-cropped to this aspect), so the mask fits
 * without distortion. Degrades to a solid tint when `source` is `null`.
 */
export function archPhoto(
  source: ImageSource | null,
  meta: { width: number; height: number } | null,
  o: ArchOpts,
): GroupClip {
  const kind = o.kind ?? 'rect';
  const g = new GroupClip();
  g.transform.anchor.setStatic([0, 0]);
  g.transform.position.setStatic([o.x, o.y]);
  g.maskShape = {
    kind,
    width: o.w,
    height: o.h,
    radius: kind === 'rect' ? (o.radius ?? o.w / 2) : undefined,
  };
  if (source && meta) {
    const img = new ImageClip(source);
    img.transform.anchor.setStatic([0, 0]);
    img.transform.position.setStatic([0, 0]);
    img.transform.scale.setStatic([o.w / meta.width, o.h / meta.height]);
    g.add(span(img));
  } else {
    g.add(span(rect(0, 0, o.w, o.h, { fill: o.fallback ?? 0xd98b86 })));
  }
  return g;
}

// ── Arc text (curved word) ───────────────────────────────────────────────────

/**
 * Lays the characters of a split `TextClip` along a circular arc. A pure
 * `(part, localT)` function of the pre-computed per-character geometry, so it
 * stays reproducible (contract #2). `dir = +1` bows the word downward (∩),
 * `-1` upward (∪); `reveal` fades characters in left-to-right.
 */
export class ArcTextAnimator implements TextAnimator {
  private readonly map = new Map<number, { x: number; y: number; rot: number }>();

  constructor(
    parts: readonly TextPart[],
    radius: number,
    dir: 1 | -1,
    private readonly reveal?: { duration: number; stagger: number },
  ) {
    const xs = parts.map((p) => p.x);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    for (const p of parts) {
      // `theta` keeps the character's left-to-right order (never flips x); `dir`
      // only chooses which way the word bows and which way glyphs tilt.
      const theta = (p.x - cx) / radius;
      const nx = cx + radius * Math.sin(theta);
      const ny = p.y + dir * (radius - radius * Math.cos(theta));
      this.map.set(p.index, { x: nx - p.x, y: ny - p.y, rot: theta * dir });
    }
  }

  sampleForPart(part: TextPart, localT: number) {
    const m = this.map.get(part.index) ?? { x: 0, y: 0, rot: 0 };
    let alpha = 1;
    if (this.reveal) {
      const startT = part.index * this.reveal.stagger;
      const k = (localT - startT) / this.reveal.duration;
      alpha = k <= 0 ? 0 : k >= 1 ? 1 : easeOutCubic(k);
    }
    return { x: m.x, y: m.y, rotation: m.rot, alpha };
  }
}

/**
 * Build a curved word. Must be called after fonts are loaded (it measures the
 * laid-out characters via `getParts()`). Set the clip's `transform.rotation` to
 * tilt the whole arc.
 */
export function arcLabel(
  text: string,
  o: LabelOpts & { radius: number; dir?: 1 | -1; reveal?: { duration: number; stagger: number } },
): TextClip {
  const t = label(text, o);
  t.split = 'char';
  t.textAnimator = new ArcTextAnimator(t.getParts(), o.radius, o.dir ?? 1, o.reveal);
  return t;
}

// ── Entrance animation helpers ───────────────────────────────────────────────

/** Keyframe a clip's opacity 0→`to` over `[at, at+dur]` (local seconds). */
export function fadeIn(
  clip: { opacity: { setKeyframes: (k: unknown[]) => void } },
  at: number,
  dur = 0.5,
  to = 1,
): void {
  clip.opacity.setKeyframes([
    { time: at, value: 0 },
    { time: at + dur, value: to, easing: SMOOTH },
  ]);
}

/** Slide a clip in from `[dx, dy]` to its position over `[at, at+dur]`. */
export function slideIn(
  clip: { transform: { position: { valueAt: (t: number) => [number, number]; setKeyframes: (k: unknown[]) => void } } },
  from: [number, number],
  at: number,
  dur = 0.7,
  easing: Easing = SMOOTH,
): void {
  const to = clip.transform.position.valueAt(0);
  clip.transform.position.setKeyframes([
    { time: at, value: [to[0] + from[0], to[1] + from[1]] },
    { time: at + dur, value: to, easing },
  ]);
}

/**
 * A slow Ken-Burns push on a clip: scale from `fromScale` to `toScale` across
 * `[0, dur]`, so a still photo keeps drifting instead of sitting dead. Pivots on
 * the clip's current anchor.
 */
export function kenBurns(
  clip: { transform: { scale: { setKeyframes: (k: unknown[]) => void } } },
  dur: number,
  fromScale = 1.08,
  toScale = 1,
): void {
  clip.transform.scale.setKeyframes([
    { time: 0, value: [fromScale, fromScale] },
    { time: dur, value: [toScale, toScale], easing: SMOOTH },
  ]);
}
