import type { AnimationSample, ClipAnimator, TextAnimator, TextPart } from './clip-animator';

/**
 * The slice of a GSAP `Timeline` this binding uses — declared structurally so the
 * engine **never imports `gsap`** (it stays out of `package.json`; the consumer
 * owns the dependency). A real `gsap.timeline()` satisfies it. Targets/vars are
 * `unknown` (method-style signatures, so gsap's more specific `Timeline` stays
 * assignable); the adapter only ever *seeks* via {@link time}, never plays.
 */
export interface GsapTimelineLike {
  /** Add a tween animating the target(s) *to* the given values. */
  to(target: unknown, vars?: unknown, position?: unknown): GsapTimelineLike;
  /** Add a tween animating the target(s) *from* the given values toward current. */
  from(target: unknown, vars?: unknown, position?: unknown): GsapTimelineLike;
  /** Add a tween with explicit from/to values. */
  fromTo(target: unknown, fromVars?: unknown, toVars?: unknown, position?: unknown): GsapTimelineLike;
  /** Set the target(s) to the given values at a point in the timeline. */
  set(target: unknown, vars?: unknown, position?: unknown): GsapTimelineLike;
  /** Seek to (or read) the timeline's playhead, in seconds. */
  time(seconds: number, suppressEvents?: boolean): unknown;
  /** Total duration in seconds. */
  duration(): number;
}

/** The slice of the `gsap` global this binding needs: a paused-timeline factory. */
export interface GsapLike {
  timeline(vars?: { paused?: boolean; [k: string]: unknown }): GsapTimelineLike;
}

/**
 * A mutable proxy GSAP tweens and this binding reads back. Seed it at identity
 * (`x:0, y:0, scaleX:1, scaleY:1, rotation:0, alpha:1`) so a `.from()` tween has
 * a defined endpoint. **Rotation is in radians** (engine-native) — tween it
 * directly; don't use GSAP's degree-based transform shorthands. Likewise use
 * `scaleX`/`scaleY`, not the `scale` shorthand (GSAP only expands that for DOM
 * targets, not plain objects).
 */
export type GsapTarget = Record<keyof AnimationSample, number>;

/** A fresh identity target for GSAP to tween. */
export function identityTarget(): GsapTarget {
  return { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, alpha: 1 };
}

function readSample(target: GsapTarget): AnimationSample {
  return {
    x: target.x,
    y: target.y,
    scaleX: target.scaleX,
    scaleY: target.scaleY,
    rotation: target.rotation,
    alpha: target.alpha,
  };
}

/**
 * Force a freshly-built paused timeline to render its `t=0` state onto the
 * target(s). A new paused timeline sits at playhead 0 having rendered nothing, so
 * its targets still hold their post-construction (identity) values; the first
 * `time(0)` seek would then be a no-op (the playhead is already 0, so GSAP
 * short-circuits) and leak that identity for one frame — the clip flashes in
 * fully-formed before its entrance. Nudging the playhead to the end and back to 0
 * makes GSAP actually render, so `time(0)` reflects the real `t=0` pose (e.g. a
 * `.from()`/`set()` start state) from the very first frame.
 */
function primeTimeline(timeline: GsapTimelineLike): void {
  timeline.time(timeline.duration(), true);
  timeline.time(0, true);
}

/**
 * Bind a clip's animation to a **paused, seek-driven** GSAP timeline — the only
 * way to use GSAP without breaking `render(t)` reproducibility (contract #2): the
 * timeline never *plays* (no wall-clock, no ticker), it is *seeked* to the clip's
 * local time on every frame, so the same `t` always yields the same result.
 *
 * `build` receives a paused timeline and an identity {@link GsapTarget}; add your
 * tweens against the target. The returned {@link ClipAnimator} seeks the timeline
 * and reads the target back on each `sampleAt`.
 *
 * ```ts
 * import gsap from 'gsap';
 * clip.animator = gsapClipAnimator(gsap, (tl, o) => {
 *   tl.to(o, { y: 0, alpha: 1, duration: 0.6, ease: 'power3.out' });
 * });
 * ```
 */
export function gsapClipAnimator(
  gsap: GsapLike,
  build: (timeline: GsapTimelineLike, target: GsapTarget) => void,
): ClipAnimator {
  const target = identityTarget();
  const timeline = gsap.timeline({ paused: true });
  build(timeline, target);
  primeTimeline(timeline); // render the t=0 pose now, so frame 0 doesn't flash identity
  return {
    sampleAt(localT: number): AnimationSample {
      timeline.time(localT > 0 ? localT : 0, true); // seek (suppress events) → pure
      return readSample(target);
    },
  };
}

/**
 * Bind split-text parts to a paused, seek-driven GSAP timeline. `build` receives
 * the timeline and an array of identity targets (one per part) — the natural home
 * for GSAP's `stagger`, which is exactly the逐字/逐词/逐行 use case:
 *
 * ```ts
 * import gsap from 'gsap';
 * clip.split = 'char';
 * clip.textAnimator = gsapTextAnimator(gsap, clip.partCount, (tl, parts) => {
 *   tl.from(parts, { y: -40, alpha: 0, stagger: 0.04, ease: 'power2.out' });
 * });
 * ```
 *
 * `count` must match the clip's `partCount` (read it after the font is loaded, so
 * the measured layout is final). Parts whose index is out of range animate as
 * identity, so an off-by-one never throws.
 */
export function gsapTextAnimator(
  gsap: GsapLike,
  count: number,
  build: (timeline: GsapTimelineLike, targets: GsapTarget[]) => void,
): TextAnimator {
  const targets = Array.from({ length: count }, identityTarget);
  const timeline = gsap.timeline({ paused: true });
  build(timeline, targets);
  primeTimeline(timeline); // render the t=0 pose now, so frame 0 doesn't flash identity
  let seekedTo = Number.NaN;
  return {
    sampleForPart(part: TextPart, localT: number): AnimationSample {
      const t = localT > 0 ? localT : 0;
      // Seek once per frame: parts share one timeline, so re-seeking for each is
      // redundant (and the result is identical). `render(t)` may call parts in any
      // order at the same `t`; the guard keeps it O(1) without changing output.
      if (t !== seekedTo) {
        timeline.time(t, true);
        seekedTo = t;
      }
      const target = targets[part.index];
      return target ? readSample(target) : {};
    },
  };
}
