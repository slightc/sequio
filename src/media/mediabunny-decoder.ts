import type { Input, InputVideoTrack, VideoSampleSink } from 'mediabunny';
import type { SourceMetadata } from './media-source';
import type { DecodedFrame, VideoDecoderBackend } from './video-decoder';

/** Where the bytes come from: a URL, an in-memory buffer, or a Blob/File. */
export type VideoInput = string | ArrayBuffer | Blob;

/**
 * Default {@link VideoDecoderBackend}: demux + hardware decode via
 * [Mediabunny](https://mediabunny.dev) (a zero-dependency WebCodecs wrapper).
 *
 * `decode(sec)` uses a `VideoSampleSink`, which seeks to the nearest keyframe,
 * decodes forward to the target and returns the sample at-or-before `sec`.
 * Mediabunny is loaded dynamically so it stays out of the import graph until a
 * real decode happens (consumers injecting their own backend never pay for it).
 */
export class MediabunnyVideoDecoder implements VideoDecoderBackend {
  private input: Input | null = null;
  private track: InputVideoTrack | null = null;
  private sink: VideoSampleSink | null = null;
  /** Serializes `getSample` — the sink has internal decode state and is not safe
   *  to call concurrently (prewarm lookahead, or a shared source driven by both a
   *  preview and an export at once). */
  private queue: Promise<unknown> = Promise.resolve();
  /** Whether we own the demux `Input` (dispose it) or share a parent's. */
  private ownsInput = true;
  /** For a fork: the parent's already-demuxed track + metadata (no re-parse). */
  private forkedFrom: { track: InputVideoTrack; input: Input; meta: SourceMetadata } | null = null;

  constructor(private readonly src: VideoInput) {}

  async load(): Promise<SourceMetadata> {
    const { Input, VideoSampleSink, ALL_FORMATS, UrlSource, BufferSource, BlobSource } =
      await import('mediabunny');

    // Fork: reuse the parent's demux + track, just build our own decoder sink.
    if (this.forkedFrom) {
      this.input = this.forkedFrom.input;
      this.track = this.forkedFrom.track;
      this.sink = new VideoSampleSink(this.forkedFrom.track);
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

    const [duration, stats, audioTrack] = await Promise.all([
      this.input.computeDuration(),
      track.computePacketStats(),
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
    if (!this.sink) throw new Error('MediabunnyVideoDecoder.decode before load()');
    const sink = this.sink;
    const run = this.queue.then(() => sink.getSample(sec));
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
    if (this.ownsInput) this.input?.dispose(); // a fork must not tear down the shared demux
    this.input = null;
    this.track = null;
    this.sink = null;
    this.forkedFrom = null;
  }
}
