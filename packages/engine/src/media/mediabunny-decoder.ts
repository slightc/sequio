import type { Input, InputAudioTrack, InputVideoTrack, VideoSample, VideoSampleSink } from 'mediabunny';
import { ForwardDecodeCursor } from './forward-decode-cursor';
import { loadMediabunny } from './mediabunny-loader';
import type { SourceMetadata } from './media-source';
import type { DecodedFrame, VideoDecoderBackend } from './video-decoder';

/** Where the bytes come from: a URL, an in-memory buffer, or a Blob/File. */
export type VideoInput = string | ArrayBuffer | Blob;

/**
 * The opened demux of a source: the mediabunny `Input` plus its primary audio
 * track (if any). An {@link AudioSource} can reuse this instead of re-opening the
 * same URL/blob — so a video-with-sound is fetched + parsed once, not twice.
 */
export interface MediabunnyDemux {
  input: Input;
  audioTrack: InputAudioTrack | null;
}

/**
 * How many leading packets to sample when estimating the frame rate in
 * {@link MediabunnyVideoDecoder.load}. Enough for a stable average even at high
 * fps, but tiny to read — so `load()` never scans a whole large file. */
const FPS_ESTIMATE_PACKETS = 120;

/** Turns a decoded {@link VideoSample} into the image a texture is built from. */
export type FrameImageExtractor = (sample: VideoSample) => CanvasImageSource | Promise<CanvasImageSource>;

/**
 * Optional override for how a decoded sample becomes a texture image. The default
 * (`sample.toCanvasImageSource()`) returns a `VideoFrame` in the browser — but
 * `VideoFrame` doesn't exist in Node, so server-side rendering sets this to read
 * the sample's pixels (`sample.copyTo`) into a canvas instead. Unset → browser default.
 */
let frameImageExtractor: FrameImageExtractor | null = null;

/** Set (or clear with `null`) how decoded samples become texture images. */
export function setFrameImageExtractor(fn: FrameImageExtractor | null): void {
  frameImageExtractor = fn;
}

/**
 * Default {@link VideoDecoderBackend}: demux + hardware decode via
 * [Mediabunny](https://mediabunny.dev) (a zero-dependency WebCodecs wrapper).
 *
 * **Sequential fast-path.** Naively, `sink.getSample(sec)` re-seeks to the
 * nearest keyframe and re-decodes the GOP prefix up to `sec` on *every* call —
 * so playing a clip frame-by-frame is O(GOP²) and visibly stutters. Instead a
 * {@link ForwardDecodeCursor} keeps a running `sink.samples(sec)` iterator (one
 * long-lived decoder that pre-decodes a little ahead) and, for a monotonic
 * request, just advances it to the frame at-or-before `sec` — each frame is
 * decoded exactly once. A backward step or a large forward jump (a seek)
 * rebuilds the iterator. Mediabunny is loaded dynamically so it stays out of the
 * import graph until a real decode happens (consumers injecting their own
 * backend never pay for it).
 *
 * **Reverse fast path.** Backward playback via `decode` alone would rebuild the
 * iterator every frame (re-decoding the whole GOP prefix each time — O(GOP²)).
 * {@link decodeRange} instead decodes a `[from, to)` window in one forward sweep
 * so {@link VideoSource} fills a cache batch and serves it in reverse.
 */
export class MediabunnyVideoDecoder implements VideoDecoderBackend {
  private input: Input | null = null;
  private track: InputVideoTrack | null = null;
  /** Primary audio track of the demux (if any), kept so an AudioSource can share
   *  this already-opened Input instead of re-fetching the file. */
  private audioTrack: InputAudioTrack | null = null;
  private sink: VideoSampleSink | null = null;
  /** Serializes `decode` — the cursor is mutable state and is not safe to
   *  advance concurrently (prewarm lookahead, or a shared source driven by both a
   *  preview and an export at once). */
  private queue: Promise<unknown> = Promise.resolve();
  /** Long-lived forward decode cursor over {@link sink} (built in `load`). */
  private cursor: ForwardDecodeCursor<VideoSample> | null = null;
  /** Whether we own the demux `Input` (dispose it) or share a parent's. */
  private ownsInput = true;
  /** For a fork: the parent's already-demuxed track + metadata (no re-parse). */
  private forkedFrom: { track: InputVideoTrack; input: Input; meta: SourceMetadata } | null = null;
  /** Set by {@link dispose}; a late fire-and-forget decode then resolves null, not throws. */
  private disposed = false;

  constructor(private readonly src: VideoInput) {}

  /** Build the forward cursor over the current sink (after `load`). */
  private makeCursor(sink: VideoSampleSink): ForwardDecodeCursor<VideoSample> {
    return new ForwardDecodeCursor<VideoSample>((startSec) => sink.samples(startSec));
  }

  async load(): Promise<SourceMetadata> {
    const { Input, VideoSampleSink, ALL_FORMATS, UrlSource, BufferSource, BlobSource } =
      await loadMediabunny();

    // Fork: reuse the parent's demux + track, just build our own decoder sink.
    if (this.forkedFrom) {
      this.input = this.forkedFrom.input;
      this.track = this.forkedFrom.track;
      this.sink = new VideoSampleSink(this.forkedFrom.track);
      this.cursor = this.makeCursor(this.sink);
      return this.forkedFrom.meta;
    }

    const source =
      typeof this.src === 'string'
        ? new UrlSource(this.src)
        : this.src instanceof ArrayBuffer
          ? new BufferSource(this.src)
          : new BlobSource(this.src);

    this.input = new Input({ formats: ALL_FORMATS, source });
    const track = await this.input.getPrimaryVideoTrack();
    if (!track) throw new Error('MediabunnyVideoDecoder: no video track in source');
    this.track = track;
    this.sink = new VideoSampleSink(track);
    this.cursor = this.makeCursor(this.sink);

    const [duration, stats, audioTrack] = await Promise.all([
      this.input.computeDuration(),
      // Estimate the frame rate from a PREFIX of packets, not the whole file.
      // The default (`Infinity`) walks every packet's metadata — for a long or
      // high-res source (e.g. a 4K/1080p multi-hundred-MB file) that scan can
      // take many seconds and freezes import. A CFR prefix gives an exact rate;
      // VFR is estimated (frame keying already assumes CFR — see class docs).
      track.computePacketStats(FPS_ESTIMATE_PACKETS),
      this.input.getPrimaryAudioTrack(),
    ]);

    this.audioTrack = audioTrack;
    this.meta = {
      width: track.displayWidth,
      height: track.displayHeight,
      duration,
      fps: stats.averagePacketRate,
      hasAudio: audioTrack !== null,
    };
    return this.meta;
  }

  private meta: SourceMetadata | null = null;

  /**
   * The opened demux (Input + primary audio track), or `null` before {@link load}.
   * Lets an {@link AudioSource} decode the audio from the SAME Input the video was
   * opened with — so a video-with-sound is fetched + parsed once, not twice. The
   * returned Input stays owned by this decoder; the consumer must not dispose it.
   */
  getDemux(): MediabunnyDemux | null {
    return this.input ? { input: this.input, audioTrack: this.audioTrack } : null;
  }

  /**
   * Create an independent decoder over the SAME demux: shares the `Input` +
   * track (the file is parsed once) but gets its own `VideoSampleSink`, so it can
   * decode at a different position in parallel. Must be `load()`ed before use;
   * disposing it leaves the shared demux alone.
   */
  fork(): MediabunnyVideoDecoder {
    if (!this.input || !this.track || !this.meta) {
      throw new Error('MediabunnyVideoDecoder.fork before load()');
    }
    const forked = new MediabunnyVideoDecoder(this.src);
    forked.ownsInput = false;
    forked.forkedFrom = { track: this.track, input: this.input, meta: this.meta };
    return forked;
  }

  async decode(sec: number): Promise<DecodedFrame | null> {
    // A prepare()'s directional look-ahead fires decodes fire-and-forget; if the
    // source is disposed (clip deleted, export finished) before one of them runs,
    // resolve null rather than throwing an uncaught "before load()" rejection.
    if (this.disposed) return null;
    if (!this.cursor) throw new Error('MediabunnyVideoDecoder.decode before load()');
    const cursor = this.cursor;
    const run = this.queue.then(() => cursor.at(sec));
    this.queue = run.then(
      () => undefined,
      () => undefined,
    ); // keep the chain alive past rejections
    const sample = await run;
    if (!sample) return null;
    return this.toFrame(sample);
  }

  /**
   * Reverse-play fast path: decode every frame in `[fromSec, toSec)` in one
   * forward sweep via `VideoSampleSink.samples` (each packet decoded once), so
   * {@link VideoSource} can fill a cache batch and serve it backward instead of
   * re-seeking to the GOP keyframe per frame (O(GOP²) → O(GOP)). Uses its OWN
   * `samples()` iterator (mediabunny spins an independent decoder per iterator),
   * so it doesn't disturb the forward {@link cursor}.
   */
  async *decodeRange(fromSec: number, toSec: number): AsyncGenerator<DecodedFrame, void, unknown> {
    if (this.disposed || !this.sink) return;
    const iter = this.sink.samples(Math.max(0, fromSec), toSec);
    try {
      for (;;) {
        const next = await iter.next();
        if (next.done) break;
        if (this.disposed) {
          next.value.close();
          break;
        }
        yield await this.toFrame(next.value);
      }
    } finally {
      await iter.return().catch(() => {});
    }
  }

  /** Turn a decoded {@link VideoSample} into an owned {@link DecodedFrame}. */
  private async toFrame(sample: VideoSample): Promise<DecodedFrame> {
    const timestamp = sample.timestamp;

    // Node (SSR): the injected extractor copies pixels into a stable canvas, so
    // the image outlives the sample — close the sample once extracted.
    if (frameImageExtractor) {
      const image = await frameImageExtractor(sample);
      sample.close();
      return { timestamp, image, close: () => {} };
    }

    // Browser: we CACHE the frame and upload it to a GPU texture LATER (PixiJS
    // defers the upload to render time and re-uploads across frames). So we must
    // NOT use `toCanvasImageSource()` — mediabunny may auto-close that VideoFrame
    // "in the next microtask", after which the deferred WebGPU
    // `copyExternalImageToTexture` fails ("video frame that doesn't have back
    // resource"). Take an OWNED VideoFrame (`toVideoFrame()`) whose lifetime we
    // control, and close it (not the sample) on cache eviction.
    const frame = sample.toVideoFrame();
    sample.close();
    return {
      timestamp,
      image: frame,
      close: () => frame.close(),
    };
  }

  /**
   * Drop the forward cursor's live decoder without re-parsing the demux; the next
   * {@link decode} rebuilds it from a keyframe seek. Recovers a decoder the browser
   * reclaimed while the tab was hidden (see {@link VideoDecoderBackend.reset}).
   */
  reset(): void {
    this.cursor?.invalidate();
  }

  dispose(): void {
    this.disposed = true;
    this.cursor?.dispose(); // release the cursor's decoder + carried frame
    this.cursor = null;
    if (this.ownsInput) this.input?.dispose(); // a fork must not tear down the shared demux
    this.input = null;
    this.track = null;
    this.sink = null;
    this.forkedFrom = null;
  }
}
