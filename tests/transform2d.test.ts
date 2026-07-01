import type { Container } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { Transform2D } from '../src/animation/transform2d';

/** A stand-in pixi object recording what applyTo writes. */
function fakeObject(bounds: { x: number; y: number; width: number; height: number }) {
  return {
    position: { set: vi.fn() },
    scale: { set: vi.fn() },
    pivot: { set: vi.fn() },
    rotation: 0,
    getLocalBounds: () => bounds,
  };
}

describe('Transform2D', () => {
  it('maps a normalized anchor onto local content bounds → pivot in local px', () => {
    const obj = fakeObject({ x: 0, y: 0, width: 100, height: 50 });
    const tf = new Transform2D();
    tf.position.setStatic([200, 120]);
    tf.applyTo(obj as unknown as Container, 0);

    expect(obj.pivot.set).toHaveBeenCalledWith(50, 25); // center of 100x50
    expect(obj.position.set).toHaveBeenCalledWith(200, 120);
  });

  it('respects a non-centered anchor and the bounds offset', () => {
    const obj = fakeObject({ x: -10, y: 4, width: 80, height: 40 });
    const tf = new Transform2D();
    tf.anchor.setStatic([0, 1]); // top-left x, bottom y
    tf.applyTo(obj as unknown as Container, 0);

    // x: -10 + 0*80 = -10 ; y: 4 + 1*40 = 44
    expect(obj.pivot.set).toHaveBeenCalledWith(-10, 44);
  });

  it('writes pivot in unscaled local pixels (independent of scale)', () => {
    const obj = fakeObject({ x: 0, y: 0, width: 200, height: 100 });
    const tf = new Transform2D();
    tf.scale.setStatic([2, 3]);
    tf.applyTo(obj as unknown as Container, 0);

    expect(obj.scale.set).toHaveBeenCalledWith(2, 3);
    expect(obj.pivot.set).toHaveBeenCalledWith(100, 50); // not multiplied by scale
  });

  it('animates the anchor over keyframes', () => {
    const obj = fakeObject({ x: 0, y: 0, width: 100, height: 100 });
    const tf = new Transform2D();
    tf.anchor.setKeyframes([
      { time: 0, value: [0, 0] },
      { time: 1, value: [1, 1] },
    ]);
    tf.applyTo(obj as unknown as Container, 0.5);
    expect(obj.pivot.set).toHaveBeenCalledWith(50, 50); // halfway → center
  });
});
