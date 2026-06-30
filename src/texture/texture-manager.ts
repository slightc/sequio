import type { Texture } from 'pixi.js';
import type { Disposable } from '../core/disposable';

/**
 * GPU-memory budgeted texture pool. Multi-track high-res video easily blows
 * VRAM, so uploads are tracked against a byte budget with LRU eviction
 * (SDK contract #4 — clear ownership, releasable, budgeted).
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

  /** Upload a decoded VideoFrame to a PixiJS texture. */
  upload(_frame: VideoFrame): Texture {
    // TODO(texture): create a Texture from the VideoFrame source, track its
    // byte size, register in the pool, evict if over budget.
    throw new Error('TextureManager.upload not implemented — see todo/03-texture-frame-budget.md');
  }

  acquire(key: string): Texture | null {
    const entry = this.pool.get(key);
    if (!entry) return null;
    // LRU touch.
    this.pool.delete(key);
    this.pool.set(key, entry);
    return entry.tex;
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

  /** Evict least-recently-used textures until under budget. */
  evictLRU(): void {
    for (const key of this.pool.keys()) {
      if (this.usedBytes <= this.budgetBytes) break;
      this.release(key);
    }
  }

  get usage(): { usedBytes: number; budgetBytes: number } {
    return { usedBytes: this.usedBytes, budgetBytes: this.budgetBytes };
  }

  dispose(): void {
    for (const { tex } of this.pool.values()) tex.destroy(true);
    this.pool.clear();
    this.usedBytes = 0;
  }
}
