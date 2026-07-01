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

  constructor(private readonly src: VideoInput) {}

  async load(): Promise<SourceMetadata> {
    const { Input, VideoSampleSink, ALL_FORMATS, UrlSource, BufferSource, BlobSource } =
      await import('mediabunny');

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

    return {
      width: track.displayWidth,
      height: track.displayHeight,
      duration,
      fps: stats.averagePacketRate,
      hasAudio: audioTrack !== null,
    };
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
    this.input?.dispose();
    this.input = null;
    this.track = null;
    this.sink = null;
  }
}
