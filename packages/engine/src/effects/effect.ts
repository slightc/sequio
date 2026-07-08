import type { Container, Filter } from 'pixi.js';
import type { AnimatableProperty } from '../animation/animatable-property';
import type { Disposable } from '../core/disposable';

/**
 * A visual effect wraps a PixiJS {@link Filter} and exposes its parameters as
 * {@link AnimatableProperty}s. `updateAt(t)` writes the animated values into the
 * filter (uniforms / matrix) for time `t`.
 *
 * The filter is created lazily (it needs a GPU/DOM context), so an Effect can be
 * constructed and its params animated without a renderer; the filter is built on
 * first {@link attach}. Subclasses implement {@link createFilter} + {@link updateAt}.
 */
export abstract class Effect implements Disposable {
  /** Named animatable parameters; written into the filter in {@link updateAt}. */
  abstract readonly params: Record<string, AnimatableProperty<unknown>>;

  /** The underlying PixiJS filter, once created. */
  protected filter: Filter | null = null;

  /** Build the filter. Called lazily on first attach (needs a GPU context). */
  protected abstract createFilter(): Filter;

  /** Ensure the filter exists and return it. */
  protected ensureFilter(): Filter {
    if (this.filter == null) {
      const filter = this.createFilter();
      // PixiJS v8 filters default to `antialias: 'off'`, and the FilterSystem
      // disables MSAA for the entire filter pass if *any* filter opts out — so a
      // clip with an effect renders its intermediate texture without MSAA and its
      // edges alias (a rotated ColorEffect'd rect shows jaggies). Inherit the
      // render target's antialias instead, so a filtered clip is as smooth as an
      // unfiltered one (the compositor's `antialias`, default on). Contract #3:
      // preview and export share the same filter pipeline, so both benefit.
      filter.antialias = 'inherit';
      this.filter = filter;
    }
    return this.filter;
  }

  /** Attach the filter to a display object's filter chain. */
  attach(target: Container): void {
    const filter = this.ensureFilter();
    const existing = target.filters;
    const list = existing == null ? [] : Array.isArray(existing) ? [...existing] : [existing];
    list.push(filter);
    target.filters = list;
  }

  /** Remove the filter from a display object's filter chain. */
  detach(target: Container): void {
    if (!this.filter) return;
    const existing = target.filters;
    if (existing == null) return;
    const list = Array.isArray(existing) ? existing : [existing];
    target.filters = list.filter((f) => f !== this.filter);
  }

  /** Write the animated parameter values into the filter for time `t`. */
  abstract updateAt(t: number): void;

  dispose(): void {
    this.filter?.destroy();
    this.filter = null;
  }
}
