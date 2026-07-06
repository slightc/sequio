import { describe, expect, it } from 'vitest';
import { videoCacheSettings } from '../src/editor-export';

/**
 * The decode-cache sizing that keeps a high-resolution source from piling up
 * gigabytes of decoded frames and freezing the tab (the 4K/1GB export hang).
 */
describe('videoCacheSettings', () => {
  const BUDGET = 160 * 1024 * 1024;

  it('shrinks the ring for 4K so it fits the memory budget', () => {
    const { cacheFrames, lookahead } = videoCacheSettings(3840, 2160);
    // 4K RGBA ≈ 33 MiB/frame → only a handful fit under ~160 MiB.
    expect(cacheFrames).toBeLessThanOrEqual(6);
    expect(cacheFrames * 3840 * 2160 * 4).toBeLessThanOrEqual(BUDGET);
    expect(lookahead).toBe(1); // small ring ⇒ minimal look-ahead
  });

  it('allows a larger ring for 1080p', () => {
    const { cacheFrames, lookahead } = videoCacheSettings(1920, 1080);
    expect(cacheFrames).toBeGreaterThan(15);
    expect(cacheFrames * 1920 * 1080 * 4).toBeLessThanOrEqual(BUDGET);
    expect(lookahead).toBe(3);
  });

  it('caps at the default 60 frames for small (SD) video', () => {
    // ≤ SD fits far more than 60 frames in budget, but we never exceed the
    // SDK default — so main.ts leaves such sources untouched (no rebuild).
    expect(videoCacheSettings(640, 360).cacheFrames).toBe(60);
    expect(videoCacheSettings(320, 240).cacheFrames).toBe(60);
  });

  it('never returns fewer than 2 frames, even for absurd resolutions', () => {
    const { cacheFrames, lookahead } = videoCacheSettings(16000, 16000);
    expect(cacheFrames).toBe(2);
    expect(lookahead).toBe(1);
  });

  it('always stays within [2, 60] frames and honors a custom budget', () => {
    for (const [w, h] of [
      [3840, 2160],
      [2560, 1440],
      [1920, 1080],
      [1280, 720],
      [854, 480],
    ] as const) {
      const small = videoCacheSettings(w, h, 64 * 1024 * 1024);
      expect(small.cacheFrames).toBeGreaterThanOrEqual(2);
      expect(small.cacheFrames).toBeLessThanOrEqual(60);
      // Fits the (custom) budget whenever more than the floor of 2 frames fit.
      if (small.cacheFrames > 2) {
        expect(small.cacheFrames * w * h * 4).toBeLessThanOrEqual(64 * 1024 * 1024);
      }
    }
  });
});
