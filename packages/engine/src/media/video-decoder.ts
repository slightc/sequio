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
   * Optional reverse-play fast path: decode every frame whose presentation
   * timestamp is in `[fromSec, toSec)` in ONE forward sweep — each packet decoded
   * at most once — yielding frames in presentation order. The caller owns and
   * caches each yielded frame.
   *
   * Backward playback decoded frame-by-frame is O(GOP²): showing frame N then
   * N-1 re-seeks to the GOP keyframe and re-decodes the whole prefix *every*
   * frame, because inter-frame codecs can't decode a P/B-frame without its
   * predecessors. A forward range sweep decodes the GOP once, so
   * {@link VideoSource} fills the cache with a batch and serves it in reverse.
   * Backends that can't range-decode omit this; `VideoSource` then falls back to
   * per-frame backward decode.
   */
  decodeRange?(fromSec: number, toSec: number): AsyncGenerator<DecodedFrame, void, unknown>;
  /**
   * Optional: create an independent decoder that **shares the demux** (the file
   * is parsed once) but has its own decode position — so a preview and an export
   * can decode the same source in parallel without contending on one decoder.
   * The fork must be `load()`ed before use and disposed by its caller; disposing
   * it must not tear down the shared demux. Backends that can't fork omit this.
   */
  fork?(): VideoDecoderBackend;
  /**
   * Optional: drop the live decoder (but keep the opened demux) so the next
   * {@link decode} rebuilds it from a fresh keyframe seek. A browser reclaims a
   * hidden tab's WebCodecs decoder while it's backgrounded; {@link VideoSource.purge}
   * calls this on visibility restore so a reclaimed decoder recovers instead of
   * stranding the preview on a black frame. Backends with no reclaimable decoder
   * omit it.
   */
  reset?(): void;
  /** Release the demuxer / decoder. */
  dispose(): void;
}
