import type { AudioEngine } from '../audio/audio-engine';
import type { Compositor } from '../compositor/compositor';

export interface ExportOptions {
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  bitrate: number;
  /** Optional [start, end] range in seconds. Defaults to the whole timeline. */
  range?: [number, number];
}

/**
 * Renders the timeline to a video file. Reuses the same Compositor render core
 * but drives it with a deterministic fixed-step clock and awaits `prepare` for
 * every frame, so no frame is ever dropped (SDK contract #1 + #3).
 *
 * Pipeline per frame:
 *   await compositor.prepare(t) → renderToTexture(t) → readback → VideoFrame →
 *   Mediabunny video encode. Audio: audio.renderOffline() → encode → Mediabunny
 *   Output (Mp4OutputFormat / WebMOutputFormat).
 */
export class Exporter {
  private cancelled = false;

  constructor(
    private readonly compositor: Compositor,
    private readonly audio: AudioEngine,
  ) {}

  async export(_opts: ExportOptions, _onProgress?: (p: number) => void): Promise<Blob> {
    this.cancelled = false;
    // TODO(export): FixedStepClock loop + Mediabunny encode + Output muxer.
    // See todo/08-exporter.md.
    throw new Error('Exporter.export not implemented — see todo/08-exporter.md');
  }

  cancel(): void {
    this.cancelled = true;
  }

  get isCancelled(): boolean {
    return this.cancelled;
  }
}
