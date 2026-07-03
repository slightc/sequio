import { MediaSource, type SourceMetadata } from './media-source';
import type { VideoInput } from './mediabunny-decoder';
import { loadMediabunny } from './mediabunny-loader';

export interface AudioSourceOptions {
  src: VideoInput;
}

/**
 * Audio media decoded to a single `AudioBuffer` via Mediabunny's
 * `AudioBufferSink`. Consumed by {@link AudioEngine} for scheduling and offline
 * export. Long files are fully decoded here (streaming/chunked decode is a
 * later refinement).
 */
export class AudioSource extends MediaSource {
  private buffer: AudioBuffer | null = null;

  constructor(private readonly options: AudioSourceOptions) {
    super();
  }

  async load(): Promise<SourceMetadata> {
    const { Input, AudioBufferSink, ALL_FORMATS, UrlSource, BufferSource, BlobSource } =
      await loadMediabunny();

    const source =
      typeof this.options.src === 'string'
        ? new UrlSource(this.options.src)
        : this.options.src instanceof ArrayBuffer
          ? new BufferSource(this.options.src)
          : new BlobSource(this.options.src);

    const input = new Input({ formats: ALL_FORMATS, source });
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('AudioSource: no audio track in source');

    const sink = new AudioBufferSink(track);
    const chunks: AudioBuffer[] = [];
    let length = 0;
    for await (const { buffer } of sink.buffers()) {
      chunks.push(buffer);
      length += buffer.length;
    }

    const channels = track.numberOfChannels || chunks[0]?.numberOfChannels || 1;
    const sampleRate = track.sampleRate || chunks[0]?.sampleRate || 48000;
    this.buffer = new AudioBuffer({ length: Math.max(1, length), numberOfChannels: channels, sampleRate });

    let offset = 0;
    for (const chunk of chunks) {
      for (let ch = 0; ch < channels; ch++) {
        const data = chunk.getChannelData(Math.min(ch, chunk.numberOfChannels - 1));
        this.buffer.copyToChannel(data, ch, offset);
      }
      offset += chunk.length;
    }

    this.metadata = {
      width: 0,
      height: 0,
      duration: length / sampleRate,
      hasAudio: true,
    };
    return this.metadata;
  }

  /** Decoded PCM, available after {@link load}. */
  getBuffer(): AudioBuffer | null {
    return this.buffer;
  }

  dispose(): void {
    this.buffer = null;
    this.metadata = null;
  }
}
