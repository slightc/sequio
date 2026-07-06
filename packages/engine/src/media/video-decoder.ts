import type { Closable } from './frame-cache';
import type { SourceMetadata } from './media-source';

/** One decoded video frame, plus the image source a texture is built from. */
export interface DecodedFrame extends Closable {
  /** Presentation timestamp in seconds. */
  readonly timestamp: number;
  /** Image source for a PixiJS texture (a `VideoFrame`, canvas, …). */
  readonly image: CanvasImageSource;
}

/**
 * The decode half of a {@link VideoSource}, kept behind an interface so the
 * deterministic caching / lookahead / lifecycle logic in `VideoSource` can be
 * unit-tested with a fake backend, and so an alternative decoder (e.g. an
 * `ffmpeg.wasm` fallback) can be slotted in without touching `VideoSource`.
 *
 * The default implementation is {@link MediabunnyVideoDecoder}.
 */
export interface VideoDecoderBackend {
  /** Open + probe the container; resolve with track metadata. */
  load(): Promise<SourceMetadata>;
  /**
   * Decode the frame at-or-before `sec` (seconds). Resolves `null` if there is
   * no such frame (out of range). The caller owns the returned frame and closes
   * it via the cache.
   */
  decode(sec: number): Promise<DecodedFrame | null>;
  /**
   * Optional: create an independent decoder that **shares the demux** (the file
   * is parsed once) but has its own decode position — so a preview and an export
   * can decode the same source in parallel without contending on one decoder.
   * The fork must be `load()`ed before use and disposed by its caller; disposing
   * it must not tear down the shared demux. Backends that can't fork omit this.
   */
  fork?(): VideoDecoderBackend;
  /** Release the demuxer / decoder. */
  dispose(): void;
}
