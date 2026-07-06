import { describe, expect, it } from 'vitest';
import { cubicBezier, easeInOutQuad, hold, linear } from '../src/animation/easing';

describe('easing', () => {
  it('linear is identity', () => {
    expect(linear(0)).toBe(0);
    expect(linear(0.5)).toBe(0.5);
    expect(linear(1)).toBe(1);
  });

  it('easeInOutQuad hits the expected midpoint', () => {
    expect(easeInOutQuad(0)).toBe(0);
    expect(easeInOutQuad(0.5)).toBeCloseTo(0.5);
    expect(easeInOutQuad(1)).toBe(1);
  });

  it('hold steps at the end', () => {
    expect(hold(0)).toBe(0);
    expect(hold(0.99)).toBe(0);
    expect(hold(1)).toBe(1);
  });

  it('cubicBezier pins endpoints and is monotonic', () => {
    const ease = cubicBezier(0.25, 0.1, 0.25, 1);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    const mid = ease(0.5);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });
});
