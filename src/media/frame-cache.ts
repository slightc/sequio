import type { Disposable } from '../core/disposable';

/**
 * Ring-buffer + LRU cache of decoded {@link VideoFrame}s, keyed by frame index.
 * Bounded by a frame budget; eviction closes frames to free decoder memory.
 *
 * This is internal: the budget here (with {@link TextureManager}'s GPU budget)
 * is what keeps multi-track 4K playback from exhausting memory (SDK contract #4).
 */
export class FrameCache implements Disposable {
  private readonly map = new Map<number, VideoFrame>();
  private budget: number;

  constructor(maxFrames = 60) {
    this.budget = maxFrames;
  }

  get(frameIdx: number): VideoFrame | null {
    const frame = this.map.get(frameIdx);
    if (!frame) return null;
    // Touch for LRU recency: re-insert to move to the end.
    this.map.delete(frameIdx);
    this.map.set(frameIdx, frame);
    return frame;
  }

  put(frameIdx: number, frame: VideoFrame): void {
    if (this.map.has(frameIdx)) {
      this.map.get(frameIdx)?.close();
      this.map.delete(frameIdx);
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

  private evictToBudget(): void {
    while (this.map.size > this.budget) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.get(oldest)?.close();
      this.map.delete(oldest);
    }
  }

  dispose(): void {
    for (const frame of this.map.values()) frame.close();
    this.map.clear();
  }
}
