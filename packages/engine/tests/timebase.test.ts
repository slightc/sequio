import { describe, expect, it } from 'vitest';
import { Timebase } from '../src/time/timebase';

describe('Timebase', () => {
  it('converts seconds to frames and back', () => {
    const tb = new Timebase(30);
    expect(tb.toFrame(1)).toBe(30);
    expect(tb.toSeconds(30)).toBe(1);
    expect(tb.frameDuration).toBeCloseTo(1 / 30);
  });

  it('quantizes to the nearest frame boundary', () => {
    const tb = new Timebase(25);
    // 0.05s is closer to frame 1 (0.04s) than frame 2 (0.08s).
    expect(tb.quantize(0.05)).toBeCloseTo(0.04);
    expect(tb.quantize(0.07)).toBeCloseTo(0.08);
  });

  it('rejects invalid fps', () => {
    expect(() => new Timebase(0)).toThrow();
    expect(() => new Timebase(-1)).toThrow();
    expect(() => new Timebase(Number.NaN)).toThrow();
  });
});
