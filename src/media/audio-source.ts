import { MediaSource, type SourceMetadata } from './media-source';

export interface AudioSourceOptions {
  src: string | ArrayBuffer | Blob;
}

/**
 * Audio media decoded to an AudioBuffer (or chunked stream for long files).
 * Consumed by {@link AudioEngine} for scheduling and offline export.
 */
export class AudioSource extends MediaSource {
  private buffer: AudioBuffer | null = null;

  constructor(private readonly options: AudioSourceOptions) {
    super();
  }

  async load(): Promise<SourceMetadata> {
    // TODO(audio): fetch + decodeAudioData into `this.buffer`, fill metadata.
    throw new Error('AudioSource.load not implemented — see todo/06-audio-engine.md');
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
