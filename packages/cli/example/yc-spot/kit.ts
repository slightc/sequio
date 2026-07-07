/**
 * Reusable clip builders + animation helpers for the example scenes.
 *
 * The engine gives us shapes, text, groups and keyframed transform/opacity;
 * this module turns those into the vocabulary the storyboard speaks in —
 * cards, badges, stat chips, hairlines, and a couple of entrance curves — so
 * `scenes.ts` reads like a shot list instead of keyframe bookkeeping.
 */
import { GroupClip, ShapeClip, TextClip, VisualClip, gsapClipAnimator } from '@sequio/engine';
import gsap from 'gsap';
import { CARD, HEAVY, INK, MUTE, SANS, SHADOW } from './theme';

// Motion is authored with GSAP: every entrance/exit below binds a clip to a
// paused GSAP timeline via `gsapClipAnimator`, seeked to the clip's local time
// each frame (deterministic — contract #2). The clip's base transform holds the
// resting pose; the animator layers the GSAP-eased offset on top. `gsap` is
// resolved by the CLI as a runtime external, so no per-project install is needed.

// ── Primitive factories ───────────────────────────────────────────────────────

/** A text clip; `anchor` picks the alignment point that `position` places. */
export function text(
  str: string,
  family: string,
  size: number,
  fill: number,
  anchor: [number, number] = [0, 0.5],
): TextClip {
  const c = new TextClip({ text: str, fontFamily: family, fontSize: size, fill });
  c.transform.anchor.setStatic(anchor);
  return c;
}

/** A rectangle (optionally rounded / stroked); anchored at its centre by default. */
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

/** A filled circle of diameter `d`, centre-anchored. */
export function circle(d: number, fill: number): ShapeClip {
  const c = new ShapeClip({ kind: 'ellipse', width: d, height: d, fill });
  c.transform.anchor.setStatic([0.5, 0.5]);
  return c;
}

// ── Timing helpers ─────────────────────────────────────────────────────────────

/** Set a clip's active window (seconds on the timeline). */
export function window(clip: VisualClip, start: number, end: number): void {
  clip.start = start;
  clip.end = end;
}

/** Give a group's children the full local window so they stay mounted. */
function fillChildren(g: GroupClip, localEnd: number): void {
  for (const ch of g.children) {
    ch.start = 0;
    ch.end = localEnd;
  }
}

/**
 * Reveal a clip/group with a GSAP-driven entrance: fade up while rising (and,
 * with `pop`, settling in scale) into its resting pose, hold, then optionally
 * fade out before `until`. `at`/`until` are absolute timeline seconds; they are
 * rebased to the clip's local time for the seek-driven animator.
 */
export function reveal(
  target: VisualClip,
  x: number,
  y: number,
  opts: { at: number; dur?: number; rise?: number; until?: number; out?: number; ease?: string; pop?: number },
): void {
  const dur = opts.dur ?? 0.55;
  const rise = opts.rise ?? 26;
  const ease = opts.ease ?? 'power3.out';
  const inAt = Math.max(0, opts.at - target.start);
  // Base pose = final resting state; the animator supplies the offset over it.
  target.transform.position.setStatic([x, y]);
  target.opacity.setStatic(1);
  target.animator = gsapClipAnimator(gsap, (tl, o) => {
    const from: Record<string, number> = { y: rise, alpha: 0 };
    const to: Record<string, number> = { y: 0, alpha: 1, duration: dur, ease };
    if (opts.pop) {
      from.scaleX = opts.pop;
      from.scaleY = opts.pop;
      to.scaleX = 1;
      to.scaleY = 1;
    }
    tl.set(o, from, 0);
    tl.to(o, to, inAt);
    if (opts.until !== undefined) {
      const out = opts.out ?? 0.3;
      tl.to(o, { alpha: 0, duration: out, ease: 'power1.in' }, Math.max(inAt + dur, opts.until - target.start - out));
    }
  });
}

/**
 * A hairline that "draws on" left-to-right (GSAP tweens scaleX 0→1 against the
 * left-anchored rect), then fades before `until`. Used for the editorial rules
 * and the arrow's shaft.
 */
export function drawLine(
  c: ShapeClip,
  x: number,
  y: number,
  opts: { at: number; dur?: number; until: number },
): void {
  const dur = opts.dur ?? 0.5;
  const inAt = Math.max(0, opts.at - c.start);
  c.transform.position.setStatic([x, y]);
  c.opacity.setStatic(1);
  c.animator = gsapClipAnimator(gsap, (tl, o) => {
    tl.set(o, { scaleX: 0 }, 0);
    tl.to(o, { scaleX: 1, duration: dur, ease: 'power3.out' }, inAt);
    tl.to(o, { alpha: 0, duration: 0.3, ease: 'power1.in' }, Math.max(inAt + dur, opts.until - c.start - 0.3));
  });
}

// ── Compound builders ──────────────────────────────────────────────────────────

/** A square logo badge (e.g. the black "Y") with a centred glyph. */
export function badge(size: number, bg: number, glyph: string, fg: number): GroupClip {
  const g = new GroupClip();
  g.add(rect(size, size, bg, { anchor: [0.5, 0.5], radius: 4 }));
  g.add(text(glyph, HEAVY, size * 0.6, fg, [0.5, 0.5]));
  g.transform.anchor.setStatic([0.5, 0.5]);
  fillChildren(g, 999);
  return g;
}

/**
 * A "photo" card: a white mat with a soft drop shadow, a solid colour standing
 * in for the image, and a caption / batch tag along the bottom. Centre-anchored
 * and tiltable, so a whole card enters (and rotates) as one unit.
 */
export function photoCard(opts: {
  w: number;
  h: number;
  color: number;
  label?: string;
  tag?: string;
  tilt?: number;
  captionH?: number;
}): GroupClip {
  const { w, h, color } = opts;
  const pad = 14;
  const capH = opts.captionH ?? (opts.label ? 52 : 0);
  const g = new GroupClip();

  const shadow = rect(w, h, SHADOW, { anchor: [0.5, 0.5] });
  shadow.opacity.setStatic(0.16);
  shadow.transform.position.setStatic([10, 16]);
  g.add(shadow);

  g.add(rect(w, h, CARD, { anchor: [0.5, 0.5] }));

  const photo = rect(w - pad * 2, h - pad * 2 - capH, color, { anchor: [0.5, 0] });
  photo.transform.position.setStatic([0, -h / 2 + pad]);
  g.add(photo);

  if (opts.label) {
    const label = text(opts.label, SANS, 26, INK, [0, 0.5]);
    label.transform.position.setStatic([-w / 2 + pad + 6, h / 2 - capH / 2]);
    g.add(label);
  }
  if (opts.tag) {
    const tag = text(opts.tag, SANS, 22, MUTE, [1, 0.5]);
    tag.transform.position.setStatic([w / 2 - pad - 6, h / 2 - capH / 2]);
    g.add(tag);
  }

  g.transform.anchor.setStatic([0.5, 0.5]);
  g.transform.rotation.setStatic(opts.tilt ?? 0);
  fillChildren(g, 999);
  return g;
}

/** A bordered stat chip: a big heavy value on the left, a muted label beside it. */
export function statChip(opts: { w: number; h: number; value: string; label: string; valueW?: number }): GroupClip {
  const { w, h } = opts;
  const g = new GroupClip();

  const shadow = rect(w, h, SHADOW, { anchor: [0.5, 0.5], radius: 4 });
  shadow.opacity.setStatic(0.12);
  shadow.transform.position.setStatic([6, 9]);
  g.add(shadow);

  g.add(rect(w, h, CARD, { anchor: [0.5, 0.5], radius: 4, stroke: { color: INK, width: 3 } }));

  const value = text(opts.value, HEAVY, 40, INK, [0, 0.5]);
  value.transform.position.setStatic([-w / 2 + 34, 0]);
  g.add(value);

  const label = text(opts.label, SANS, 24, MUTE, [0, 0.5]);
  label.transform.position.setStatic([-w / 2 + 34 + (opts.valueW ?? 150), 0]);
  g.add(label);

  g.transform.anchor.setStatic([0.5, 0.5]);
  fillChildren(g, 999);
  return g;
}
