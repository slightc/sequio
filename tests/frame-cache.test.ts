import { describe, expect, it, vi } from 'vitest';
import { FrameCache } from '../src/media/frame-cache';

/** Minimal stand-in for a WebCodecs VideoFrame (only `close` is used). */
function fakeFrame() {
  return { close: vi.fn() } as unknown as VideoFrame;
}

describe('FrameCache', () => {
  it('stores and retrieves frames by index', () => {
    const cache = new FrameCache(3);
    const f = fakeFrame();
    cache.put(1, f);
    expect(cache.get(1)).toBe(f);
    expect(cache.has(1)).toBe(true);
  });

  it('evicts the least-recently-used frame past budget', () => {
    const cache = new FrameCache(2);
    const f1 = fakeFrame();
    const f2 = fakeFrame();
    const f3 = fakeFrame();
    cache.put(1, f1);
    cache.put(2, f2);
    cache.get(1); // touch 1 → 2 is now LRU
    cache.put(3, f3);
    expect(cache.has(2)).toBe(false);
    expect(f2.close).toHaveBeenCalled();
    expect(cache.has(1)).toBe(true);
    expect(cache.has(3)).toBe(true);
  });

  it('closes all frames on dispose', () => {
    const cache = new FrameCache(4);
    const f = fakeFrame();
    cache.put(1, f);
    cache.dispose();
    expect(f.close).toHaveBeenCalled();
    expect(cache.size).toBe(0);
  });

  it('notifies onEvict before closing, on eviction / overwrite / dispose', () => {
    const onEvict = vi.fn();
    const cache = new FrameCache(1, onEvict);
    const f1 = fakeFrame();
    const f2 = fakeFrame();
    cache.put(1, f1);
    cache.put(2, f2); // evicts f1 (budget 1)
    expect(onEvict).toHaveBeenCalledWith(1, f1);
    expect(f1.close).toHaveBeenCalled();

    const f2b = fakeFrame();
    cache.put(2, f2b); // overwrite -> evicts the old f2
    expect(onEvict).toHaveBeenCalledWith(2, f2);

    cache.dispose(); // evicts remaining f2b
    expect(onEvict).toHaveBeenCalledWith(2, f2b);
  });
});
