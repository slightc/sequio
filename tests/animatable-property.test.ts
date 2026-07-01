import { describe, expect, it } from 'vitest';
import { AnimatableProperty } from '../src/animation/animatable-property';
import { linear } from '../src/animation/easing';

describe('AnimatableProperty', () => {
  it('returns the static value when no keyframes are set', () => {
    const p = new AnimatableProperty(5);
    expect(p.valueAt(0)).toBe(5);
    expect(p.valueAt(100)).toBe(5);
    expect(p.animated).toBe(false);
  });

  it('linearly interpolates numbers between keyframes', () => {
    const p = new AnimatableProperty(0);
    p.setKeyframes([
      { time: 0, value: 0 },
      { time: 2, value: 10, easing: linear },
    ]);
    expect(p.valueAt(0)).toBe(0);
    expect(p.valueAt(1)).toBe(5);
    expect(p.valueAt(2)).toBe(10);
    expect(p.animated).toBe(true);
  });

  it('clamps outside the keyframe range', () => {
    const p = new AnimatableProperty(0);
    p.setKeyframes([
      { time: 1, value: 3 },
      { time: 2, value: 9 },
    ]);
    expect(p.valueAt(0)).toBe(3);
    expect(p.valueAt(5)).toBe(9);
  });

  it('interpolates numeric tuples component-wise', () => {
    const p = new AnimatableProperty<[number, number]>([0, 0]);
    p.setKeyframes([
      { time: 0, value: [0, 0] },
      { time: 1, value: [10, 20] },
    ]);
    expect(p.valueAt(0.5)).toEqual([5, 10]);
  });

  it('sorts keyframes passed out of order', () => {
    const p = new AnimatableProperty(0);
    p.setKeyframes([
      { time: 2, value: 10 },
      { time: 0, value: 0 },
    ]);
    expect(p.valueAt(1)).toBe(5);
  });

  it('setStatic clears keyframes so the constant value wins (toggle animation off)', () => {
    const p = new AnimatableProperty(1);
    p.setKeyframes([
      { time: 0, value: 0 },
      { time: 1, value: 2 },
    ]);
    expect(p.valueAt(0.5)).toBe(1);
    expect(p.animated).toBe(true);

    p.setStatic(1); // back to a constant
    expect(p.animated).toBe(false);
    expect(p.valueAt(0)).toBe(1);
    expect(p.valueAt(0.5)).toBe(1);
    expect(p.valueAt(1)).toBe(1);
  });

  it('clearKeyframes falls back to the current static value', () => {
    const p = new AnimatableProperty(7);
    p.setKeyframes([
      { time: 0, value: 0 },
      { time: 1, value: 10 },
    ]);
    p.clearKeyframes();
    expect(p.valueAt(0.5)).toBe(7);
    expect(p.animated).toBe(false);
  });
});
