import type { Disposable } from '../core/disposable';

/** Anything the cache can own and release (WebCodecs `VideoFrame`, a decoded
 *  sample wrapper, …). */
export interface Closable {
  close(): void;
}

/** Notified just before a cached entry is closed (eviction / overwrite /
 *  dispose), so dependent resources — e.g. a derived GPU texture — can be torn
 *  down in lockstep with the frame they reference. */
export type EvictListener<T> = (frameIdx: number, frame: T) => void;

/**
 * Ring-buffer + LRU cache of decoded frames, keyed by frame index. Bounded by a
 * frame budget; eviction closes frames to free decoder memory.
 *
 * This is internal: the budget here (with {@link TextureManager}'s GPU budget)
 * is what keeps multi-track 4K playback from exhausting memory (SDK contract #4).
 */
export class FrameCache<T extends Closable = VideoFrame> implements Disposable {
  private readonly map = new Map<number, T>();
  private budget: number;

  constructor(
    maxFrames = 60,
    /** Called before each entry is closed; use it to release derived resources. */
    private readonly onEvict?: EvictListener<T>,
  ) {
    this.budget = maxFrames;
  }

  get(frameIdx: number): T | null {
    const frame = this.map.get(frameIdx);
    if (!frame) return null;
    // Touch for LRU recency: re-insert to move to the end.
    this.map.delete(frameIdx);
    this.map.set(frameIdx, frame);
    return frame;
  }

  put(frameIdx: number, frame: T): void {
    if (this.map.has(frameIdx)) {
      this.release(frameIdx);
    }
    this.map.set(frameIdx, frame);
    this.evictToBudget();
  }

  has(frameIdx: number): boolean {
    return this.map.has(frameIdx);
  }

  setBudget(maxFrames: number): void {
    this.budget = Math.max(1, maxFrames);
    this.evictToBudget();
  }

  get size(): number {
    return this.map.size;
  }

  private release(frameIdx: number): void {
    const frame = this.map.get(frameIdx);
    if (!frame) return;
    this.map.delete(frameIdx);
    this.onEvict?.(frameIdx, frame);
    frame.close();
  }

  private evictToBudget(): void {
    while (this.map.size > this.budget) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.release(oldest);
    }
  }

  /**
   * Evict every resident frame (closing each) but keep the cache reusable — the
   * budget and `onEvict` wiring stay intact, so a subsequent `put` refills it.
   * Used by {@link VideoSource.purge} to force a fresh re-decode.
   */
  clear(): void {
    for (const idx of [...this.map.keys()]) this.release(idx);
    this.map.clear();
  }

  dispose(): void {
    this.clear();
  }
}
