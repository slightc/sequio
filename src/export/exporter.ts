import type { AudioEngine } from '../audio/audio-engine';
import type { Compositor } from '../compositor/compositor';
import { fonts } from '../text/font-manager';
import type { ExportSink, ResolvedExportOptions } from './export-sink';
import { exportFrameTimes } from './frame-times';
import { MediabunnyExportSink } from './mediabunny-export-sink';

export interface ExportOptions {
  /** Frames per second of the output. @default 30 */
  fps?: number;
  /** Container format. @default 'mp4' */
  container?: 'mp4' | 'webm';
  /** Video codec (WebCodecs/Mediabunny name: 'avc' | 'vp9' | 'vp8' | 'av1' | 'hevc'). @default 'avc' */
  videoCodec?: string;
  /** Target video bitrate, bits/sec. @default 5_000_000 */
  bitrate?: number;
  /** Include an audio track (the {@link AudioEngine} offline mix). @default true */
  audio?: boolean;
  /** Audio codec. @default 'aac' for mp4, 'opus' for webm. */
  audioCodec?: string;
  /** Target audio bitrate, bits/sec. @default 128_000 */
  audioBitrate?: number;
  /** Optional `[start, end]` range in seconds. Defaults to the whole timeline. */
  range?: [number, number];
}

/** Thrown by {@link Exporter.export} when {@link Exporter.cancel} was called. */
export class ExportCancelledError extends Error {
  constructor() {
    super('export cancelled');
    this.name = 'ExportCancelledError';
  }
}

function resolveOptions(o: ExportOptions): ResolvedExportOptions {
  const container = o.container ?? 'mp4';
  return {
    fps: o.fps ?? 30,
    container,
    videoCodec: o.videoCodec ?? 'avc',
    bitrate: o.bitrate ?? 5_000_000,
    withAudio: o.audio ?? true,
    audioCodec: o.audioCodec ?? (container === 'webm' ? 'opus' : 'aac'),
    audioBitrate: o.audioBitrate ?? 128_000,
  };
}

/**
 * Renders the timeline to a video file. Reuses the same {@link Compositor}
 * render core but drives it with a deterministic fixed step and **awaits
 * `prepare` for every frame**, so no frame is ever dropped (contract #1) and the
 * output matches the preview (contract #3).
 *
 * Pipeline per frame: `await compositor.prepare(t)` → `renderSync(t)` (draws to
 * the shared `view` canvas) → {@link ExportSink.addFrame}. Audio is the offline
 * mix (`AudioEngine.renderOffline`). The encode/mux is the {@link ExportSink}
 * seam — the default is Mediabunny; tests inject a fake.
 */
export class Exporter {
  private cancelled = false;

  constructor(
    private readonly compositor: Compositor,
    private readonly audio: AudioEngine,
  ) {}

  async export(options: ExportOptions = {}, onProgress?: (progress: number) => void): Promise<Blob> {
    this.cancelled = false;
    const opts = resolveOptions(options);
    const [start, end] = options.range ?? [0, this.timelineDuration()];
    const times = exportFrameTimes([start, end], opts.fps);

    // Fonts must be ready before the loop — render(t) must never swap a fallback
    // for the real face mid-export (contract #2). One-time, not per-frame.
    await this.waitForAssets();

    const sink = this.createSink(opts);
    await sink.start();
    try {
      for (let i = 0; i < times.length; i++) {
        if (this.cancelled) throw new ExportCancelledError();
        await this.compositor.prepare(times[i]!); // await → never drop a frame
        this.compositor.renderSync(times[i]!);
        await sink.addFrame(times[i]!, 1 / opts.fps);
        onProgress?.((i + 1) / times.length);
      }
      if (opts.withAudio) {
        const buffer = await this.audio.renderOffline(Math.max(0, end - start));
        await sink.addAudio(buffer);
      }
      return await sink.finalize();
    } catch (err) {
      await sink.cancel().catch(() => {});
      throw err;
    }
  }

  cancel(): void {
    this.cancelled = true;
  }

  get isCancelled(): boolean {
    return this.cancelled;
  }

  /** Timeline end = the latest clip end across all tracks (seconds). */
  private timelineDuration(): number {
    let end = 0;
    for (const track of this.compositor.getTracks()) {
      for (const clip of track.clips) end = Math.max(end, clip.end);
    }
    return end;
  }

  /** Seam: wait for external assets (fonts) before the deterministic loop. */
  protected waitForAssets(): Promise<void> {
    return fonts.ready();
  }

  /** Seam: build the encode/mux sink (default = Mediabunny). Overridden in tests. */
  protected createSink(opts: ResolvedExportOptions): ExportSink {
    return new MediabunnyExportSink(this.compositor.view, opts);
  }
}
