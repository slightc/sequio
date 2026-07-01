import { Texture } from 'pixi.js';
import type { Disposable } from '../core/disposable';

/**
 * GPU-memory budgeted texture pool. Multi-track high-res video easily blows
 * VRAM, so uploads are tracked against a byte budget with LRU eviction
 * (SDK contract #4 — clear ownership, releasable, budgeted).
 *
 * Textures are keyed by `sourceId + frameIdx` so a decoded frame maps to at
 * most one resident texture, shared across every clip referencing that source.
 * The pool is independent of the decode-side {@link FrameCache}: a texture may
 * be evicted under VRAM pressure while its frame stays cached (it re-uploads on
 * next read), and a frame leaving the cache releases its texture here.
 *
 * Internal: not part of the public surface except for advanced extension.
 */
export class TextureManager implements Disposable {
  private readonly pool = new Map<string, { tex: Texture; bytes: number }>();
  private budgetBytes: number;
  private usedBytes = 0;

  constructor(budgetBytes = 256 * 1024 * 1024) {
    this.budgetBytes = budgetBytes;
  }

  /** Return the pooled texture for `key`, or upload `image` under it. */
  acquireOrUpload(key: string, image: CanvasImageSource, bytes?: number): Texture {
    const hit = this.acquire(key);
    if (hit) return hit;
    const tex = this.createTexture(image);
    return this.register(key, tex, bytes ?? this.estimateBytes(image));
  }

  /** Register an already-created texture under `key`; tracks bytes, evicts. */
  register(key: string, tex: Texture, bytes: number): Texture {
    this.release(key); // replace any prior entry for this key
    this.pool.set(key, { tex, bytes });
    this.usedBytes += bytes;
    this.evictLRU(key); // never evict the just-registered texture
    return tex;
  }

  acquire(key: string): Texture | null {
    const entry = this.pool.get(key);
    if (!entry) return null;
    // LRU touch.
    this.pool.delete(key);
    this.pool.set(key, entry);
    return entry.tex;
  }

  has(key: string): boolean {
    return this.pool.has(key);
  }

  release(key: string): void {
    const entry = this.pool.get(key);
    if (!entry) return;
    this.pool.delete(key);
    this.usedBytes -= entry.bytes;
    entry.tex.destroy(true);
  }

  setBudget(bytes: number): void {
    this.budgetBytes = bytes;
    this.evictLRU();
  }

  /** Evict least-recently-used textures until under budget (never `keep`). */
  evictLRU(keep?: string): void {
    for (const key of [...this.pool.keys()]) {
      if (this.usedBytes <= this.budgetBytes) break;
      if (key === keep) continue;
      this.release(key);
    }
  }

  get usage(): { usedBytes: number; budgetBytes: number } {
    return { usedBytes: this.usedBytes, budgetBytes: this.budgetBytes };
  }

  /** Number of resident textures (diagnostic / test hook). */
  get count(): number {
    return this.pool.size;
  }

  dispose(): void {
    for (const { tex } of this.pool.values()) tex.destroy(true);
    this.pool.clear();
    this.usedBytes = 0;
  }

  /** Create a texture from an image source. Overridable for headless tests. */
  protected createTexture(image: CanvasImageSource): Texture {
    return Texture.from(image);
  }

  /** Estimate RGBA8 byte size of a frame image. Overridable for tests. */
  protected estimateBytes(image: CanvasImageSource): number {
    const dims = image as {
      displayWidth?: number;
      videoWidth?: number;
      width?: number;
      displayHeight?: number;
      videoHeight?: number;
      height?: number;
    };
    const w = dims.displayWidth ?? dims.videoWidth ?? dims.width ?? 0;
    const h = dims.displayHeight ?? dims.videoHeight ?? dims.height ?? 0;
    return Math.max(0, w * h * 4);
  }
}
