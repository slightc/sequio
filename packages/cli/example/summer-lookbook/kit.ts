/**
 * Reusable clip builders for the Summer Collection lookbook.
 *
 * The engine gives us image / text / shape / group clips and keyframed
 * transforms; this module turns them into the vocabulary the storyboard speaks:
 * framed photos, accent bands, a little vector globe, GSAP entrances, and an
 * arced wordmark stitched from one `TextClip` per glyph. So `scenes.ts` reads
 * like a shot list instead of transform bookkeeping.
 */
import {
  GroupClip,
  ImageClip,
  ImageSource,
  ShapeClip,
  type SourceMetadata,
  StaggerTextAnimator,
  TextClip,
  type VisualClip,
  easeOutCubic,
  gsapClipAnimator,
} from '@sequio/engine';
import gsap from 'gsap';
import { WHITE } from './theme';

// Local child windows are effectively "always on" inside their group's own
// window; the group's start/end gate the whole subtree.
const FOREVER = 9999;

// ── Primitive factories ───────────────────────────────────────────────────────

/** A text clip; `anchor` is the alignment point that `position` places. */
export function text(
  str: string,
  family: string,
  size: number,
  fill: number,
  anchor: [number, number] = [0.5, 0.5],
): TextClip {
  const c = new TextClip({ text: str, fontFamily: family, fontSize: size, fill });
  c.transform.anchor.setStatic(anchor);
  return c;
}

/** A rectangle (optionally rounded / stroked), centre-anchored by default. */
export function rect(
  w: number,
  h: number,
  fill: number,
  opts: { radius?: number; anchor?: [number, number]; stroke?: { color: number; width: number } } = {},
): ShapeClip {
  const c = new ShapeClip({ kind: 'rect', width: w, height: h, fill, radius: opts.radius, stroke: opts.stroke });
  c.transform.anchor.setStatic(opts.anchor ?? [0.5, 0.5]);
  return c;
}

/** Set a clip's active window (timeline seconds). */
export function win(clip: VisualClip, start: number, end: number): void {
  clip.start = start;
  clip.end = end;
}

/** Give every child the full local window so it stays mounted with its group. */
function fillChildren(g: GroupClip): void {
  for (const ch of g.children) {
    ch.start = 0;
    ch.end = FOREVER;
  }
}

// ── Imagery ───────────────────────────────────────────────────────────────────

/** Fetch + decode an image source, returning it with its (served) metadata. */
export async function loadImage(url: string): Promise<{ source: ImageSource; meta: SourceMetadata }> {
  const source = new ImageSource({ src: url });
  const meta = await source.load();
  return { source, meta };
}

/**
 * A framed photo: a white mat with the image inset. The image is scaled to fill
 * the box exactly (the URL is requested at the box's aspect, so there's no
 * overflow past the mat even without a clipping mask). Centre-anchored, tiltable,
 * and returned as one `GroupClip` so it enters as a single unit.
 */
export function framedPhoto(
  source: ImageSource,
  meta: SourceMetadata,
  opts: { boxW: number; boxH: number; border?: number; tilt?: number },
): GroupClip {
  const border = opts.border ?? 16;
  const g = new GroupClip();

  const mat = rect(opts.boxW + border * 2, opts.boxH + border * 2, WHITE);
  mat.transform.position.setStatic([0, 0]);
  g.add(mat);

  const img = new ImageClip(source);
  const s = opts.boxW / meta.width; // aspect matches the box → height fits too
  img.transform.anchor.setStatic([0.5, 0.5]);
  img.transform.scale.setStatic([s, s]);
  img.transform.position.setStatic([0, 0]);
  g.add(img);

  g.transform.anchor.setStatic([0.5, 0.5]);
  g.transform.rotation.setStatic(opts.tilt ?? 0);
  fillChildren(g);
  return g;
}

/** A bare image sized to a box (no mat) — used for the diagonal intro slash. */
export function bareImage(source: ImageSource, meta: SourceMetadata, boxW: number): ImageClip {
  const img = new ImageClip(source);
  const s = boxW / meta.width;
  img.transform.anchor.setStatic([0.5, 0.5]);
  img.transform.scale.setStatic([s, s]);
  return img;
}

/**
 * A tiny vector globe (outline circle + two "meridian" hairlines) drawn purely
 * from shape clips — the icon in the outro's website pill.
 */
export function globe(d: number, color: number): GroupClip {
  const g = new GroupClip();
  const ring = new ShapeClip({ kind: 'ellipse', width: d, height: d, fill: WHITE, stroke: { color, width: 2 } });
  ring.transform.anchor.setStatic([0.5, 0.5]);
  g.add(ring);
  const vert = new ShapeClip({ kind: 'ellipse', width: d * 0.42, height: d, fill: WHITE, stroke: { color, width: 2 } });
  vert.transform.anchor.setStatic([0.5, 0.5]);
  g.add(vert);
  const horiz = rect(d, 2, color);
  g.add(horiz);
  g.transform.anchor.setStatic([0.5, 0.5]);
  fillChildren(g);
  return g;
}

/**
 * An arced wordmark: one `TextClip` per glyph placed on a circle of `radius`,
 * fanned across `arc` radians and rotated to the tangent, so the line bulges
 * upward like a smile. Centre-anchored; animate the whole `GroupClip` to reveal
 * it. Pure clip composition — this is a "text effect built from clips".
 */
export function arcText(opts: {
  str: string;
  family: string;
  size: number;
  fill: number;
  radius: number;
  arc: number;
}): GroupClip {
  const g = new GroupClip();
  const chars = [...opts.str];
  const n = chars.length;
  chars.forEach((ch, i) => {
    // Fan the glyphs symmetrically about the top of the circle.
    const a = n > 1 ? -opts.arc / 2 + (opts.arc * i) / (n - 1) : 0;
    const x = opts.radius * Math.sin(a);
    const y = -opts.radius * Math.cos(a) + opts.radius; // 0 at centre, dips at ends
    const glyph = text(ch === ' ' ? ' ' : ch, opts.family, opts.size, opts.fill, [0.5, 0.5]);
    glyph.transform.position.setStatic([x, y]);
    glyph.transform.rotation.setStatic(a);
    g.add(glyph);
  });
  g.transform.anchor.setStatic([0.5, 0.5]);
  fillChildren(g);
  return g;
}

// ── Entrances (GSAP, seeked paused → deterministic, contract #2) ──────────────

/**
 * Fade + rise a clip into its resting pose at absolute time `at`, optionally
 * settling in scale (`pop`) and drifting to a resting offset. `at` is rebased to
 * the clip's local time for the seek-driven animator.
 */
export function enter(
  target: VisualClip,
  x: number,
  y: number,
  opts: { at: number; dur?: number; rise?: number; from?: number; pop?: number; ease?: string },
): void {
  const dur = opts.dur ?? 0.6;
  const ease = opts.ease ?? 'power3.out';
  const inAt = Math.max(0, opts.at - target.start);
  target.transform.position.setStatic([x, y]);
  target.opacity.setStatic(1);
  target.animator = gsapClipAnimator(gsap, (tl, o) => {
    const from: Record<string, number> = { alpha: 0 };
    const to: Record<string, number> = { alpha: 1, duration: dur, ease };
    if (opts.rise) from.y = opts.rise;
    if (opts.from) from.x = opts.from;
    if (opts.rise) to.y = 0;
    if (opts.from) to.x = 0;
    if (opts.pop) {
      from.scaleX = opts.pop;
      from.scaleY = opts.pop;
      to.scaleX = 1;
      to.scaleY = 1;
    }
    tl.set(o, from, 0);
    tl.to(o, to, inAt);
  });
}

/**
 * The opening reveal: a photo enters as a thin diagonal slit — rotated steeply
 * and squeezed to nothing across its short axis — that rotates upright while it
 * widens (and settles from a slight over-height), landing as the resting frame.
 * Scaling the local x-axis reveals perpendicular to the tilt, so the band looks
 * like it's being wiped open along the diagonal.
 */
export function slashReveal(
  target: VisualClip,
  x: number,
  y: number,
  opts: { at: number; dur?: number; angle?: number },
): void {
  const dur = opts.dur ?? 0.7;
  const angle = opts.angle ?? -1.05;
  const inAt = Math.max(0, opts.at - target.start);
  target.transform.position.setStatic([x, y]);
  target.opacity.setStatic(1);
  target.animator = gsapClipAnimator(gsap, (tl, o) => {
    tl.set(o, { scaleX: 0.03, scaleY: 1.25, rotation: angle, alpha: 0 }, 0);
    tl.to(o, { alpha: 1, duration: dur * 0.35, ease: 'power1.out' }, inAt);
    tl.to(o, { scaleX: 1, scaleY: 1, rotation: 0, duration: dur, ease: 'power3.out' }, inAt);
  });
}

/**
 * Make a `TextClip` "flow" in glyph-by-glyph — split it into characters and
 * stagger each from a small left/low offset while fading up, so a cursive title
 * reads as if it's being written left-to-right. Position is static; the per-part
 * stagger does the reveal (so don't also drive the whole clip's opacity).
 */
export function flowIn(
  clip: TextClip,
  x: number,
  y: number,
  opts: { at: number; each?: number; dur?: number },
): void {
  clip.transform.position.setStatic([x, y]);
  clip.opacity.setStatic(1);
  clip.split = 'char';
  clip.textAnimator = new StaggerTextAnimator({
    from: { x: -16, y: 8, alpha: 0 },
    duration: opts.dur ?? 0.5,
    stagger: opts.each ?? 0.045,
    delay: Math.max(0, opts.at - clip.start),
    order: 'forward',
    easing: easeOutCubic,
  });
}
