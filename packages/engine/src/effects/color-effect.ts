import { ColorMatrixFilter, type Filter } from 'pixi.js';
import { AnimatableProperty } from '../animation/animatable-property';
import { Effect } from './effect';

/**
 * Brightness / contrast / saturation via a PixiJS `ColorMatrixFilter`. Each is
 * `1` = no change and animatable. `updateAt` rebuilds the matrix from the values
 * at `t` (a pure function of the params → same preview & export, contract #3).
 */
export class ColorEffect extends Effect {
  readonly brightness = new AnimatableProperty<number>(1);
  readonly contrast = new AnimatableProperty<number>(1);
  readonly saturation = new AnimatableProperty<number>(1);
  readonly params: Record<string, AnimatableProperty<unknown>> = {
    brightness: this.brightness,
    contrast: this.contrast,
    saturation: this.saturation,
  };

  /** The numeric values applied at time `t` (pure; testable without a filter). */
  valuesAt(t: number): { brightness: number; contrast: number; saturation: number } {
    return {
      brightness: this.brightness.valueAt(t),
      contrast: this.contrast.valueAt(t),
      saturation: this.saturation.valueAt(t),
    };
  }

  protected createFilter(): Filter {
    return new ColorMatrixFilter();
  }

  updateAt(t: number): void {
    const cm = this.filter as ColorMatrixFilter | null;
    if (!cm) return;
    const v = this.valuesAt(t);
    cm.reset();
    cm.brightness(v.brightness, true);
    cm.contrast(v.contrast, true);
    cm.saturate(v.saturation - 1, true); // saturate(0) = no change
  }
}
