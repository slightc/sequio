import { ShapeClip, easeInOutCubic } from '@sequio/engine';
import { describe, expect, it } from 'vitest';
import { EasedCrossfade, PopEffect } from '../example/custom-fx/fx';

/**
 * The custom effect/transition in `example/custom-fx` are userland subclasses,
 * but their timing math is pure — cover it without a GPU so a regression in the
 * "author your own FX" story fails here rather than only on screen.
 */
describe('PopEffect', () => {
  it('is a neutral grade at pop = 0', () => {
    const fx = new PopEffect();
    fx.pop.setStatic(0);
    expect(fx.valuesAt(0)).toEqual({ brightness: 1, contrast: 1, saturation: 1 });
  });

  it('lifts brightness, contrast and saturation together as pop → 1', () => {
    const fx = new PopEffect();
    fx.pop.setStatic(1);
    const v = fx.valuesAt(0);
    expect(v.brightness).toBeGreaterThan(1);
    expect(v.contrast).toBeGreaterThan(1);
    expect(v.saturation).toBeGreaterThan(v.contrast); // saturation pops hardest
  });

  it('exposes `pop` as a discoverable param', () => {
    expect(new PopEffect().params.pop).toBeDefined();
  });
});

describe('EasedCrossfade', () => {
  const bind = () => {
    const from = new ShapeClip({ kind: 'rect', width: 1, height: 1 });
    const to = new ShapeClip({ kind: 'rect', width: 1, height: 1 });
    from.start = 0;
    from.end = 3;
    to.start = 2;
    to.end = 5; // overlap window = [2, 3]
    return new EasedCrossfade(24).between(from, to);
  };

  it('pins the window endpoints (0 → from, 1 → to)', () => {
    const fx = bind();
    expect(fx.progressAt(2)).toBe(0);
    expect(fx.progressAt(3)).toBe(1);
  });

  it('eases the linear overlap progress rather than ramping it straight', () => {
    const fx = bind();
    // Quarter through the window: linear would be 0.25, the eased curve is lower.
    expect(fx.progressAt(2.25)).toBeCloseTo(easeInOutCubic(0.25), 6);
    expect(fx.progressAt(2.25)).toBeLessThan(0.25);
  });
});
