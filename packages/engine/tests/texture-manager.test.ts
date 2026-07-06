import type { Texture } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { TextureManager } from '../src/texture/texture-manager';

/** Minimal stand-in for a PixiJS Texture (only `destroy` is used). */
function fakeTex() {
  return { destroy: vi.fn() } as unknown as Texture;
}

/** TextureManager whose uploads produce fake textures of a fixed byte size. */
class TestTM extends TextureManager {
  created: Texture[] = [];
  constructor(budget: number, private readonly bytes = 100) {
    super(budget);
  }
  protected override createTexture(): Texture {
    const t = fakeTex();
    this.created.push(t);
    return t;
  }
  protected override estimateBytes(): number {
    return this.bytes;
  }
}

const img = {} as CanvasImageSource;

describe('TextureManager', () => {
  it('registers a texture and tracks byte usage', () => {
    const tm = new TextureManager(1000);
    const tex = fakeTex();
    tm.register('a', tex, 300);
    expect(tm.acquire('a')).toBe(tex);
    expect(tm.usage).toEqual({ usedBytes: 300, budgetBytes: 1000 });
    expect(tm.count).toBe(1);
  });

  it('evicts least-recently-used textures past the byte budget', () => {
    const tm = new TextureManager(250);
    const a = fakeTex();
    const b = fakeTex();
    const c = fakeTex();
    tm.register('a', a, 100);
    tm.register('b', b, 100);
    tm.acquire('a'); // touch a → b is now LRU
    tm.register('c', c, 100); // 300 > 250 → evict b

    expect(tm.has('b')).toBe(false);
    expect(b.destroy).toHaveBeenCalled();
    expect(tm.has('a')).toBe(true);
    expect(tm.has('c')).toBe(true);
    expect(tm.usage.usedBytes).toBe(200);
  });

  it('never evicts the just-registered texture', () => {
    const tm = new TextureManager(100);
    const a = fakeTex();
    const b = fakeTex();
    tm.register('a', a, 100);
    tm.register('b', b, 100); // over budget immediately; keep b, drop a
    expect(tm.has('b')).toBe(true);
    expect(tm.has('a')).toBe(false);
  });

  it('release removes, destroys and decrements usage', () => {
    const tm = new TextureManager(1000);
    const a = fakeTex();
    tm.register('a', a, 400);
    tm.release('a');
    expect(a.destroy).toHaveBeenCalled();
    expect(tm.has('a')).toBe(false);
    expect(tm.usage.usedBytes).toBe(0);
    tm.release('a'); // idempotent
  });

  it('overwriting a key destroys the previous texture', () => {
    const tm = new TextureManager(1000);
    const a1 = fakeTex();
    const a2 = fakeTex();
    tm.register('a', a1, 100);
    tm.register('a', a2, 250);
    expect(a1.destroy).toHaveBeenCalled();
    expect(tm.acquire('a')).toBe(a2);
    expect(tm.usage.usedBytes).toBe(250);
  });

  it('shrinking the budget evicts down to fit', () => {
    const tm = new TextureManager(1000);
    tm.register('a', fakeTex(), 300);
    tm.register('b', fakeTex(), 300);
    tm.setBudget(300);
    expect(tm.usage.usedBytes).toBeLessThanOrEqual(300);
    expect(tm.count).toBe(1);
  });

  it('acquireOrUpload pools by key: uploads once, reuses after', () => {
    const tm = new TestTM(1000);
    const first = tm.acquireOrUpload('k', img);
    const second = tm.acquireOrUpload('k', img);
    expect(second).toBe(first);
    expect(tm.created).toHaveLength(1); // second call was a cache hit
  });

  it('dispose destroys every pooled texture and zeroes usage', () => {
    const tm = new TextureManager(1000);
    const a = fakeTex();
    const b = fakeTex();
    tm.register('a', a, 100);
    tm.register('b', b, 100);
    tm.dispose();
    expect(a.destroy).toHaveBeenCalled();
    expect(b.destroy).toHaveBeenCalled();
    expect(tm.count).toBe(0);
    expect(tm.usage.usedBytes).toBe(0);
  });
});
