import { ShapeClip, easeInOutCubic } from '@sequio/engine';
import type { TextPart } from '@sequio/engine';
import { describe, expect, it } from 'vitest';
import { DropInTextAnimator, EasedCrossfade, FocusPull, OrbitAnimator, PopEffect } from '../example/custom-fx/fx';

/**
 * The custom effects/transition in `example/custom-fx` are userland subclasses,
 * but their timing math is pure — cover it without a GPU so a regression in the
 * "author your own FX" story fails here rather than only on screen.
 */
describe('FocusPull', () => {
  it('maps the focus knob [0,1] onto the inherited blur strength [0,maxBlur]', () => {
    const fp = new FocusPull(30);
    fp.focus.setStatic(0);
    fp.updateAt(0);
    expect(fp.strength.valueAt(0)).toBe(0); // sharp

    fp.focus.setStatic(1);
    fp.updateAt(0);
    expect(fp.strength.valueAt(0)).toBe(30); // fully blurred

    fp.focus.setStatic(0.5);
    fp.updateAt(0);
    expect(fp.strength.valueAt(0)).toBe(15);
  });

  it('exposes `focus` as a discoverable param', () => {
    expect(new FocusPull().params.focus).toBeDefined();
  });
});

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
});

describe('EasedCrossfade', () => {
  const bind = () => {
    const from = new ShapeClip({ kind: 'rect', width: 1, height: 1 });
    const to = new ShapeClip({ kind: 'rect', width: 1, height: 1 });
    from.start = 0;
    from.end = 3;
    to.start = 2;
    to.end = 5; // overlap window = [2, 3]
    return new EasedCrossfade(30).between(from, to);
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

describe('OrbitAnimator', () => {
  it('sweeps a circle: 0 at the right, a quarter-period at the bottom', () => {
    const a = new OrbitAnimator(100, 4); // radius 100, 4s period
    const s0 = a.sampleAt(0);
    expect(s0.x).toBeCloseTo(100, 6);
    expect(s0.y).toBeCloseTo(0, 6);
    expect(s0.rotation).toBeCloseTo(0, 6);

    const s1 = a.sampleAt(1); // quarter period → 90°
    expect(s1.x).toBeCloseTo(0, 6);
    expect(s1.y).toBeCloseTo(100, 6);
    expect(s1.rotation).toBeCloseTo(Math.PI / 2, 6);
  });
});

describe('DropInTextAnimator', () => {
  const part = (index: number): TextPart => ({
    text: 'x',
    unit: 'char',
    index,
    count: 3,
    lineIndex: 0,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
  });

  it('starts a character above and hidden, and lands it in place', () => {
    const a = new DropInTextAnimator(0.06, 0.5, 70);
    const before = a.sampleForPart(part(2), 0); // its stagger hasn't started yet
    expect(before.alpha).toBe(0);
    expect(before.y).toBe(-70);

    const after = a.sampleForPart(part(0), 1); // well past index-0's window
    expect(after.alpha).toBe(1);
    expect(after.y).toBeCloseTo(0, 6);
    expect(after.scaleX).toBe(1);
  });
});
