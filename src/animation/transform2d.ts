import type { Container } from 'pixi.js';
import { AnimatableProperty } from './animatable-property';

/**
 * 2D transform built from animatable channels. `applyTo(obj, t)` writes the
 * value at time `t` onto a PixiJS display object.
 */
export class Transform2D {
  position = new AnimatableProperty<[number, number]>([0, 0]);
  scale = new AnimatableProperty<[number, number]>([1, 1]);
  rotation = new AnimatableProperty<number>(0);
  /** Normalized anchor (0..1). */
  anchor = new AnimatableProperty<[number, number]>([0.5, 0.5]);

  applyTo(obj: Container, t: number): void {
    const [px, py] = this.position.valueAt(t);
    const [sx, sy] = this.scale.valueAt(t);
    const [ax, ay] = this.anchor.valueAt(t);

    obj.position.set(px, py);
    obj.scale.set(sx, sy);
    obj.rotation = this.rotation.valueAt(t);
    // `pivot` is in local pixels; consumers that need normalized anchor map it
    // against the object's bounds. We expose anchor here and let the clip
    // resolve it once it knows its content size.
    obj.pivot.set(ax, ay);
  }
}
