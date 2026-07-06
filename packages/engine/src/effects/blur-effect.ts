import { BlurFilter, type Filter } from 'pixi.js';
import { AnimatableProperty } from '../animation/animatable-property';
import { Effect } from './effect';

/** Gaussian blur via a PixiJS `BlurFilter`; `strength` is animatable. */
export class BlurEffect extends Effect {
  readonly strength = new AnimatableProperty<number>(8);
  readonly params: Record<string, AnimatableProperty<unknown>> = {
    strength: this.strength,
  };

  /** Blur strength at time `t` (pure; testable without a filter). */
  valuesAt(t: number): { strength: number } {
    return { strength: this.strength.valueAt(t) };
  }

  protected createFilter(): Filter {
    return new BlurFilter({ strength: this.strength.valueAt(0) });
  }

  updateAt(t: number): void {
    const f = this.filter as BlurFilter | null;
    if (f) f.strength = this.strength.valueAt(t);
  }
}
