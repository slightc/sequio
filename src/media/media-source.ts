import type { Texture } from 'pixi.js';
import type { Disposable } from '../core/disposable';

export interface SourceMetadata {
  width: number;
  height: number;
  /** Duration in seconds. */
  duration: number;
  fps?: number;
  hasAudio: boolean;
}

/**
 * Base class for any decodable media. Decoding is the hardest, most
 * performance-sensitive part of the engine, so it hides behind one interface.
 */
export abstract class MediaSource implements Disposable {
  protected metadata: SourceMetadata | null = null;

  /** Load + probe. Resolves with metadata; safe to call once. */
  abstract load(): Promise<SourceMetadata>;
  abstract dispose(): void;

  get loaded(): boolean {
    return this.metadata !== null;
  }
}

/**
 * Visual media. The split between async {@link prepare} and sync
 * {@link getTextureAt} is SDK contract #1: preview can render immediately with
 * a best-effort frame, export awaits prepare so it never drops a frame.
 */
export abstract class VisualSource extends MediaSource {
  /** Ensure the frame at `sourceTime` (seconds) is decoded into cache. */
  abstract prepare(sourceTime: number): Promise<void>;
  /** Synchronously read the cached frame as a texture; null on cache miss. */
  abstract getTextureAt(sourceTime: number): Texture | null;
}
