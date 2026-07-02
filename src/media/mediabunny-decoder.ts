import type { Input, InputVideoTrack, VideoSample, VideoSampleSink } from 'mediabunny';
import { ForwardDecodeCursor } from './forward-decode-cursor';
import type { SourceMetadata } from './media-source';
import type { DecodedFrame, VideoDecoderBackend } from './video-decoder';

/** Where the bytes come from: a URL, an in-memory buffer, or a Blob/File. */
export type VideoInput = string | ArrayBuffer | Blob;

/**
 * How many leading packets to sample when estimating the frame rate in
 * {@link MediabunnyVideoDecoder.load}. Enough for a stable average even at high
 * fps, but tiny to read — so `load()` never scans a whole large file. */
const FPS_ESTIMATE_PACKETS = 120;

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
 */
export class MediabunnyVideoDecoder implements VideoDecoderBackend {
  private input: Input | null = null;
  private track: InputVideoTrack | null = null;
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

  constructor(private readonly src: VideoInput) {}

  /** Build the forward cursor over the current sink (after `load`). */
  private makeCursor(sink: VideoSampleSink): ForwardDecodeCursor<VideoSample> {
    return new ForwardDecodeCursor<VideoSample>((startSec) => sink.samples(startSec));
  }

  async load(): Promise<SourceMetadata> {
    const { Input, VideoSampleSink, ALL_FORMATS, UrlSource, BufferSource, BlobSource } =
      await import('mediabunny');

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
    if (!this.cursor) throw new Error('MediabunnyVideoDecoder.decode before load()');
    const cursor = this.cursor;
    const run = this.queue.then(() => cursor.at(sec));
    this.queue = run.then(
      () => undefined,
      () => undefined,
    ); // keep the chain alive past rejections
    const sample = await run;
    if (!sample) return null;
    return {
      timestamp: sample.timestamp,
      image: sample.toCanvasImageSource(),
      close: () => sample.close(),
    };
  }

  dispose(): void {
    this.cursor?.dispose(); // release the cursor's decoder + carried frame
    this.cursor = null;
    if (this.ownsInput) this.input?.dispose(); // a fork must not tear down the shared demux
    this.input = null;
    this.track = null;
    this.sink = null;
    this.forkedFrom = null;
  }
}
