import type { Container, Filter } from 'pixi.js';
import type { AnimatableProperty } from '../animation/animatable-property';
import type { Disposable } from '../core/disposable';

/**
 * A visual effect wraps a PixiJS {@link Filter} (GLSL/WGSL) and exposes its
 * parameters as animatable properties. `updateAt(t)` writes animated params
 * into the filter uniforms for frame `t`.
 */
export abstract class Effect implements Disposable {
  /** Named animatable parameters; written to uniforms in {@link updateAt}. */
  abstract readonly params: Record<string, AnimatableProperty<unknown>>;

  /** The underlying PixiJS filter. Created lazily by subclasses. */
  protected abstract filter: Filter;

  /** Attach the filter to a display object's filter chain. */
  attach(target: Container): void {
    const existing = target.filters;
    const list = existing == null ? [] : Array.isArray(existing) ? [...existing] : [existing];
    list.push(this.filter);
    target.filters = list;
  }

  /** Remove the filter from a display object's filter chain. */
  detach(target: Container): void {
    const existing = target.filters;
    if (existing == null) return;
    const list = Array.isArray(existing) ? existing : [existing];
    target.filters = list.filter((f) => f !== this.filter);
  }

  /** Write animated parameter values into the filter's uniforms for time `t`. */
  abstract updateAt(t: number): void;

  dispose(): void {
    this.filter.destroy();
  }
}
