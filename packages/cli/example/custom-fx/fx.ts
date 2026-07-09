/**
 * Bring-your-own effect & transition — authored entirely in *composition* code.
 *
 * The engine ships `Effect` / `Transition` as extension seams: a consumer can
 * subclass them and drop the result straight into a `clip.effects` list or a
 * `track.addTransition(...)`, no engine change required (see contract "explicit
 * resource ownership" + the runtime's "bring your own Clip/Effect subclasses").
 *
 * Both classes below subclass the engine's *own* effects, so they need no direct
 * `pixi.js` access (only `@sequio/engine` is injected into a composition) and
 * inherit the built-in filters — which means they render identically in the
 * browser preview (WebGL) and the pure-Node `sequio render` (WebGPU), honouring
 * contract #3 (preview and export share one render core).
 */
import { AnimatableProperty, ColorEffect, CrossfadeTransition, easeInOutCubic } from '@sequio/engine';

/**
 * A **one-knob cinematic grade**. Where the engine's {@link ColorEffect} exposes
 * brightness / contrast / saturation separately, `PopEffect` folds them into a
 * single animatable `pop` ∈ [0,1]: keyframe that one value and the frame "pops"
 * — brighter, punchier, more saturated — then settles. It reuses ColorEffect's
 * `ColorMatrixFilter` (so it is cross-renderer) by overriding only the *pure*
 * `valuesAt(t)` the parent's `updateAt` reads — keeping `render(t)` a pure
 * function of the graph (contract #2).
 */
export class PopEffect extends ColorEffect {
  /** 0 = neutral grade, 1 = full pop. Animatable on the global timeline. */
  readonly pop = new AnimatableProperty<number>(0);

  constructor() {
    super();
    // Surface `pop` alongside the inherited params so a host can discover it.
    this.params.pop = this.pop as AnimatableProperty<unknown>;
  }

  /** Coordinated brightness / contrast / saturation derived from `pop` at `t`. */
  override valuesAt(t: number): { brightness: number; contrast: number; saturation: number } {
    const k = this.pop.valueAt(t);
    return {
      brightness: 1 + 0.22 * k,
      contrast: 1 + 0.28 * k,
      saturation: 1 + 0.6 * k,
    };
  }
}

/**
 * A crossfade with a **shaped dissolve curve**. The base
 * {@link CrossfadeTransition} ramps the incoming clip's opacity *linearly* across
 * the overlap; `EasedCrossfade` eases that ramp (slow-in / slow-out) so the cut
 * feels less mechanical. It overrides only `progressAt(t)` — the value the
 * compositor feeds into `render` — so it needs none of Pixi's sprite plumbing and
 * inherits the parent's GPU compositing unchanged.
 */
export class EasedCrossfade extends CrossfadeTransition {
  /** Ease the linear 0→1 overlap progress before the base class blends with it. */
  override progressAt(t: number): number {
    return easeInOutCubic(super.progressAt(t));
  }
}
