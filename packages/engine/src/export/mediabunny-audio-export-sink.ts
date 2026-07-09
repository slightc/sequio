import type { AudioBufferSource, AudioCodec, BufferTarget, Output } from 'mediabunny';
import { loadMediabunny } from '../media/mediabunny-loader';
import type { AudioExportFormat, AudioExportSink, ResolvedAudioExportOptions } from './export-sink';

/** Per-format container class name (on the mediabunny module) + MIME type. */
const FORMATS: Record<AudioExportFormat, { output: string; mime: string }> = {
  m4a: { output: 'Mp4OutputFormat', mime: 'audio/mp4' },
  mp3: { output: 'Mp3OutputFormat', mime: 'audio/mpeg' },
  wav: { output: 'WavOutputFormat', mime: 'audio/wav' },
  ogg: { output: 'OggOutputFormat', mime: 'audio/ogg' },
  webm: { output: 'WebMOutputFormat', mime: 'audio/webm' },
};

/** PCM codecs carry no bitrate (the container is uncompressed). */
const isPcm = (codec: string) => codec.startsWith('pcm');

/**
 * Default {@link AudioExportSink}: encode + mux an audio-only file with
 * [Mediabunny](https://mediabunny.dev). Mirrors {@link MediabunnyExportSink} but
 * declares a single {@link AudioBufferSource} track (no video), so the offline
 * mix goes straight into an `.m4a` / `.mp3` / `.wav` / `.ogg` / `.webm` container.
 * Mediabunny is loaded dynamically so it stays out of the import graph until a
 * real export runs.
 */
export class MediabunnyAudioExportSink implements AudioExportSink {
  private output: Output | null = null;
  private target: BufferTarget | null = null;
  private source: AudioBufferSource | null = null;

  constructor(private readonly opts: ResolvedAudioExportOptions) {}

  async start(): Promise<void> {
    const mb = await loadMediabunny();
    const spec = FORMATS[this.opts.format];
    const FormatCtor = (mb as unknown as Record<string, new () => import('mediabunny').OutputFormat>)[spec.output];
    if (!FormatCtor) throw new Error(`unsupported audio export format: ${this.opts.format}`);

    this.target = new mb.BufferTarget();
    this.output = new mb.Output({ format: new FormatCtor(), target: this.target });

    this.source = new mb.AudioBufferSource({
      codec: this.opts.codec as AudioCodec,
      // PCM (wav) is uncompressed — a bitrate is meaningless and rejected.
      ...(isPcm(this.opts.codec) ? {} : { bitrate: this.opts.bitrate }),
    });
    this.output.addAudioTrack(this.source);

    await this.output.start();
  }

  async addAudio(buffer: AudioBuffer): Promise<void> {
    await this.source!.add(buffer);
  }

  async finalize(): Promise<Blob> {
    await this.output!.finalize();
    return new Blob([this.target!.buffer!], { type: FORMATS[this.opts.format].mime });
  }

  async cancel(): Promise<void> {
    await this.output?.cancel();
  }
}
