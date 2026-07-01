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

    // Place the normalized anchor (0..1) at `position` — e.g. anchor [0.5,0.5]
    // centers content on `position` and scale/rotation pivot around it.
    const anchored = obj as unknown as { anchor?: { set(x: number, y: number): void } };
    if (anchored.anchor && typeof anchored.anchor.set === 'function') {
      // Sprite / Text carry a native proportional anchor: stable while content
      // size animates (no bounds quantization jitter) and no per-frame measure.
      anchored.anchor.set(ax, ay);
    } else {
      // Container / Graphics: map the anchor onto local bounds → pivot (unscaled
      // local px, must not include scale).
      const b = obj.getLocalBounds();
      obj.pivot.set(b.x + ax * b.width, b.y + ay * b.height);
    }
    obj.position.set(px, py);
    obj.scale.set(sx, sy);
    obj.rotation = this.rotation.valueAt(t);
  }
}
