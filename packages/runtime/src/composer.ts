/**
 * The {@link Composer} is what running user code yields: a wrapper around the
 * resolved {@link TimelineSpec} that can go three ways from one object —
 *
 *  1. **Client preview** — `preview(container)` builds the live `Compositor`
 *     graph (decoding sources, loading fonts) and drives a `RealtimeClock`, so
 *     the composition plays on screen.
 *  2. **Client export** — `export(options)` renders the same graph to a video
 *     `Blob` through the engine's `Exporter` (same render core as the preview,
 *     contract #3).
 *  3. **Server render** — `toSpec()` returns the plain, JSON-serializable spec
 *     that both SSR routes (`pnpm ssr:render` / `ssr:render-node`) consume; the
 *     Composer is the same object whether it renders here or ships off to a box.
 *
 * Client build reuses the server package's {@link buildTimeline} (spec → live
 * graph) rather than re-implementing it — the SSR routes call the exact same
 * builder, so a composition previews, exports and server-renders identically.
 */
import {
  Exporter,
  RealtimeClock,
  type ExportOptions,
  type Subscription,
} from '@video-editor-canvas/engine';
import {
  buildTimeline,
  type BuildOverrides,
  type BuiltTimeline,
  type TimelineSpec,
} from '@video-editor-canvas/server';

/** A live preview: the built graph, its clock, and media-element-style controls. */
export interface PreviewHandle {
  /** The built object graph (compositor + audio engine + range). */
  readonly built: BuiltTimeline;
  /** The rAF-driven preview clock (`[0, duration]`). */
  readonly clock: RealtimeClock;
  /** The compositor's canvas (already appended if a container was given). */
  readonly view: HTMLCanvasElement;
  /** Timeline duration in seconds (`range[1]`). */
  readonly duration: number;
  play(): void;
  pause(): void;
  /** Jump to an absolute time (seconds); repaints immediately. */
  seek(t: number): void;
  /** Whether playback is running. */
  readonly playing: boolean;
  /** Dispose the built graph and detach the clock (frees sources/decoders). */
  dispose(): void;
}

export class Composer {
  constructor(private readonly _spec: TimelineSpec) {}

  /** The resolved timeline spec (identity — not a copy). */
  get spec(): TimelineSpec {
    return this._spec;
  }

  /** The JSON-serializable spec to hand to server-side rendering. */
  toSpec(): TimelineSpec {
    return this._spec;
  }

  /** Alias of {@link toSpec} so `JSON.stringify(composer)` yields the spec. */
  toJSON(): TimelineSpec {
    return this._spec;
  }

  /**
   * Build the live object graph (compositor, audio engine, range) from the spec.
   * Async: this initializes the GPU renderer and loads every font/source. The
   * caller owns the returned {@link BuiltTimeline} and must `dispose()` it.
   */
  async build(overrides?: BuildOverrides): Promise<BuiltTimeline> {
    return buildTimeline(this._spec, overrides);
  }

  /**
   * Build the graph and start a preview loop. If `container` is given the
   * compositor's canvas is appended to it. Returns a {@link PreviewHandle} with
   * play/pause/seek; the first frame is rendered immediately so the canvas is
   * never blank before playback starts.
   */
  async preview(container?: HTMLElement, overrides?: BuildOverrides): Promise<PreviewHandle> {
    const built = await this.build(overrides);
    const { compositor, audioEngine, range } = built;
    const view = compositor.view;
    if (container) container.append(view);

    const clock = new RealtimeClock();
    clock.duration = range[1];
    let playing = false;

    const tick: Subscription = clock.onTick((t) => compositor.renderPreview(t));
    const ended: Subscription = clock.onEnded(() => {
      playing = false;
      audioEngine.pause();
    });

    // Paint the first frame so the canvas isn't blank before play.
    clock.seek(range[0]);
    compositor.renderPreview(range[0]);

    return {
      built,
      clock,
      view,
      duration: range[1],
      get playing() {
        return playing;
      },
      play() {
        playing = true;
        clock.play();
        audioEngine.play(clock.currentTime);
      },
      pause() {
        playing = false;
        clock.pause();
        audioEngine.pause();
      },
      seek(t: number) {
        clock.seek(t);
        compositor.renderPreview(clock.currentTime);
        if (playing) audioEngine.seek(clock.currentTime);
      },
      dispose() {
        playing = false;
        tick.unsubscribe();
        ended.unsubscribe();
        clock.pause();
        built.dispose();
      },
    };
  }

  /**
   * Render the composition to a video `Blob` in the client. Builds a fresh graph,
   * runs the engine's {@link Exporter} over the spec's range, then disposes the
   * graph. `options` override the spec's `fps`/container/codec defaults.
   */
  async export(
    options: Partial<ExportOptions> = {},
    onProgress?: (progress: number) => void,
  ): Promise<Blob> {
    const built = await this.build();
    try {
      const exporter = new Exporter(built.compositor, built.audioEngine);
      return await exporter.export(
        {
          fps: this._spec.fps,
          range: built.range,
          audio: built.hasAudio,
          container: built.exportOptions.container,
          videoCodec: built.exportOptions.videoCodec,
          audioCodec: built.exportOptions.audioCodec,
          bitrate: built.exportOptions.bitrate,
          audioBitrate: built.exportOptions.audioBitrate,
          ...options,
        },
        onProgress,
      );
    } finally {
      built.dispose();
    }
  }
}
