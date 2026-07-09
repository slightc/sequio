/**
 * Bring-your-own **effect · transition · animation** — a small toolkit authored
 * entirely in *composition* code, then used by ./index.ts.
 *
 * The engine ships `Effect` / `Transition` / `ClipAnimator` / `TextAnimator` as
 * extension seams: a consumer subclasses (or implements) them and drops the result
 * straight into `clip.effects`, `track.addTransition(...)`, `clip.animator` or
 * `textClip.textAnimator` — no engine change required (the runtime's "bring your
 * own Clip/Effect subclasses").
 *
 * None of these touch `pixi.js` (only `@sequio/engine` is injected into a
 * composition): the effects/transition subclass the engine's own classes and
 * reuse their built-in filters, and the animators are pure math. So all four
 * render identically in the browser preview (WebGL) and the pure-Node
 * `sequio render` (WebGPU) — contract #3 (preview and export share one core) and
 * contract #2 (`sampleAt` / `render(t)` are pure functions of local/global time).
 */
import { BlurEffect, ColorEffect, CrossfadeTransition, easeOutCubic } from '@sequio/engine';
import { AnimatableProperty, easeInOutCubic } from '@sequio/engine';
import type { AnimationSample, ClipAnimator, TextAnimator, TextPart } from '@sequio/engine';

// ── 1 · a custom EFFECT ───────────────────────────────────────────────────────

/**
 * A **focus pull**. The engine's {@link BlurEffect} takes a raw pixel `strength`;
 * `FocusPull` wraps it in a normalized `focus` ∈ [0,1] knob (0 = razor sharp,
 * 1 = fully blurred by `maxBlur` px) so a clip can visibly resolve out of a soft
 * blur into focus. It drives the inherited `strength` from `focus` each frame and
 * lets the base class push it into the real `BlurFilter`.
 */
export class FocusPull extends BlurEffect {
  readonly focus = new AnimatableProperty<number>(0);

  constructor(readonly maxBlur = 28) {
    super();
    this.params.focus = this.focus as AnimatableProperty<unknown>;
  }

  override updateAt(t: number): void {
    this.strength.setStatic(this.focus.valueAt(t) * this.maxBlur);
    super.updateAt(t);
  }
}

/**
 * A **one-knob colour pop**. Where {@link ColorEffect} exposes brightness /
 * contrast / saturation separately, `PopEffect` folds them into a single `pop` ∈
 * [0,1]: keyframe it and the frame flashes brighter and more saturated, then
 * settles. It overrides only the *pure* `valuesAt(t)` the parent's `updateAt`
 * reads, keeping the inherited `ColorMatrixFilter` and its cross-renderer path.
 */
export class PopEffect extends ColorEffect {
  readonly pop = new AnimatableProperty<number>(0);

  constructor() {
    super();
    this.params.pop = this.pop as AnimatableProperty<unknown>;
  }

  override valuesAt(t: number): { brightness: number; contrast: number; saturation: number } {
    const k = this.pop.valueAt(t);
    return { brightness: 1 + 0.5 * k, contrast: 1 + 0.4 * k, saturation: 1 + 1.2 * k };
  }
}

// ── 2 · a custom TRANSITION ───────────────────────────────────────────────────

/**
 * A crossfade with a **shaped dissolve curve**. The base
 * {@link CrossfadeTransition} ramps the incoming clip's opacity *linearly* across
 * the overlap; `EasedCrossfade` eases that ramp (slow-in / slow-out) so an
 * image→image dissolve feels less mechanical. It overrides only `progressAt(t)` —
 * the value the compositor feeds into `render` — inheriting all of the parent's
 * GPU sprite compositing.
 */
export class EasedCrossfade extends CrossfadeTransition {
  override progressAt(t: number): number {
    return easeInOutCubic(super.progressAt(t));
  }
}

// ── 3 · a custom ANIMATION (whole-clip) ───────────────────────────────────────

/**
 * A procedural **orbit**: an implements-`ClipAnimator` that sweeps a clip around a
 * circle while spinning and gently pulsing it. `sampleAt(localT)` is pure, so it
 * composes over the clip's base transform into a reproducible `render(t)`. Drop it
 * on any `clip.animator` (works on a shape, an image, a group…).
 */
export class OrbitAnimator implements ClipAnimator {
  constructor(
    private readonly radius = 90,
    private readonly period = 2.6,
  ) {}

  sampleAt(localT: number): AnimationSample {
    const a = (localT / this.period) * Math.PI * 2;
    const pulse = 1 + 0.12 * Math.sin(a * 2);
    return {
      x: Math.cos(a) * this.radius,
      y: Math.sin(a) * this.radius,
      rotation: a, // spin along the orbit (radians)
      scaleX: pulse,
      scaleY: pulse,
    };
  }
}

// ── 4 · a custom TEXT ANIMATION (per-character) ───────────────────────────────

/**
 * A per-character **drop-in**: an implements-`TextAnimator` for a split
 * {@link TextClip}. Each character falls into place from above and fades up,
 * staggered by its `index`, and scales from small to full. Pure in
 * `(part, localT)` — same contract as {@link OrbitAnimator}.
 */
export class DropInTextAnimator implements TextAnimator {
  constructor(
    private readonly stagger = 0.06,
    private readonly duration = 0.5,
    private readonly drop = 70,
  ) {}

  sampleForPart(part: TextPart, localT: number): AnimationSample {
    const k = (localT - part.index * this.stagger) / this.duration;
    const p = k <= 0 ? 0 : k >= 1 ? 1 : easeOutCubic(k);
    return {
      y: -this.drop * (1 - p), // start above, settle to the baseline
      alpha: p,
      scaleX: 0.6 + 0.4 * p,
      scaleY: 0.6 + 0.4 * p,
    };
  }
}
