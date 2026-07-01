import type { AudioBufferSource, AudioCodec, BufferTarget, CanvasSource, Output, VideoCodec } from 'mediabunny';
import type { ExportSink, ResolvedExportOptions } from './export-sink';

/**
 * Default {@link ExportSink}: encode + mux with
 * [Mediabunny](https://mediabunny.dev) (a zero-dependency WebCodecs wrapper),
 * replacing `mp4-muxer` / `webm-muxer`.
 *
 * A `CanvasSource` captures the compositor's `view` canvas each frame (so no
 * manual `VideoFrame` readback), an `AudioBufferSource` takes the offline mix,
 * and an `Output` (MP4 / WebM) muxes into a `BufferTarget`. Mediabunny is loaded
 * dynamically so it stays out of the import graph until a real export runs.
 */
export class MediabunnyExportSink implements ExportSink {
  private output: Output | null = null;
  private target: BufferTarget | null = null;
  private video: CanvasSource | null = null;
  private audio: AudioBufferSource | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly opts: ResolvedExportOptions,
  ) {}

  async start(): Promise<void> {
    const { Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, CanvasSource, AudioBufferSource } =
      await import('mediabunny');

    this.target = new BufferTarget();
    const format = this.opts.container === 'webm' ? new WebMOutputFormat() : new Mp4OutputFormat();
    this.output = new Output({ format, target: this.target });

    this.video = new CanvasSource(this.canvas, {
      codec: this.opts.videoCodec as VideoCodec,
      bitrate: this.opts.bitrate,
    });
    this.output.addVideoTrack(this.video);

    if (this.opts.withAudio) {
      this.audio = new AudioBufferSource({
        codec: this.opts.audioCodec as AudioCodec,
        bitrate: this.opts.audioBitrate,
      });
      this.output.addAudioTrack(this.audio);
    }

    await this.output.start();
  }

  async addFrame(timestamp: number, duration: number): Promise<void> {
    await this.video!.add(timestamp, duration);
  }

  async addAudio(buffer: AudioBuffer): Promise<void> {
    if (this.audio) await this.audio.add(buffer);
  }

  async finalize(): Promise<Blob> {
    await this.output!.finalize();
    const mime = this.opts.container === 'webm' ? 'video/webm' : 'video/mp4';
    return new Blob([this.target!.buffer!], { type: mime });
  }

  async cancel(): Promise<void> {
    await this.output?.cancel();
  }
}
